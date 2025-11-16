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
  const [renderMode, setRenderMode] = React.useState<'wireframe' | 'normal'>('wireframe');

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

    // --- CORRECTED Shaders with proper coordinate spaces ---
    const vertexShaderSource = `
      attribute vec3 a_position;
      attribute vec3 a_normal;
      
      uniform mat4 u_modelMatrix;
      uniform mat4 u_viewMatrix;
      uniform mat4 u_projectionMatrix;
      uniform mat4 u_normalMatrix;
      
      varying vec3 v_normal;
      varying vec3 v_position;
      
      void main() {
        vec4 worldPosition = u_modelMatrix * vec4(a_position, 1.0);
        vec4 viewPosition = u_viewMatrix * worldPosition;
        v_position = viewPosition.xyz;
        gl_Position = u_projectionMatrix * viewPosition;
        v_normal = mat3(u_normalMatrix) * a_normal;
      }
    `;

    const fragmentShaderSource = `
      precision mediump float;
      varying vec3 v_normal;
      varying vec3 v_position;
      
      void main() {
        vec3 normal = normalize(v_normal);
        vec3 lightDir = normalize(vec3(1.0, 1.0, 1.0));
        vec3 viewDir = normalize(-v_position);
        
        float ambient = 0.3;
        float diffuse = max(dot(normal, lightDir), 0.0);
        vec3 halfDir = normalize(lightDir + viewDir);
        float specular = pow(max(dot(normal, halfDir), 0.0), 32.0) * 0.4;
        
        float light = ambient + diffuse + specular;
        vec3 baseColor = vec3(0.75, 0.78, 0.82);
        gl_FragColor = vec4(baseColor * light, 1.0);
      }
    `;

    const edgeVertexSource = `
      attribute vec3 a_position;
      uniform mat4 u_modelViewProjectionMatrix;
      void main() {
        gl_Position = u_modelViewProjectionMatrix * vec4(a_position, 1.0);
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
    const modelMatrixLoc = gl.getUniformLocation(triProgram, 'u_modelMatrix')!;
    const viewMatrixLoc = gl.getUniformLocation(triProgram, 'u_viewMatrix')!;
    const projectionMatrixLoc = gl.getUniformLocation(triProgram, 'u_projectionMatrix')!;
    const normalMatrixLoc = gl.getUniformLocation(triProgram, 'u_normalMatrix')!;

    const edgePosLoc = gl.getAttribLocation(edgeProgram, 'a_position');
    const edgeMVP = gl.getUniformLocation(edgeProgram, 'u_modelViewProjectionMatrix')!;
    const edgeColorLoc = gl.getUniformLocation(edgeProgram, 'u_color')!;

    // --- Vertex processing ---
    const allVertices: Vertex[] = [];
    const allIndices: number[] = [];
    const edgeSet = new Set<string>();
    const edgeIndices: number[] = [];

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

    const normalize = (v: { x: number; y: number; z: number }) => {
      const length = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
      if (length > 0) {
        return { x: v.x / length, y: v.y / length, z: v.z / length };
      }
      return { x: 0, y: 1, z: 0 };
    };

    if (!hasValidNormals) {
      console.log('Recalculating vertex normals...');
      
      const vertexNormals: { [key: number]: { x: number; y: number; z: number } } = {};
      const vertexFaces: { [key: number]: number } = {};
      
      let globalIndex = 0;
      for (const mesh of scene.meshes) {
        const vertexOffset = allVertices.length;
        allVertices.push(...mesh.vertices.map(v => ({ ...v })));
        
        for (let i = 0; i < mesh.vertices.length; i++) {
          const globalVertexIndex = vertexOffset + i;
          vertexNormals[globalVertexIndex] = { x: 0, y: 0, z: 0 };
          vertexFaces[globalVertexIndex] = 0;
        }
        
        for (const face of mesh.faces) {
          if (face.indices.length < 3) continue;
          
          for (let i = 1; i < face.indices.length - 1; i++) {
            const idx1 = face.indices[0] + vertexOffset;
            const idx2 = face.indices[i] + vertexOffset;
            const idx3 = face.indices[i + 1] + vertexOffset;
            
            const v1 = allVertices[idx1];
            const v2 = allVertices[idx2];
            const v3 = allVertices[idx3];
            
            const faceNormal = calculateFaceNormal(v1, v2, v3);
            
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
      
      for (let i = 0; i < allVertices.length; i++) {
        if (vertexFaces[i] > 0) {
          const normal = vertexNormals[i];
          normal.x /= vertexFaces[i];
          normal.y /= vertexFaces[i];
          normal.z /= vertexFaces[i];
          allVertices[i] = { ...allVertices[i], normal: normalize(normal) };
        } else {
          allVertices[i] = { ...allVertices[i], normal: { x: 0, y: 1, z: 0 } };
        }
      }
      
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

    // Matrix utilities
    const mat4 = {
      create: (): Float32Array => new Float32Array(16),
      
      identity: (out: Float32Array): Float32Array => {
        out.set([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
        return out;
      },
      
      perspective: (out: Float32Array, fov: number, aspect: number, near: number, far: number): Float32Array => {
        const f = 1.0 / Math.tan(fov / 2);
        const nf = 1 / (near - far);
        out[0] = f / aspect;
        out[1] = 0;
        out[2] = 0;
        out[3] = 0;
        out[4] = 0;
        out[5] = f;
        out[6] = 0;
        out[7] = 0;
        out[8] = 0;
        out[9] = 0;
        out[10] = (far + near) * nf;
        out[11] = -1;
        out[12] = 0;
        out[13] = 0;
        out[14] = (2 * far * near) * nf;
        out[15] = 0;
        return out;
      },
      
      lookAt: (out: Float32Array, eye: number[], center: number[], up: number[]): Float32Array => {
        const [ex, ey, ez] = eye;
        const [cx, cy, cz] = center;
        const [ux, uy, uz] = up;
        
        const fx = cx - ex;
        const fy = cy - ey;
        const fz = cz - ez;
        const flen = Math.sqrt(fx*fx + fy*fy + fz*fz);
        const f = [fx/flen, fy/flen, fz/flen];
        
        const sx = f[1] * uz - f[2] * uy;
        const sy = f[2] * ux - f[0] * uz;
        const sz = f[0] * uy - f[1] * ux;
        const slen = Math.sqrt(sx*sx + sy*sy + sz*sz);
        const s = [sx/slen, sy/slen, sz/slen];
        
        const u = [
          s[1] * f[2] - s[2] * f[1],
          s[2] * f[0] - s[0] * f[2],
          s[0] * f[1] - s[1] * f[0]
        ];
        
        out[0] = s[0];
        out[1] = u[0];
        out[2] = -f[0];
        out[3] = 0;
        out[4] = s[1];
        out[5] = u[1];
        out[6] = -f[1];
        out[7] = 0;
        out[8] = s[2];
        out[9] = u[2];
        out[10] = -f[2];
        out[11] = 0;
        out[12] = -(s[0]*ex + s[1]*ey + s[2]*ez);
        out[13] = -(u[0]*ex + u[1]*ey + u[2]*ez);
        out[14] = f[0]*ex + f[1]*ey + f[2]*ez;
        out[15] = 1;
        
        return out;
      },
      
      multiply: (out: Float32Array, a: Float32Array, b: Float32Array): Float32Array => {
        const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
        const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
        const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
        const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
        const b00 = b[0], b01 = b[1], b02 = b[2], b03 = b[3];
        const b10 = b[4], b11 = b[5], b12 = b[6], b13 = b[7];
        const b20 = b[8], b21 = b[9], b22 = b[10], b23 = b[11];
        const b30 = b[12], b31 = b[13], b32 = b[14], b33 = b[15];
        
        out[0] = b00 * a00 + b01 * a10 + b02 * a20 + b03 * a30;
        out[1] = b00 * a01 + b01 * a11 + b02 * a21 + b03 * a31;
        out[2] = b00 * a02 + b01 * a12 + b02 * a22 + b03 * a32;
        out[3] = b00 * a03 + b01 * a13 + b02 * a23 + b03 * a33;
        out[4] = b10 * a00 + b11 * a10 + b12 * a20 + b13 * a30;
        out[5] = b10 * a01 + b11 * a11 + b12 * a21 + b13 * a31;
        out[6] = b10 * a02 + b11 * a12 + b12 * a22 + b13 * a32;
        out[7] = b10 * a03 + b11 * a13 + b12 * a23 + b13 * a33;
        out[8] = b20 * a00 + b21 * a10 + b22 * a20 + b23 * a30;
        out[9] = b20 * a01 + b21 * a11 + b22 * a21 + b23 * a31;
        out[10] = b20 * a02 + b21 * a12 + b22 * a22 + b23 * a32;
        out[11] = b20 * a03 + b21 * a13 + b22 * a23 + b23 * a33;
        out[12] = b30 * a00 + b31 * a10 + b32 * a20 + b33 * a30;
        out[13] = b30 * a01 + b31 * a11 + b32 * a21 + b33 * a31;
        out[14] = b30 * a02 + b31 * a12 + b32 * a22 + b33 * a32;
        out[15] = b30 * a03 + b31 * a13 + b32 * a23 + b33 * a33;
        
        return out;
      },
      
      translation: (out: Float32Array, x: number, y: number, z: number): Float32Array => {
        out.set([1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1]);
        return out;
      },
      
      rotationX: (out: Float32Array, angle: number): Float32Array => {
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        out.set([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]);
        return out;
      },
      
      rotationY: (out: Float32Array, angle: number): Float32Array => {
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        out.set([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]);
        return out;
      },
      
      scaling: (out: Float32Array, x: number, y: number, z: number): Float32Array => {
        out.set([x,0,0,0, 0,y,0,0, 0,0,z,0, 0,0,0,1]);
        return out;
      },
      
      normalFromMat4: (out: Float32Array, a: Float32Array): Float32Array => {
        const a00 = a[0], a01 = a[1], a02 = a[2];
        const a10 = a[4], a11 = a[5], a12 = a[6];
        const a20 = a[8], a21 = a[9], a22 = a[10];
        
        const det = a00 * (a11 * a22 - a12 * a21)
                 - a01 * (a10 * a22 - a12 * a20)
                 + a02 * (a10 * a21 - a11 * a20);
        
        if (det === 0) {
          out.set([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
          return out;
        }
        
        const invDet = 1.0 / det;
        
        out[0] = (a11 * a22 - a12 * a21) * invDet;
        out[1] = (a02 * a21 - a01 * a22) * invDet;
        out[2] = (a01 * a12 - a02 * a11) * invDet;
        out[3] = 0;
        out[4] = (a12 * a20 - a10 * a22) * invDet;
        out[5] = (a00 * a22 - a02 * a20) * invDet;
        out[6] = (a02 * a10 - a00 * a12) * invDet;
        out[7] = 0;
        out[8] = (a10 * a21 - a11 * a20) * invDet;
        out[9] = (a01 * a20 - a00 * a21) * invDet;
        out[10] = (a00 * a11 - a01 * a10) * invDet;
        out[11] = 0;
        out[12] = 0;
        out[13] = 0;
        out[14] = 0;
        out[15] = 1;
        
        return out;
      }
    };

    const createMatrices = (angleX: number, angleY: number, zoom: number) => {
      const aspect = canvas.width / canvas.height;
      
      const projection = mat4.create();
      mat4.perspective(projection, Math.PI / 4, aspect, 0.1, 100.0);
      
      const view = mat4.create();
      const cameraDistance = 5.0 / zoom;
      const eye = [
        cameraDistance * Math.sin(angleY) * Math.cos(angleX),
        cameraDistance * Math.sin(angleX),
        cameraDistance * Math.cos(angleY) * Math.cos(angleX)
      ];
      mat4.lookAt(view, eye, [0, 0, 0], [0, 1, 0]);
      
      const model = mat4.create();
      const scale = baseScale * zoom;
      mat4.translation(model, -center.x, -center.y, -center.z);
      
      const rotX = mat4.create();
      const rotY = mat4.create();
      const scaleM = mat4.create();
      
      mat4.rotationX(rotX, angleX);
      mat4.rotationY(rotY, angleY);
      mat4.scaling(scaleM, scale, scale, scale);
      
      const temp = mat4.create();
      mat4.multiply(temp, scaleM, rotY);
      mat4.multiply(temp, temp, rotX);
      mat4.multiply(model, temp, model);
      
      const modelView = mat4.create();
      mat4.multiply(modelView, view, model);
      
      const normalMatrix = mat4.create();
      mat4.normalFromMat4(normalMatrix, modelView);
      
      const mvp = mat4.create();
      mat4.multiply(mvp, projection, modelView);
      
      return { projection, view, model, modelView, normalMatrix, mvp };
    };

    const render = () => {
      gl.clearColor(0.53, 0.81, 0.92, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);

      const { x: angleX, y: angleY } = rotationRef.current;
      const matrices = createMatrices(angleX, angleY, zoomRef.current);

      if (renderMode === 'wireframe') {
        gl.useProgram(triProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.vertexAttribPointer(positionLoc, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(positionLoc);

        gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
        gl.vertexAttribPointer(normalLoc, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(normalLoc);

        gl.uniformMatrix4fv(modelMatrixLoc, false, matrices.model);
        gl.uniformMatrix4fv(viewMatrixLoc, false, matrices.view);
        gl.uniformMatrix4fv(projectionMatrixLoc, false, matrices.projection);
        gl.uniformMatrix4fv(normalMatrixLoc, false, matrices.normalMatrix);
        
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.drawElements(gl.TRIANGLES, allIndices.length, indexType, 0);

      } else {
        gl.useProgram(edgeProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.vertexAttribPointer(edgePosLoc, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(edgePosLoc);

        gl.uniformMatrix4fv(edgeMVP, false, matrices.mvp);
        gl.uniform4fv(edgeColorLoc, new Float32Array([0.0, 0.0, 0.0, 1.0]));

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, edgeIndexBuffer);
        gl.drawElements(gl.LINES, edgeIndices.length, indexType, 0);
      }
    };

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
    background: 'rgba(0,0,0,0.2)',
    pointerEvents: 'auto',
    zIndex: 10,
  };
  
  const gridBtnStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    borderRadius: '4px',
    background: 'rgba(255,255,255,0.8)',
    border: 'none',
    cursor: 'pointer',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    fontSize: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 'bold',
    padding: '1px',
    transition: 'all 0.2s',
  };

  const resetBtnStyle: React.CSSProperties = {
    ...gridBtnStyle,
    background: 'rgba(59,130,246,0.7)',
    color: 'white',
  };

  const viewControlsStyle: React.CSSProperties = {
    position: 'absolute',
    top: 12,
    right: 120,
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    zIndex: 10,
  };

  const viewBtnStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.8)',
    border: '1px solid rgba(0,0,0,0.1)',
    borderRadius: '4px',
    padding: '6px 10px',
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: 500,
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    transition: 'all 0.2s',
  };

  const renderModeBtnStyle: React.CSSProperties = {
    ...viewBtnStyle,
    background: renderMode === 'wireframe' ? 'rgba(59,130,246,0.7)' : 'rgba(107,114,128,0.7)',
    color: 'white',
    marginBottom: '4px',
  };

  return (
    <div className="viewer-3d">
      <h2>3D Viewer</h2>
      <div className="viewer-layout">
        <div className="viewer-left" style={{ position: 'relative' }}>
          <canvas ref={canvasRef} className="viewer-canvas" style={{ width: '100%', height: '480px', display: 'block' }} />
          
          <div style={viewControlsStyle}>
            <button 
              style={renderModeBtnStyle}
              onClick={() => setRenderMode(m => m === 'normal' ? 'wireframe' : 'normal')}
            >
              {renderMode === 'wireframe' ? 'normal' : 'wireframe'}
            </button>
          </div>

          <div style={gridStyle}>
            <button style={gridBtnStyle} onClick={() => setView('top-back-left')} title="Top Back Left">TBL</button>
            <button style={gridBtnStyle} onClick={() => setView('top')} title="Top">T</button>
            <button style={gridBtnStyle} onClick={() => setView('top-back-right')} title="Top Back Right">TBR</button>
            
            <button style={gridBtnStyle} onClick={() => setView('left')} title="Left">L</button>
            <button style={resetBtnStyle} onClick={resetCamera} title="Reset">●</button>
            <button style={gridBtnStyle} onClick={() => setView('right')} title="Right">R</button>
            
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