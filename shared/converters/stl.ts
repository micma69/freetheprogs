/**
 * Convert internal Scene -> ASCII STL formatted string
 * - Functional style: small pure helpers, immutable transforms
 * - Returns Result<string, string> using project's Ok/Err pattern
 * - Triangulates polygonal faces using a fan method (assumes meshes are manifold or fans are acceptable)
 *
 * This converter is kept consistent with other converters in this directory (obj.ts, gltf.tsx)
 * and integrates with the project's Scene/Mesh/Vertex shape.
 */

import type { Scene, Vertex } from '../types/scene';
import { Ok, Err } from '../utils/result';

/**
 * Stable float formatting (avoid excessive trailing zeros)
 */
const fmt = (n: number): string => {
  // Keep a concise decimal representation, but ensure small numbers don't become exponential
  // Use Number.toPrecision only for extremes, otherwise plain toString is fine.
  if (!isFinite(n)) return '0';
  // Avoid scientific notation for typical 3D coordinates
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 1e-6 || abs >= 1e6)) {
    // fallback to fixed with 6 decimals for readability
    return n.toFixed(6).replace(/(?:\.0+|(\.\d+?)0+)$/, '$1');
  }
  return Number(n).toString();
};

/* Vector helpers (pure) */
const sub = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});

const cross = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

const normalize = (v: { x: number; y: number; z: number }) => {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len === 0) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
};

/* Triangulate a face indices array using fan method
   - Accepts an array of indices [i0, i1, i2, i3, ...]
   - Returns array of triangles, each triangle is [a,b,c] indices (local to mesh.vertices)
*/
const triangulateFace = (indices: number[]): number[][] => {
  if (indices.length < 3) return [];
  if (indices.length === 3) return [indices.slice(0, 3)];
  const triangles: number[][] = [];
  const i0 = indices[0];
  for (let i = 1; i < indices.length - 1; i++) {
    triangles.push([i0, indices[i], indices[i + 1]]);
  }
  return triangles;
};

/**
 * Build an ASCII STL string from a Scene
 */
export const toSTL = (scene: Scene) => {
  try {
    const lines: string[] = [];
    // Use a single `solid` wrapper for the whole scene; include scene metadata.format if present
    const name = (scene.metadata && scene.metadata.format) ? `freetheprogs_${scene.metadata.format}` : 'freetheprogs';
    lines.push(`solid ${name}`);

    // Iterate meshes and faces, emit triangles
    for (const mesh of scene.meshes) {
      const meshName = mesh.name || 'mesh';
      // Optionally include a comment with mesh name
      lines.push(`  // mesh ${meshName}`);

      // For each face, triangulate and emit facets
      for (const face of mesh.faces) {
        const tris = triangulateFace(face.indices);
        for (const tri of tris) {
          const v0: Vertex = mesh.vertices[tri[0]];
          const v1: Vertex = mesh.vertices[tri[1]];
          const v2: Vertex = mesh.vertices[tri[2]];

          if (!v0 || !v1 || !v2) {
            // Skip invalid triangles gracefully
            continue;
          }

          // compute face normal (right-hand rule)
          const e1 = sub(v1.position, v0.position);
          const e2 = sub(v2.position, v0.position);
          const n = normalize(cross(e1, e2));

          lines.push(`  facet normal ${fmt(n.x)} ${fmt(n.y)} ${fmt(n.z)}`);
          lines.push(`    outer loop`);
          lines.push(`      vertex ${fmt(v0.position.x)} ${fmt(v0.position.y)} ${fmt(v0.position.z)}`);
          lines.push(`      vertex ${fmt(v1.position.x)} ${fmt(v1.position.y)} ${fmt(v1.position.z)}`);
          lines.push(`      vertex ${fmt(v2.position.x)} ${fmt(v2.position.y)} ${fmt(v2.position.z)}`);
          lines.push(`    endloop`);
          lines.push(`  endfacet`);
        }
      }
    }

    lines.push(`endsolid ${name}`);
    const content = lines.join('\n') + '\n';
    return Ok(content);
  } catch (err) {
    return Err((err as Error).message || 'Unknown error while converting to STL');
  }
};

export default toSTL;