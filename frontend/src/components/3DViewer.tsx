import { useEffect, useRef } from 'react';
import type { Scene, Vertex } from '../types/scene';

interface Viewer3DProps {
  scene: Scene;
}

const Viewer3D: React.FC<Viewer3DProps> = ({ scene }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const zoomRef = useRef(1.0);
  const rotationRef = useRef({ x: 0.5, y: 0.5 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // ensure container stacking works for overlay
    const parent = canvas.parentElement;
    if (parent) parent.style.position = parent.style.position || 'relative';

    const gl = canvas.getContext('webgl');
    if (!gl) {
      console.error('WebGL not supported');
      return;
    }

    glRef.current = gl;
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);

    // --- triangle shaders (lighting) ---
    const vertexShaderSource = `
      attribute vec3 a_position;
      attribute vec3 a_normal;
      uniform mat4 u_matrix;
      varying vec3 v_normal;
      void main() {
        gl_Position = u_matrix * vec4(a_position, 1.0);
        v_normal = a_normal;
      }
    `;
    const fragmentShaderSource = `
      precision mediump float;
      varying vec3 v_normal;
      void main() {
        vec3 normal = normalize(v_normal);
        vec3 lightDir = normalize(vec3(1.0, 1.0, 1.0));
        float dotProduct = max(dot(normal, lightDir), 0.2);
        gl_FragColor = vec4(vec3(dotProduct), 1.0);
      }
    `;

    // --- simple shader for edges (solid color) ---
    const edgeVertexSource = `
      attribute vec3 a_position;
      uniform mat4 u_matrix;
      void main() {
        gl_Position = u_matrix * vec4(a_position, 1.0);
      }
    `;
    const edgeFragmentSource = `
      precision mediump float;
      uniform vec4 u_color;
      void main() {
        gl_FragColor = u_color;
      }
    `;

    const compileShader = (gl: WebGLRenderingContext, type: number, src: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const makeProgram = (vsSrc: string, fsSrc: string) => {
      const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
      const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
      if (!vs || !fs) return null;
      const p = gl.createProgram()!;
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        console.error('Program link error:', gl.getProgramInfoLog(p));
        gl.deleteProgram(p);
        return null;
      }
      return p;
    };

    const triProgram = makeProgram(vertexShaderSource, fragmentShaderSource)!;
    const edgeProgram = makeProgram(edgeVertexSource, edgeFragmentSource)!;

    const positionLoc = gl.getAttribLocation(triProgram, 'a_position');
    const normalLoc = gl.getAttribLocation(triProgram, 'a_normal');
    const matrixLoc = gl.getUniformLocation(triProgram, 'u_matrix')!;

    const edgePosLoc = gl.getAttribLocation(edgeProgram, 'a_position');
    const edgeMatrixLoc = gl.getUniformLocation(edgeProgram, 'u_matrix')!;
    const edgeColorLoc = gl.getUniformLocation(edgeProgram, 'u_color')!;

    // --- collect vertices and indices ---
    const allVertices: Vertex[] = [];
    const allIndices: number[] = [];
    let indexOffset = 0;

    for (const mesh of scene.meshes) {
      allVertices.push(...mesh.vertices);
      for (const face of mesh.faces) {
        for (const i of face.indices) allIndices.push(i + indexOffset);
      }
      indexOffset += mesh.vertices.length;
    }

    if (!allVertices.length) return;

    // --- build edge index list (deduplicated undirected edges) ---
    const edgeSet = new Set<string>();
    const edgeIndices: number[] = [];
    indexOffset = 0;
    for (const mesh of scene.meshes) {
      for (const face of mesh.faces) {
        const indices = face.indices;
        const n = indices.length;
        for (let i = 0; i < n; i++) {
          const a = indices[i] + indexOffset;
          const b = indices[(i + 1) % n] + indexOffset;
          const key = a < b ? `${a}_${b}` : `${b}_${a}`;
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            edgeIndices.push(a, b);
          }
        }
      }
      indexOffset += mesh.vertices.length;
    }

    // --- buffers ---
    const positionBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array(allVertices.flatMap(v => [v.position.x, v.position.y, v.position.z])),
      gl.STATIC_DRAW
    );

    const normalBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array(allVertices.flatMap(v => v.normal ? [v.normal.x, v.normal.y, v.normal.z] : [0, 1, 0])),
      gl.STATIC_DRAW
    );

    const indexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(allIndices), gl.STATIC_DRAW);

    const edgeIndexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, edgeIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(edgeIndices), gl.STATIC_DRAW);

    // --- compute bounds for fitting ---
    const bounds = (() => {
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (const v of allVertices) {
        minX = Math.min(minX, v.position.x);
        minY = Math.min(minY, v.position.y);
        minZ = Math.min(minZ, v.position.z);
        maxX = Math.max(maxX, v.position.x);
        maxY = Math.max(maxY, v.position.y);
        maxZ = Math.max(maxZ, v.position.z);
      }
      return { minX, minY, minZ, maxX, maxY, maxZ };
    })();

    const center = {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
      z: (bounds.minZ + bounds.maxZ) / 2,
    };

    const sizeX = bounds.maxX - bounds.minX;
    const sizeY = bounds.maxY - bounds.minY;
    const sizeZ = bounds.maxZ - bounds.minZ;
    const maxSize = Math.max(sizeX, sizeY, sizeZ);
    const baseScale = maxSize > 0 ? 2 / maxSize : 1;

    const createMatrix = (angleX: number, angleY: number, zoom: number) => {
      const cosX = Math.cos(angleX);
      const sinX = Math.sin(angleX);
      const cosY = Math.cos(angleY);
      const sinY = Math.sin(angleY);
      const s = baseScale * zoom;

      return new Float32Array([
        cosY * s, sinX * sinY * s, -cosX * sinY * s, 0,
        0, cosX * s, sinX * s, 0,
        sinY * s, -sinX * cosY * s, cosX * cosY * s, 0,
        -center.x * s, -center.y * s, -center.z * s, 1,
      ]);
    };

    // --- render ---
    const render = () => {
      gl.clearColor(0.1, 0.1, 0.1, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);

      // draw triangles
      gl.useProgram(triProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.vertexAttribPointer(positionLoc, 3, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(positionLoc);

      gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
      gl.vertexAttribPointer(normalLoc, 3, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(normalLoc);

      const { x: angleX, y: angleY } = rotationRef.current;
      const matrix = createMatrix(angleX, angleY, zoomRef.current);
      gl.uniformMatrix4fv(matrixLoc, false, matrix);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.drawElements(gl.TRIANGLES, allIndices.length, gl.UNSIGNED_SHORT, 0);

      // draw edges on top
      // disable depth test so edges are always visible over faces (if you want occlusion remove this)
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(edgeProgram);

      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.vertexAttribPointer(edgePosLoc, 3, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(edgePosLoc);

      gl.uniformMatrix4fv(edgeMatrixLoc, false, matrix);
      // edge color (black, semi-opaque)
      gl.uniform4fv(edgeColorLoc, new Float32Array([0.0, 0.0, 0.0, 1.0]));

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, edgeIndexBuffer);
      // lineWidth may be ignored by some platforms, keep 1
      try { gl.lineWidth(1); } catch (e) { /* ignore unsupported */ }
      gl.drawElements(gl.LINES, edgeIndices.length, gl.UNSIGNED_SHORT, 0);

      // restore depth test
      gl.enable(gl.DEPTH_TEST);
    };

    // --- resize & wheel ---
    const handleResize = () => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
      render();
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomRef.current *= e.deltaY < 0 ? 1.1 : 0.9;
      zoomRef.current = Math.max(0.1, Math.min(zoomRef.current, 10));
      render();
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    canvas.addEventListener('wheel', handleWheel);

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('wheel', handleWheel);
      // try to clean GL resources (optional)
      gl.deleteBuffer(positionBuffer);
      gl.deleteBuffer(normalBuffer);
      gl.deleteBuffer(indexBuffer);
      gl.deleteBuffer(edgeIndexBuffer);
      gl.deleteProgram(triProgram);
      gl.deleteProgram(edgeProgram);
    };
  }, [scene]);

  // inline styles for overlay wheel
  const wheelStyle: React.CSSProperties = {
    position: 'absolute',
    left: 12,
    top: '50%',
    transform: 'translateY(-50%)',
    width: 120,
    height: 120,
    borderRadius: '50%',
    background: 'rgba(0,0,0,0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'auto',
    zIndex: 10,
  };
  const btnStyle: React.CSSProperties = {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    background: '#fff',
    border: 'none',
    cursor: 'pointer',
    boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
  };

  return (
    <div className="viewer-3d">
      <h2>3D Viewer</h2>
      <div className="viewer-layout">
        <div className="viewer-left" style={{ position: 'relative' }}>
          <canvas ref={canvasRef} className="viewer-canvas" style={{ width: '100%', height: '480px', display: 'block' }} />
          {/* overlay button wheel (left side overlap) */}
          <div style={wheelStyle} aria-hidden={false}>
            <button style={{ ...btnStyle, left: 42, top: 8 }} title="Top">▲</button>
            <button style={{ ...btnStyle, left: 42, top: 76 }} title="Bottom">▼</button>
            <button style={{ ...btnStyle, width: 48, height: 48, left: 36, top: 36, borderRadius: 24 }} title="Center">●</button>
          </div>
        </div>

        <div className="viewer-right">
          <div className="viewer-convert">
            <h3>Convert To</h3>
            <div className="convert-buttons">
              <button className="convert-btn" disabled>A</button>
              <button className="convert-btn" disabled>B</button>
              <button className="convert-btn" disabled>C</button>
              <button className="convert-btn" disabled>D</button>
            </div>
          </div>
          <div className="viewer-meta">
            <h3>Object Metadata</h3>
            <div className="viewer-stats">
              <p><strong>Format:</strong> {scene.metadata.format}</p>
              <p><strong>Vertices:</strong> {scene.metadata.vertexCount}</p>
              <p><strong>Faces:</strong> {scene.metadata.faceCount}</p>
              {scene.metadata.boundingBox && (
                <>
                  <p><strong>Bounding Box:</strong></p>
                  <p>Min: ({scene.metadata.boundingBox.min.x.toFixed(2)}, {scene.metadata.boundingBox.min.y.toFixed(2)}, {scene.metadata.boundingBox.min.z.toFixed(2)})</p>
                  <p>Max: ({scene.metadata.boundingBox.max.x.toFixed(2)}, {scene.metadata.boundingBox.max.y.toFixed(2)}, {scene.metadata.boundingBox.max.z.toFixed(2)})</p>
                </>
              )}
              <p><strong>Meshes:</strong> {scene.meshes.length}</p>
              <p><strong>Materials:</strong> {scene.materials.length}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Viewer3D;
