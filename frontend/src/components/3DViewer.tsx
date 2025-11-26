import React, { useEffect, useRef, useState } from 'react';
import type { Scene, Vertex } from '../types/scene';
import { Result, Ok, Err } from '../../../shared/utils/result';

interface Viewer3DProps {
  scene: Scene;
}

const Viewer3D: React.FC<Viewer3DProps> = ({ scene }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const [targetFormat, setTargetFormat] = useState<"OBJ" | "PLY" | "glTF" | "STL" | null>(null);
  const [convertedBlob, setConvertedBlob] = useState<Blob | null>(null);
  const [isConverting, setIsConverting] = useState(false);

  // camera state
  const zoomRef = useRef(1.0);
  const rotationRef = useRef({ x: 0.5, y: 0.5 });
  const isDraggingRef = useRef(false);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  const [renderMode, setRenderMode] = useState<'wireframe' | 'normal'>('normal');

  // predefined views All
  const predefinedViews = {
    front: { x: 0, y: 0 },
    back: { x: 0, y: Math.PI },
    right: { x: 0, y: Math.PI / 2 },
    left: { x: 0, y: -Math.PI / 2 },
    top: { x: Math.PI / 2, y: 0 },
    bottom: { x: -Math.PI / 2, y: 0 },

    'top-front-right': { x: Math.PI / 4, y: Math.PI / 4 },
    'top-front-left': { x: Math.PI / 4, y: -Math.PI / 4 },
    'top-back-right': { x: Math.PI / 4, y: 3 * Math.PI / 4 },
    'top-back-left': { x: Math.PI / 4, y: -3 * Math.PI / 4 },

    'front-right': { x: 0, y: Math.PI / 4 },
    'front-left': { x: 0, y: -Math.PI / 4 },
    'top-right': { x: Math.PI / 4, y: Math.PI / 2 },
    'top-left': { x: Math.PI / 4, y: -Math.PI / 2 },
  } as const;

  // Reset format when new scene is loaded
  useEffect(() => {
    setTargetFormat(null);
    setConvertedBlob(null);
  }, [scene]);

  const performConversion = async (): Promise<Result<Blob, string>> => {
    console.log("performConversion() called with targetFormat:", targetFormat);

    if (!targetFormat) {
      console.warn("performConversion(): no targetFormat selected");
      return Err("No target format selected");
    }

    console.log("Sending fetch request to backend...");

    const response = await fetch(
      `http://localhost:3001/api/convert/${targetFormat.toLowerCase()}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scene),
      }
    ).catch((err) => {
      console.error("Network error:", err);
      return null;
    });

    if (!response) {
      console.error("No response received (network error)");
      return Err("Network error");
    }

    console.log("Response received, status:", response.status);

    if (!response.ok) {
      const text = await response.text();
      console.error("Server returned error:", text);
      return Err(text);
    }

    console.log("Server returned OK, reading blob...");
    const blob = await response.blob();
    setConvertedBlob(blob); // still cache for reference
    return Ok(blob);
  };

  const downloadConvertedFile = () => {
    console.log("downloadConvertedFile() called");

    if (!convertedBlob || !targetFormat) {
      console.error("Download aborted: missing blob or format:", {
        convertedBlob,
        targetFormat
      });
      return;
    }

    console.log("Creating file:", `converted.${targetFormat.toLowerCase()}`);

    const url = URL.createObjectURL(convertedBlob);
    console.log("Object URL created:", url);

    const a = document.createElement("a");
    a.href = url;
    a.download = `converted.${targetFormat.toLowerCase()}`;
    a.click();

    URL.revokeObjectURL(url);
    console.log("Download triggered & URL revoked");
  };
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // make container positioned for overlays
    const parent = canvas.parentElement;
    if (parent) parent.style.position = parent.style.position || 'relative';

    const gl = canvas.getContext('webgl');
    if (!gl) {
      console.error('WebGL not supported');
      return;
    }
    glRef.current = gl;

    // --- shaders (model/view/proj, normal matrix) ---
    const vertexShaderSource = `
      attribute vec3 a_position;
      attribute vec3 a_normal;
      uniform mat4 u_modelMatrix;
      uniform mat4 u_viewMatrix;
      uniform mat4 u_projectionMatrix;
      uniform mat4 u_normalMatrix;
      varying vec3 v_normal;
      varying vec3 v_worldPos;
      void main() {
        vec4 worldPos = u_modelMatrix * vec4(a_position, 1.0);
        v_worldPos = worldPos.xyz;
        v_normal = mat3(u_normalMatrix) * a_normal;
        gl_Position = u_projectionMatrix * u_viewMatrix * worldPos;
      }
    `;
    const fragmentShaderSource = `
      precision mediump float;
      varying vec3 v_normal;
      varying vec3 v_worldPos;
      uniform vec3 u_cameraPos;
      uniform float u_groundY;
      uniform vec3 u_lightDir;
      void main() {
        vec3 N = normalize(v_normal);
        vec3 L = normalize(u_lightDir);
        vec3 V = normalize(u_cameraPos - v_worldPos);
        float ambient = 0.18;
        float diff = max(dot(N, L), 0.0);
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 32.0) * 0.4;
        vec3 base = vec3(0.75, 0.78, 0.82);
        float height = v_worldPos.y - u_groundY;
        float heightFactor = exp(-max(0.0, height) * 6.0);
        float facing = 1.0 - smoothstep(0.0, 0.6, max(dot(N, L), 0.0));
        float shadowFactor = clamp(heightFactor * facing, 0.0, 1.0);
        float shadowStrength = 0.55;
        vec3 color = base * (ambient + diff * (1.0 - shadowStrength * shadowFactor)) + spec * (1.0 - 0.3 * shadowFactor);
        color = pow(color, vec3(1.0/1.1));
        gl_FragColor = vec4(color, 1.0);
      }
    `;
    const wireframeVertexSource = `
      attribute vec3 a_position;
      uniform mat4 u_modelViewProj;
      void main() {
        gl_Position = u_modelViewProj * vec4(a_position, 1.0);
      }
    `;
    const wireframeFragmentSource = `
      precision mediump float;
      void main() {
        gl_FragColor = vec4(0.2, 0.5, 0.9, 1.0);
      }
    `;
    const edgeVertexSource = `
      attribute vec3 a_position;
      uniform mat4 u_modelViewProj;
      void main() {
        gl_Position = u_modelViewProj * vec4(a_position, 1.0);
      }
    `;
    const edgeFragmentSource = `
      precision mediump float;
      uniform vec4 u_color;
      void main() { gl_FragColor = u_color; }
    `;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(sh));
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    };

    const linkProgram = (vsSrc: string, fsSrc: string) => {
      const vs = compile(gl.VERTEX_SHADER, vsSrc);
      const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
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

    const triProgram = linkProgram(vertexShaderSource, fragmentShaderSource)!;
    const edgeProgram = linkProgram(edgeVertexSource, edgeFragmentSource)!;
    const wireframeProgram = linkProgram(wireframeVertexSource, wireframeFragmentSource)!;

    // attribute/uniform locations
    const posLoc = gl.getAttribLocation(triProgram, 'a_position');
    const nrmLoc = gl.getAttribLocation(triProgram, 'a_normal');
    const modelLoc = gl.getUniformLocation(triProgram, 'u_modelMatrix')!;
    const viewLoc = gl.getUniformLocation(triProgram, 'u_viewMatrix')!;
    const projLoc = gl.getUniformLocation(triProgram, 'u_projectionMatrix')!;
    const normalLoc = gl.getUniformLocation(triProgram, 'u_normalMatrix')!;
    const camPosLoc = gl.getUniformLocation(triProgram, 'u_cameraPos')!;
    const groundYLoc = gl.getUniformLocation(triProgram, 'u_groundY')!;
    const lightDirLoc = gl.getUniformLocation(triProgram, 'u_lightDir')!;

    const edgePosLoc = gl.getAttribLocation(edgeProgram, 'a_position');
    const edgeMvpLoc = gl.getUniformLocation(edgeProgram, 'u_modelViewProj')!;
    const edgeColorLoc = gl.getUniformLocation(edgeProgram, 'u_color')!;

    const wirePosLoc = gl.getAttribLocation(wireframeProgram, 'a_position');
    const wireMvpLoc = gl.getUniformLocation(wireframeProgram, 'u_modelViewProj')!;

    // --- collect vertices / indices / edges ---
    const allVertices: Vertex[] = [];
    const triIndices: number[] = [];
    const edgeSet = new Set<string>();
    const edgeIndices: number[] = [];

    // accumulate vertices and faces, preserve shared indices
    let vertexOffset = 0;
    for (const mesh of scene.meshes) {
      allVertices.push(...mesh.vertices.map(v => ({ ...v })));
      for (const face of mesh.faces) {
        if (face.indices.length < 3) continue;
        // triangulate polygon faces
        for (let i = 1; i < face.indices.length - 1; i++) {
          triIndices.push(vertexOffset + face.indices[0], vertexOffset + face.indices[i], vertexOffset + face.indices[i + 1]);
        }
        // build unique undirected edges
        const n = face.indices.length;
        for (let i = 0; i < n; i++) {
          const a = vertexOffset + face.indices[i];
          const b = vertexOffset + face.indices[(i + 1) % n];
          const key = a < b ? `${a}_${b}` : `${b}_${a}`;
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            edgeIndices.push(a, b);
          }
        }
      }
      vertexOffset += mesh.vertices.length;
    }

    if (!allVertices.length) return;

    // choose index array type (support big meshes via extension)
    const maxIndex = Math.max(...triIndices, ...edgeIndices);
    let IndexArrayCtor: typeof Uint16Array | typeof Uint32Array = Uint16Array;
    let indexGLType = gl.UNSIGNED_SHORT;
    if (maxIndex > 65535) {
      const ext = gl.getExtension('OES_element_index_uint');
      if (!ext) {
        console.warn('Model > 65535 vertices and OES_element_index_uint not available — indices will overflow.');
      } else {
        IndexArrayCtor = Uint32Array;
        indexGLType = (gl as any).UNSIGNED_INT;
      }
    }

    // --- GL buffers ---
    const posBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(allVertices.flatMap(v => [v.position.x, v.position.y, v.position.z])), gl.STATIC_DRAW);

    const nrmBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuf);
    // ensure normals exist: default up vector if missing
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(allVertices.flatMap(v => v.normal ? [v.normal.x, v.normal.y, v.normal.z] : [0, 1, 0])), gl.STATIC_DRAW);

    const triIbuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, triIbuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new IndexArrayCtor(triIndices), gl.STATIC_DRAW);

    const edgeIbuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, edgeIbuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new IndexArrayCtor(edgeIndices), gl.STATIC_DRAW);

    // compute bounds + model matrix (center + uniform scale)
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const v of allVertices) {
      minX = Math.min(minX, v.position.x); minY = Math.min(minY, v.position.y); minZ = Math.min(minZ, v.position.z);
      maxX = Math.max(maxX, v.position.x); maxY = Math.max(maxY, v.position.y); maxZ = Math.max(maxZ, v.position.z);
    }
    const center = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
    const sizeX = maxX - minX, sizeY = maxY - minY, sizeZ = maxZ - minZ;
    const maxSize = Math.max(sizeX, sizeY, sizeZ) || 1;
    const baseScale = 2 / maxSize;

    // small matrix helpers (column-major for WebGL)
    const mat4_identity = () => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
    const mat4_mul = (a: Float32Array, b: Float32Array) => {
      const out = new Float32Array(16);
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k*4 + r] * b[c*4 + k];
        out[c*4 + r] = s;
      }
      return out;
    };
    const mat4_translation = (tx: number, ty: number, tz: number) => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, tx,ty,tz,1]);
    const mat4_scale = (s: number) => new Float32Array([s,0,0,0, 0,s,0,0, 0,0,s,0, 0,0,0,1]);
    const mat4_rotateX = (a: number) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]); };
    const mat4_rotateY = (a: number) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]); };
    const mat4_inverse_transpose_upper3 = (m: Float32Array) => {
      // compute inverse-transpose of upper-left 3x3; for modelView only approximate for uniform scale/rotations works
      // Here compute normal matrix as inverse-transpose of modelView (4x4) but pack into 4x4 with last row/col identity.
      // For correctness we compute 3x3 inverse by cofactors.
      const a00 = m[0], a01 = m[4], a02 = m[8];
      const a10 = m[1], a11 = m[5], a12 = m[9];
      const a20 = m[2], a21 = m[6], a22 = m[10];
      const c00 = a11*a22 - a12*a21;
      const c01 = a02*a21 - a01*a22;
      const c02 = a01*a12 - a02*a11;
      const c10 = a12*a20 - a10*a22;
      const c11 = a00*a22 - a02*a20;
      const c12 = a02*a10 - a00*a12;
      const c20 = a10*a21 - a11*a20;
      const c21 = a01*a20 - a00*a21;
      const c22 = a00*a11 - a01*a10;
      // scale by 1/det not done (ok for rotation+uniform scale); keep it simple
      return new Float32Array([c00, c10, c20, 0, c01, c11, c21, 0, c02, c12, c22, 0, 0,0,0,1]);
    };

    // camera matrices builder
    const createMatrices = (angleX: number, angleY: number, zoom: number) => {
      // projection (perspective)
      const aspect = (canvas.width || 1) / (canvas.height || 1);
      const fovy = Math.PI / 4;
      const f = 1.0 / Math.tan(fovy / 2);
      const znear = 0.01, zfar = 100.0;
      const proj = new Float32Array(16);
      proj[0] = f / aspect; proj[5] = f; proj[10] = (zfar + znear) / (znear - zfar); proj[11] = -1;
      proj[14] = (2 * zfar * znear) / (znear - zfar);

      // compute a framing distance so mesh is always in view (uses baseScale -> scaled radius ~= 1)
      const scaledRadius = 1.0; // model is scaled so largest half-size becomes ~1
      const framing = 2.5; // multiplier; tweak to zoom tighter/looser
      const camDist = (framing * scaledRadius) / Math.max(0.0001, zoom);

      // camera position on sphere (camera orbits the mesh; model is NOT rotated)
      const ex = camDist * Math.sin(angleY) * Math.cos(angleX);
      const ey = camDist * Math.sin(angleX);
      const ez = camDist * Math.cos(angleY) * Math.cos(angleX);
      const eye = [ex, ey, ez];

      // camera looks at origin (mesh was translated to origin via model matrix)
      const centerPt = [0, 0, 0];
      const up = [0, 1, 0];

      // view matrix (lookAt) - column-major
      const fx = centerPt[0] - eye[0], fy = centerPt[1] - eye[1], fz = centerPt[2] - eye[2];
      let rlf = Math.hypot(fx, fy, fz) || 1.0;
      const fnx = fx / rlf, fny = fy / rlf, fnz = fz / rlf;
      const sx = fny * up[2] - fnz * up[1];
      const sy = fnz * up[0] - fnx * up[2];
      const sz = fnx * up[1] - fny * up[0];
      let rls = Math.hypot(sx, sy, sz) || 1.0;
      const snx = sx / rls, sny = sy / rls, snz = sz / rls;
      const ux = sny * fnz - snz * fny;
      const uy = snz * fnx - snx * fnz;
      const uz = snx * fny - sny * fnx;

      const view = new Float32Array([
        snx, ux, -fnx, 0,
        sny, uy, -fny, 0,
        snz, uz, -fnz, 0,
        -(snx * eye[0] + sny * eye[1] + snz * eye[2]),
        -(ux * eye[0] + uy * eye[1] + uz * eye[2]),
        (fnx * eye[0] + fny * eye[1] + fnz * eye[2]),
        1
      ]);

      // model = translate(-center) then uniform scale (no rotation on model).
      // keeping the mesh transform stable ensures switching camera angles doesn't modify the object itself
      const T = mat4_translation(-center[0], -center[1], -center[2]);
      const S = mat4_scale(baseScale);
      // apply translation first, then scale: M = S * T
      let M = mat4_mul(S, T);

      // modelView for normals and normal matrix
      const modelView = mat4_mul(view, M);
      const normalMat = mat4_inverse_transpose_upper3(modelView);

      // modelViewProjection for edge/wire shaders
      const mvp = mat4_mul(proj, mat4_mul(view, M));

      return { proj, view, model: M, modelView, normalMat, mvp, cameraPos: eye };
    };

    // render loop
    const render = () => {
      if (!gl) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.53, 0.81, 0.92, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);

      const { x: angleX, y: angleY } = rotationRef.current;
      const mats = createMatrices(angleX, angleY, zoomRef.current);

     if (renderMode === 'normal') {
       // draw triangles (solid) with soft shadows
       gl.useProgram(triProgram);
       gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
       gl.enableVertexAttribArray(posLoc);
       gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);

       gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuf);
       gl.enableVertexAttribArray(nrmLoc);
       gl.vertexAttribPointer(nrmLoc, 3, gl.FLOAT, false, 0, 0);

       gl.uniformMatrix4fv(modelLoc, false, mats.model);
       gl.uniformMatrix4fv(viewLoc, false, mats.view);
       gl.uniformMatrix4fv(projLoc, false, mats.proj);
       gl.uniformMatrix4fv(normalLoc, false, mats.normalMat);
       gl.uniform3fv(camPosLoc, new Float32Array(mats.cameraPos));
       gl.uniform1f(groundYLoc, minY);
       const light = [1.0, 1.0, 0.8];
       const Llen = Math.hypot(light[0], light[1], light[2]) || 1.0;
       gl.uniform3fv(lightDirLoc, new Float32Array([light[0]/Llen, light[1]/Llen, light[2]/Llen]));

       gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, triIbuf);
       gl.drawElements(gl.TRIANGLES, triIndices.length, indexGLType, 0);

       // draw edges on top
       gl.useProgram(edgeProgram);
       gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
       gl.enableVertexAttribArray(edgePosLoc);
       gl.vertexAttribPointer(edgePosLoc, 3, gl.FLOAT, false, 0, 0);

       gl.uniformMatrix4fv(edgeMvpLoc, false, mats.mvp);
       gl.uniform4fv(edgeColorLoc, new Float32Array([0,0,0,1]));

       try { gl.lineWidth(1.5); } catch (e) { /* ignored */ }
       gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, edgeIbuf);
       gl.drawElements(gl.LINES, edgeIndices.length, indexGLType, 0);
     } else {
       // wireframe mode: draw only triangle edges
       gl.useProgram(wireframeProgram);
       gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
       gl.enableVertexAttribArray(wirePosLoc);
       gl.vertexAttribPointer(wirePosLoc, 3, gl.FLOAT, false, 0, 0);

       gl.uniformMatrix4fv(wireMvpLoc, false, mats.mvp);

       try { gl.lineWidth(1.0); } catch (e) { /* ignored */ }
       gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, triIbuf);
       gl.drawElements(gl.LINE_STRIP, triIndices.length, indexGLType, 0);
     }
    };

    // resize handler
    const handleResize = () => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      render();
    };

    // pointer controls (orbit)
    const onPointerDown = (ev: PointerEvent) => {
      isDraggingRef.current = true;
      lastPointerRef.current = { x: ev.clientX, y: ev.clientY };
      (ev.target as Element).setPointerCapture(ev.pointerId);
    };
    const onPointerMove = (ev: PointerEvent) => {
      if (!isDraggingRef.current || !lastPointerRef.current) return;
      const dx = ev.clientX - lastPointerRef.current.x;
      const dy = ev.clientY - lastPointerRef.current.y;
      lastPointerRef.current = { x: ev.clientX, y: ev.clientY };
      // rotate: horizontal -> yaw, vertical -> pitch
      rotationRef.current.y += dx * 0.01;
      rotationRef.current.x += dy * 0.01;
      // clamp pitch to avoid flip
      rotationRef.current.x = Math.max(-Math.PI/2 + 0.01, Math.min(Math.PI/2 - 0.01, rotationRef.current.x));
      render();
    };
    const onPointerUp = (ev: PointerEvent) => {
      isDraggingRef.current = false;
      lastPointerRef.current = null;
      try { (ev.target as Element).releasePointerCapture(ev.pointerId); } catch {}
    };

    // wheel zoom
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      zoomRef.current *= ev.deltaY < 0 ? 1.08 : 0.92;
      zoomRef.current = Math.max(0.1, Math.min(zoomRef.current, 10));
      render();
    };

    // attach listeners
    window.addEventListener('resize', handleResize);
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    // initial size + render
    handleResize();

    // cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      gl.deleteBuffer(posBuf);
      gl.deleteBuffer(nrmBuf);
      gl.deleteBuffer(triIbuf);
      gl.deleteBuffer(edgeIbuf);
      gl.deleteProgram(triProgram);
      gl.deleteProgram(edgeProgram);
      gl.deleteProgram(wireframeProgram);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [scene, renderMode]);

  // helpers for UI interactions
  const setView = (name: keyof typeof predefinedViews) => {
    rotationRef.current = { ...predefinedViews[name] };
    // trigger redraw by dispatching resize event
    const ev = new Event('resize');
    window.dispatchEvent(ev);
  };

  const resetCamera = () => {
    rotationRef.current = { x: 0.5, y: 0.5 };
    zoomRef.current = 1.0;
    const ev = new Event('resize');
    window.dispatchEvent(ev);
  };

  const toggleRenderMode = () => setRenderMode(m => m === 'normal' ? 'wireframe' : 'normal');

  // CSS moved to index.css; use class names in JSX

  return (
    <div className="viewer-3d" style={{ position: 'relative' }}>
      <h2>3D Viewer</h2>
      <div className="viewer-layout">
        <div className="viewer-left" style={{ position: 'relative' }}>
          <canvas ref={canvasRef} className="viewer-canvas" />
          <div className="view-controls">
            <button className={`render-mode-btn ${renderMode === 'normal' ? 'normal' : 'wire'}`} onClick={toggleRenderMode}>
              {renderMode === 'normal' ? 'Wireframe' : 'Solid'}
            </button>
            <button className="view-btn" onClick={() => setView('front')}>Front</button>
            <button className="view-btn" onClick={() => setView('top')}>Top</button>
            <button className="view-btn" onClick={resetCamera}>Reset</button>
          </div>

          <div className="view-grid">
            <button className="grid-btn" onClick={() => setView('top-back-left')} title="Top Back Left">TBL</button>
            <button className="grid-btn" onClick={() => setView('top')} title="Top">T</button>
            <button className="grid-btn" onClick={() => setView('top-back-right')} title="Top Back Right">TBR</button>

            <button className="grid-btn" onClick={() => setView('left')} title="Left">L</button>
            <button className="grid-btn reset-btn" onClick={resetCamera} title="Reset">●</button>
            <button className="grid-btn" onClick={() => setView('right')} title="Right">R</button>

            <button className="grid-btn" onClick={() => setView('top-front-left')} title="Top Front Left">TFL</button>
            <button className="grid-btn" onClick={() => setView('front')} title="Front">F</button>
            <button className="grid-btn" onClick={() => setView('top-front-right')} title="Top Front Right">TFR</button>
          </div>
        </div>

        <div className="viewer-right">
          <div className="viewer-convert">
            <h3>Convert To</h3>
            <div className="convert-buttons">
              <button
                onClick={() => setTargetFormat("OBJ")}
                className={`convert-btn ${targetFormat === "OBJ" ? "active" : ""}`}
                disabled={scene.metadata.format?.toUpperCase() === "OBJ" || isConverting}
              >
                OBJ
              </button>

              <button
                onClick={() => setTargetFormat("PLY")}
                className={`convert-btn ${targetFormat === "PLY" ? "active" : ""}`}
                disabled={scene.metadata.format?.toUpperCase() === "PLY" || isConverting}
              >
                PLY
              </button>

              <button
                onClick={() => setTargetFormat("glTF")}
                className={`convert-btn ${targetFormat === "glTF" ? "active" : ""}`}
                disabled={scene.metadata.format?.toUpperCase() === "GLTF" || isConverting}
              >
                GLTF
              </button>

              <button
                onClick={() => setTargetFormat("STL")}
                className={`convert-btn ${targetFormat === "STL" ? "active" : ""}`}
                disabled={scene.metadata.format?.toUpperCase() === "STL" || isConverting}
              >
                STL
              </button>
            </div>
            <button
              className="download-btn"
              disabled={!targetFormat || isConverting}
              onClick={async () => {
                console.log("Download button clicked");
                setIsConverting(true);

                const res = await performConversion();
                console.log("performConversion() returned:", res);

                if (res.ok) {
                  console.log("Conversion successful, downloading");
                  
                  const url = URL.createObjectURL(res.value);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `converted.${targetFormat.toLowerCase()}`;
                  a.click();
                  URL.revokeObjectURL(url);
                  console.log("Download triggered");
                } else {
                  console.error("Conversion failed:", res.error);
                }

                setIsConverting(false);
              }}
            >
              {isConverting ? 'Converting...' : 'Download Converted File'}
            </button>
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
