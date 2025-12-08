/**
 * Convert internal Scene -> OBJ formatted string
 * Follows the project's functional patterns and returns Result<string, string>
 */

import type { Scene, Mesh, Vertex } from '../types/scene';
import { Ok, Err } from '../utils/result';

/**
 * Format a float with a stable representation
 */
const fmt = (n: number): string => {
  // prefer a concise representation, avoid unnecessary trailing zeros
  return Number(n).toString();
};

/**
 * Build an OBJ string from a Scene
 */
export const toOBJ = (scene: Scene) => {
  try {
    const lines: string[] = [];
    lines.push(`# Exported by freetheprogs toOBJ`);
    lines.push(`# format: ${scene.metadata.format} -> OBJ`);

    // Global counters
    let posCount = 0;
    let texCount = 0;
    let normCount = 0;

    // For each mesh, we will emit a group and its vertices
    // We'll record per-mesh per-vertex global indices
    const meshVertexIndices: Array<readonly { pos: number; tex?: number; norm?: number }[]> = [];

    for (const mesh of scene.meshes) {
      const perVert: { pos: number; tex?: number; norm?: number }[] = [];

      // object/group name
      lines.push(`o ${mesh.name || 'mesh'}`);

      for (const v of mesh.vertices) {
        // position
        lines.push(`v ${fmt(v.position.x)} ${fmt(v.position.y)} ${fmt(v.position.z)}`);
        posCount += 1;
        const record: { pos: number; tex?: number; norm?: number } = { pos: posCount };

        if (v.texCoord) {
          lines.push(`vt ${fmt(v.texCoord.x)} ${fmt(v.texCoord.y)}`);
          texCount += 1;
          record.tex = texCount;
        }

        if (v.normal) {
          lines.push(`vn ${fmt(v.normal.x)} ${fmt(v.normal.y)} ${fmt(v.normal.z)}`);
          normCount += 1;
          record.norm = normCount;
        }

        perVert.push(record);
      }

      meshVertexIndices.push(Object.freeze(perVert));
    }

    // Emit faces per mesh
    for (let mi = 0; mi < scene.meshes.length; mi++) {
      const mesh = scene.meshes[mi];
      const vertIndices = meshVertexIndices[mi];

      // If mesh has material, emit usemtl
      if (mesh.material && mesh.material.name) {
        lines.push(`usemtl ${mesh.material.name}`);
      }

      for (const face of mesh.faces) {
        // build face entries
        const parts = face.indices.map(i => {
          const rec = vertIndices[i];
          if (!rec) throw new Error(`Face index ${i} out of bounds for mesh ${mesh.name}`);

          const p = rec.pos;
          const t = rec.tex;
          const n = rec.norm;

          if (t !== undefined && n !== undefined) return `${p}/${t}/${n}`;
          if (t !== undefined && n === undefined) return `${p}/${t}`;
          if (t === undefined && n !== undefined) return `${p}//${n}`;
          return `${p}`;
        });

        lines.push(`f ${parts.join(' ')}`);
      }
    }

    const content = lines.join('\n') + '\n';
    return Ok(content);
  } catch (err) {
    return Err((err as Error).message || 'Unknown error');
  }
};

export default toOBJ;
