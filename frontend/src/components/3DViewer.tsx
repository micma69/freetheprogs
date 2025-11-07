import { useEffect, useRef } from 'react';
import type { Scene, Vertex, Vec3 } from '../types/scene';

interface Viewer3DProps {
  scene: Scene;
}

const Viewer3D: React.FC<Viewer3DProps> = ({ scene }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Initialize WebGL context
    const gl = canvas.getContext('webgl');
    if (!gl) {
      console.error('WebGL not supported');
      return;
    }

    glRef.current = gl;

    // Set canvas size
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);

    // Vertex shader source
    const vertexShaderSource = `
      attribute vec3 a_position;
      attribute vec3 a_normal;
      uniform mat4 u_matrix;
      varying vec3 v_normal;
      varying vec3 v_position;

      void main() {
        gl_Position = u_matrix * vec4(a_position, 1.0);
        v_normal = a_normal;
        v_position = a_position;
      }
    `;

    // Fragment shader source
    const fragmentShaderSource = `
      precision mediump float;
      varying vec3 v_normal;
      varying vec3 v_position;

      void main() {
        vec3 normal = normalize(v_normal);
        vec3 lightDir = normalize(vec3(1.0, 1.0, 1.0));
        float dotProduct = max(dot(normal, lightDir), 0.2);
        gl_FragColor = vec4(dotProduct, dotProduct, dotProduct, 1.0);
      }
    `;

    // Compile shader
    const compileShader = (
      gl: WebGLRenderingContext,
      type: number,
      source: string
    ): WebGLShader | null => {
      const shader = gl.createShader(type);
      if (!shader) return null;

      gl.shaderSource(shader, source);
      gl.compileShader(shader);

      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(
          'Shader compilation error:',
          gl.getShaderInfoLog(shader)
        );
        gl.deleteShader(shader);
        return null;
      }

      return shader;
    };

    // Create shader program
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = compileShader(
      gl,
      gl.FRAGMENT_SHADER,
      fragmentShaderSource
    );

    if (!vertexShader || !fragmentShader) return;

    const program = gl.createProgram();
    if (!program) return;

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program linking error:', gl.getProgramInfoLog(program));
      return;
    }

    gl.useProgram(program);

    // Get attribute and uniform locations
    const positionLocation = gl.getAttribLocation(program, 'a_position');
    const normalLocation = gl.getAttribLocation(program, 'a_normal');
    const matrixLocation = gl.getUniformLocation(program, 'u_matrix');

    // Collect all vertices from meshes
    const allVertices: Vertex[] = [];
    const allIndices: number[] = [];
    let indexOffset = 0;

    for (const mesh of scene.meshes) {
      for (const face of mesh.faces) {
        for (const index of face.indices) {
          if (mesh.vertices[index]) {
            allVertices.push(mesh.vertices[index]);
            allIndices.push(indexOffset + index);
          }
        }
      }
      indexOffset += mesh.vertices.length;
    }

    // Create buffers
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    const positions = new Float32Array(
      allVertices.flatMap((v) => [v.position.x, v.position.y, v.position.z])
    );
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    const normals = new Float32Array(
      allVertices.flatMap((v) =>
        v.normal
          ? [v.normal.x, v.normal.y, v.normal.z]
          : [0, 0, 0]
      )
    );
    gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);

    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(
      gl.ELEMENT_ARRAY_BUFFER,
      new Uint16Array(allIndices),
      gl.STATIC_DRAW
    );

    // Calculate bounding box and scale
    const calculateBounds = (vertices: Vertex[]) => {
      if (vertices.length === 0) return null;

      let minX = Infinity,
        minY = Infinity,
        minZ = Infinity;
      let maxX = -Infinity,
        maxY = -Infinity,
        maxZ = -Infinity;

      for (const vertex of vertices) {
        minX = Math.min(minX, vertex.position.x);
        minY = Math.min(minY, vertex.position.y);
        minZ = Math.min(minZ, vertex.position.z);
        maxX = Math.max(maxX, vertex.position.x);
        maxY = Math.max(maxY, vertex.position.y);
        maxZ = Math.max(maxZ, vertex.position.z);
      }

      return { minX, minY, minZ, maxX, maxY, maxZ };
    };

    const bounds = calculateBounds(allVertices);
    if (!bounds) return;

    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const centerZ = (bounds.minZ + bounds.maxZ) / 2;

    const sizeX = bounds.maxX - bounds.minX;
    const sizeY = bounds.maxY - bounds.minY;
    const sizeZ = bounds.maxZ - bounds.minZ;
    const maxSize = Math.max(sizeX, sizeY, sizeZ);
    const scale = maxSize > 0 ? 2 / maxSize : 1;

    // Create transformation matrix (orthographic projection with simple rotation)
    const createMatrix = (angleX: number, angleY: number) => {
      // Simple rotation matrices
      const cosX = Math.cos(angleX);
      const sinX = Math.sin(angleX);
      const cosY = Math.cos(angleY);
      const sinY = Math.sin(angleY);

      // Rotation around Y axis, then X axis
      return new Float32Array([
        cosY * scale,
        sinX * sinY * scale,
        -cosX * sinY * scale,
        0,
        0,
        cosX * scale,
        sinX * scale,
        0,
        sinY * scale,
        -sinX * cosY * scale,
        cosX * cosY * scale,
        0,
        -centerX * cosY * scale + centerZ * sinY * scale,
        -centerY * cosX * scale -
          centerX * sinX * sinY * scale -
          centerZ * sinX * cosY * scale,
        -centerZ * cosX * cosY * scale -
          centerX * cosX * sinY * scale -
          centerY * sinX * scale,
        1,
      ]);
    };

    // Render function
    const render = () => {
      gl.clearColor(0.1, 0.1, 0.1, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);

      // Set up attributes
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
      gl.enableVertexAttribArray(normalLocation);
      gl.vertexAttribPointer(normalLocation, 3, gl.FLOAT, false, 0, 0);

      // Default view (can be extended for 14-angle camera)
      const matrix = createMatrix(0.5, 0.5);
      gl.uniformMatrix4fv(matrixLocation, false, matrix);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.drawElements(gl.TRIANGLES, allIndices.length, gl.UNSIGNED_SHORT, 0);
    };

    render();
  }, [scene]);

  return (
    <div className="viewer-3d">
      <h2>3D Viewer</h2>
      <div className="viewer-stats">
        <p>Vertices: {scene.metadata.vertexCount}</p>
        <p>Faces: {scene.metadata.faceCount}</p>
        <p>Format: {scene.metadata.format}</p>
      </div>
      <canvas ref={canvasRef} className="viewer-canvas" />
    </div>
  );
};

export default Viewer3D;
