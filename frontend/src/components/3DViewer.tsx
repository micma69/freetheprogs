import { useEffect, useRef } from 'react';
import type { Scene, Vertex } from '../types/scene';
import React from 'react';

interface Viewer3DProps {
  scene: Scene;
}

const Viewer3D: React.FC<Viewer3DProps> = ({ scene }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const zoomRef = useRef(1.0);
  const rotationRef = useRef({ x: 0.5, y: 0.5 });
  const [renderMode, setRenderMode] = React.useState<'normal' | 'wireframe'>('normal');

  // 14 predefined camera angles
  const predefinedViews = {
    // Standard orthogonal views (6)
    front: { x: 0, y: 0 },
    back: { x: 0, y: Math.PI },
    right: { x: 0, y: Math.PI / 2 },
    left: { x: 0, y: -Math.PI / 2 },
    top: { x: Math.PI / 2, y: 0 },
    bottom: { x: -Math.PI / 2, y: 0 },
    
    // Diagonal corner views (4)
    'top-front-right': { x: Math.PI / 4, y: Math.PI / 4 },
    'top-front-left': { x: Math.PI / 4, y: -Math.PI / 4 },
    'top-back-right': { x: Math.PI / 4, y: 3 * Math.PI / 4 },
    'top-back-left': { x: Math.PI / 4, y: -3 * Math.PI / 4 },
    
    // Edge midpoint views (4)
    'front-right': { x: 0, y: Math.PI / 4 },
    'front-left': { x: 0, y: -Math.PI / 4 },
    'top-right': { x: Math.PI / 4, y: Math.PI / 2 },
    'top-left': { x: Math.PI / 4, y: -Math.PI / 2 },
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

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

    // --- Enhanced Shaders with proper lighting ---
    const vertexShaderSource = `
      attribute vec3 a_position;
      attribute vec3 a_normal;
      uniform mat4 u_matrix;
      uniform mat4 u_normalMatrix;
      varying vec3 v_normal;
      varying vec3 v_position;
      void main() {
        vec4 pos = u_matrix * vec4(a_position, 1.0);
        gl_Position = pos;
        v_position = pos.xyz;
        
        // Transform normal using normal matrix (inverse transpose of model-view)
        v_normal = mat3(u_normalMatrix) * a_normal;
      }
    `;

    const fragmentShaderSource = `
      precision mediump float;
      varying vec3 v_normal;
      varying vec3 v_position;
      
      void main() {
        vec3 normal = normalize(v_normal);
        
        // Light direction (from top-right-front)
        vec3 lightDir = normalize(vec3(1.0, 1.0, 1.0));
        
        // Camera direction (from fragment to camera - since we're in view space, camera is at 0,0,0)
        vec3 viewDir = normalize(-v_position);
        
        // Ambient lighting
        float ambient = 0.3;
        
        // Diffuse lighting (Lambertian)
        float diffuse = max(dot(normal, lightDir), 0.0);
        
        // Specular lighting (Blinn-Phong)
        vec3 halfDir = normalize(lightDir + viewDir);
        float specular = pow(max(dot(normal, halfDir), 0.0), 32.0) * 0.4;
        
        // Combined lighting
        float light = ambient + diffuse + specular;
        
        // Cool blue-gray color with lighting
        vec3 baseColor = vec3(0.75, 0.78, 0.82);
        gl_FragColor = vec4(baseColor * light, 1.0);
      }
    `;

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
    const normalMatrixLoc = gl.getUniformLocation(triProgram, 'u_normalMatrix')!;

    const edgePosLoc = gl.getAttribLocation(edgeProgram, 'a_position');
    const edgeMatrixLoc = gl.getUniformLocation(edgeProgram, 'u_matrix')!;
    const edgeColorLoc = gl.getUniformLocation(edgeProgram, 'u_color')!;

    // --- Vertex processing with normal validation ---
    const allVertices: Vertex[] = [];
    const allIndices: number[] = [];
    const edgeSet = new Set<string>();
    const edgeIndices: number[] = [];

    // Check if we need to recalculate normals
    let hasValidNormals = true;
    for (const mesh of scene.meshes) {
      for (const vertex of mesh.vertices) {
        if (!vertex.normal || 
            (vertex.normal.x === 0 && vertex.normal.y === 0 && vertex.normal.z === 0)) {
          hasValidNormals = false;
          break;
        }
      }
      if (!hasValidNormals) break;
    }

    // Function to calculate face normal
    const calculateFaceNormal = (v1: Vertex, v2: Vertex, v3: Vertex) => {
      const p1 = v1.position;
      const p2 = v2.position;
      const p3 = v3.position;
      
      const u = { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z };
      const v = { x: p3.x - p1.x, y: p3.y - p1.y, z: p3.z - p1.z };
      
      return {
        x: u.y * v.z - u.z * v.y,
        y: u.z * v.x - u.x * v.z,
        z: u.x * v.y - u.y * v.x
      };
    };

    // Function to normalize vector
    const normalize = (v: { x: number; y: number; z: number }) => {
      const length = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
      if (length > 0) {
        return { x: v.x / length, y: v.y / length, z: v.z / length };
      }
      return { x: 0, y: 1, z: 0 }; // Default up normal
    };

    // Process meshes and calculate normals if needed
    if (!hasValidNormals) {
      console.log('Recalculating vertex normals...');
      
      // First, collect all vertices and create face information
      const vertexNormals: { [key: number]: { x: number; y: number; z: number } } = {};
      const vertexFaces: { [key: number]: number } = {};
      
      let globalIndex = 0;
      for (const mesh of scene.meshes) {
        const vertexOffset = allVertices.length;
        allVertices.push(...mesh.vertices.map(v => ({ ...v })));
        
        // Initialize normals
        for (let i = 0; i < mesh.vertices.length; i++) {
          const globalVertexIndex = vertexOffset + i;
          vertexNormals[globalVertexIndex] = { x: 0, y: 0, z: 0 };
          vertexFaces[globalVertexIndex] = 0;
        }
        
        // Calculate face normals and accumulate to vertices
        for (const face of mesh.faces) {
          if (face.indices.length < 3) continue;
          
          // Triangulate and calculate normals for each triangle
          for (let i = 1; i < face.indices.length - 1; i++) {
            const idx1 = face.indices[0] + vertexOffset;
            const idx2 = face.indices[i] + vertexOffset;
            const idx3 = face.indices[i + 1] + vertexOffset;
            
            const v1 = allVertices[idx1];
            const v2 = allVertices[idx2];
            const v3 = allVertices[idx3];
            
            const faceNormal = calculateFaceNormal(v1, v2, v3);
            
            // Accumulate face normal to each vertex
            [idx1, idx2, idx3].forEach(idx => {
              vertexNormals[idx].x += faceNormal.x;
              vertexNormals[idx].y += faceNormal.y;
              vertexNormals[idx].z += faceNormal.z;
              vertexFaces[idx]++;
            });
            
            allIndices.push(idx1, idx2, idx3);
          }
        }
        
        globalIndex += mesh.vertices.length;
      }
      
      // Average and normalize vertex normals
      for (let i = 0; i < allVertices.length; i++) {
        if (vertexFaces[i] > 0) {
          const normal = vertexNormals[i];
          normal.x /= vertexFaces[i];
          normal.y /= vertexFaces[i];
          normal.z /= vertexFaces[i];
          allVertices[i].normal = normalize(normal);
        } else {
          allVertices[i].normal = { x: 0, y: 1, z: 0 }; // Default up
        }
      }
      
      // Build edge indices
      for (const mesh of scene.meshes) {
        const vertexOffset = allVertices.length - mesh.vertices.length;
        for (const face of mesh.faces) {
          for (let i = 0; i < face.indices.length; i++) {
            const a = face.indices[i] + vertexOffset;
            const b = face.indices[(i + 1) % face.indices.length] + vertexOffset;
            const key = a < b ? `${a}_${b}` : `${b}_${a}`;
            if (!edgeSet.has(key)) {
              edgeSet.add(key);
              edgeIndices.push(a, b);
            }
          }
        }
      }
    } else {
      // Use existing normals
      for (const mesh of scene.meshes) {
        const vertexOffset = allVertices.length;
        allVertices.push(...mesh.vertices);
        
        for (const face of mesh.faces) {
          if (face.indices.length < 3) continue;
          const offsetIndices = face.indices.map(i => i + vertexOffset);
          
          for (let i = 1; i < offsetIndices.length - 1; i++) {
            allIndices.push(offsetIndices[0], offsetIndices[i], offsetIndices[i + 1]);
          }
          
          for (let i = 0; i < face.indices.length; i++) {
            const a = face.indices[i] + vertexOffset;
            const b = face.indices[(i + 1) % face.indices.length] + vertexOffset;
            const key = a < b ? `${a}_${b}` : `${b}_${a}`;
            if (!edgeSet.has(key)) {
              edgeSet.add(key);
              edgeIndices.push(a, b);
            }
          }
        }
      }
    }

    if (!allVertices.length) return;

    const maxIndex = Math.max(...allIndices, ...edgeIndices);
    const useUint32 = maxIndex > 65535;
    const IndexArrayType = useUint32 ? Uint32Array : Uint16Array;
    const indexType = useUint32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;

    if (useUint32) {
      const ext = gl.getExtension('OES_element_index_uint');
      if (!ext) {
        console.error('Mesh too large and UINT32 indices not supported');
        return;
      }
    }

    // --- Create buffers ---
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
      new Float32Array(allVertices.flatMap(v => [
        v.normal?.x ?? 0, 
        v.normal?.y ?? 1, 
        v.normal?.z ?? 0
      ])),
      gl.STATIC_DRAW
    );

    const indexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new IndexArrayType(allIndices), gl.STATIC_DRAW);

    const edgeIndexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, edgeIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new IndexArrayType(edgeIndices), gl.STATIC_DRAW);

    // --- Compute bounds ---
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

    const createMatrices = (angleX: number, angleY: number, zoom: number) => {
      const cosX = Math.cos(angleX);
      const sinX = Math.sin(angleX);
      const cosY = Math.cos(angleY);
      const sinY = Math.sin(angleY);
      const s = baseScale * zoom;

      // Model-view matrix
      const modelView = new Float32Array([
        cosY * s, sinX * sinY * s, -cosX * sinY * s, 0,
        0, cosX * s, sinX * s, 0,
        sinY * s, -sinX * cosY * s, cosX * cosY * s, 0,
        -center.x * s, -center.y * s, -center.z * s, 1,
      ]);

      // Normal matrix (inverse transpose of the upper 3x3 of model-view)
      // For rotation matrices, the inverse transpose is the same as the matrix itself
      const normalMatrix = new Float32Array([
        cosY, sinX * sinY, -cosX * sinY, 0,
        0, cosX, sinX, 0,
        sinY, -sinX * cosY, cosX * cosY, 0,
        0, 0, 0, 1,
      ]);

      return { modelView, normalMatrix };
    };

    // --- Render function ---
    const render = () => {
      // Light blue gradient background
      gl.clearColor(0.53, 0.81, 0.92, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK); // Only cull back faces

      const { x: angleX, y: angleY } = rotationRef.current;
      const { modelView, normalMatrix } = createMatrices(angleX, angleY, zoomRef.current);

      if (renderMode === 'normal') {
        // Draw solid triangles with proper lighting
        gl.useProgram(triProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.vertexAttribPointer(positionLoc, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(positionLoc);

        gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
        gl.vertexAttribPointer(normalLoc, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(normalLoc);

        gl.uniformMatrix4fv(matrixLoc, false, modelView);
        gl.uniformMatrix4fv(normalMatrixLoc, false, normalMatrix);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.drawElements(gl.TRIANGLES, allIndices.length, indexType, 0);

      } else {
        // Wireframe mode: draw edges with depth testing enabled
        gl.useProgram(edgeProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.vertexAttribPointer(edgePosLoc, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(edgePosLoc);

        gl.uniformMatrix4fv(edgeMatrixLoc, false, modelView);
        gl.uniform4fv(edgeColorLoc, new Float32Array([0.0, 0.0, 0.0, 1.0])); // Black edges

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, edgeIndexBuffer);
        gl.drawElements(gl.LINES, edgeIndices.length, indexType, 0);
      }
    };

    // --- Event handlers ---
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
      gl.deleteBuffer(positionBuffer);
      gl.deleteBuffer(normalBuffer);
      gl.deleteBuffer(indexBuffer);
      gl.deleteBuffer(edgeIndexBuffer);
      gl.deleteProgram(triProgram);
      gl.deleteProgram(edgeProgram);
    };
  }, [scene, renderMode]);

  // View switching
  const setView = (viewName: keyof typeof predefinedViews) => {
    rotationRef.current = { ...predefinedViews[viewName] };
    render();
  };

  const resetCamera = () => {
    rotationRef.current = { x: 0.5, y: 0.5 };
    zoomRef.current = 1.0;
    render();
  };

  const render = () => {
    const canvas = canvasRef.current;
    if (canvas && glRef.current) {
      const event = new Event('resize');
      window.dispatchEvent(event);
    }
  };

  // Updated control styles - top right, smaller, less opacity
  const gridStyle: React.CSSProperties = {
    position: 'absolute',
    right: 12,
    top: 12,
    width: 100,
    height: 100,
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gridTemplateRows: 'repeat(3, 1fr)',
    gap: '3px',
    padding: '6px',
    borderRadius: '8px',
    background: 'rgba(0,0,0,0.2)', // Less opacity
    pointerEvents: 'auto',
    zIndex: 10,
  };
  
  const gridBtnStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    borderRadius: '4px',
    background: 'rgba(255,255,255,0.8)', // Less opacity
    border: 'none',
    cursor: 'pointer',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    fontSize: '10px', // Smaller font
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 'bold',
    padding: '1px',
    transition: 'all 0.2s',
  };

  const resetBtnStyle: React.CSSProperties = {
    ...gridBtnStyle,
    background: 'rgba(59,130,246,0.7)', // Less opacity
    color: 'white',
  };

  const viewControlsStyle: React.CSSProperties = {
    position: 'absolute',
    top: 12,
    right: 120, // Moved to top right, next to grid
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    zIndex: 10,
  };

  const viewBtnStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.8)', // Less opacity
    border: '1px solid rgba(0,0,0,0.1)',
    borderRadius: '4px',
    padding: '6px 10px', // Smaller
    cursor: 'pointer',
    fontSize: '11px', // Smaller
    fontWeight: 500,
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    transition: 'all 0.2s',
  };

  const renderModeBtnStyle: React.CSSProperties = {
    ...viewBtnStyle,
    background: renderMode === 'normal' ? 'rgba(59,130,246,0.7)' : 'rgba(107,114,128,0.7)',
    color: 'white',
    marginBottom: '4px',
  };

  return (
    <div className="viewer-3d">
      <h2>3D Viewer</h2>
      <div className="viewer-layout">
        <div className="viewer-left" style={{ position: 'relative' }}>
          <canvas ref={canvasRef} className="viewer-canvas" style={{ width: '100%', height: '480px', display: 'block' }} />
          
          {/* All controls moved to top right */}
          <div style={viewControlsStyle}>
            <button 
              style={renderModeBtnStyle}
              onClick={() => setRenderMode(m => m === 'normal' ? 'wireframe' : 'normal')}
            >
              {renderMode === 'normal' ? 'Wireframe' : 'Normal'}
            </button>
            <button style={viewBtnStyle} onClick={() => setView('front')} title="Front">Front</button>
            <button style={viewBtnStyle} onClick={() => setView('back')} title="Back">Back</button>
            <button style={viewBtnStyle} onClick={() => setView('top')} title="Top">Top</button>
            <button style={viewBtnStyle} onClick={() => setView('bottom')} title="Bottom">Bottom</button>
          </div>

          {/* 3x3 View Grid - smaller and less opaque */}
          <div style={gridStyle}>
            {/* Top Row */}
            <button style={gridBtnStyle} onClick={() => setView('top-back-left')} title="Top Back Left">TBL</button>
            <button style={gridBtnStyle} onClick={() => setView('top')} title="Top">T</button>
            <button style={gridBtnStyle} onClick={() => setView('top-back-right')} title="Top Back Right">TBR</button>
            
            {/* Middle Row */}
            <button style={gridBtnStyle} onClick={() => setView('left')} title="Left">L</button>
            <button style={resetBtnStyle} onClick={resetCamera} title="Reset">●</button>
            <button style={gridBtnStyle} onClick={() => setView('right')} title="Right">R</button>
            
            {/* Bottom Row */}
            <button style={gridBtnStyle} onClick={() => setView('top-front-left')} title="Top Front Left">TFL</button>
            <button style={gridBtnStyle} onClick={() => setView('front')} title="Front">F</button>
            <button style={gridBtnStyle} onClick={() => setView('top-front-right')} title="Top Front Right">TFR</button>
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