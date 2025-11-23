/**
 * Convert internal Scene -> glTF (JSON + embedded buffer) string
 * - Functional style: small pure helpers, immutable data, clear transforms
 * - Returns Result<string, string> using project's Ok/Err pattern
 *
 * Notes:
 * - Produces a JSON glTF with a single embedded binary buffer (data URI).
 * - Packs all mesh attributes (positions, normals, texcoords, indices) into a single buffer.
 * - Uses 4-byte alignment for bufferViews as required by glTF.
 * - Materials are carried over by name when present.
 *
 * This converter is intentionally conservative (no textures, PBR params) but
 * is integrative with the project's Scene shape and follows patterns used by other converters.
 */

import type { Scene, Mesh, Vertex } from '../types/scene';
import { Ok, Err } from '../utils/result';

/* glTF constants */
const GLTF_COMPONENT = {
  BYTE: 5120,
  UNSIGNED_BYTE: 5121,
  SHORT: 5122,
  UNSIGNED_SHORT: 5123,
  UNSIGNED_INT: 5125,
  FLOAT: 5126,
} as const;

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/* Helpers (pure) */

const align4 = (n: number) => (n + 3) & ~3;

const toBase64 = (u8: Uint8Array): string => {
  // Try Node Buffer first, otherwise fall back to browser btoa in chunks
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(u8).toString('base64');
  }
  let CHUNK = 0x8000;
  let index = 0;
  let result = '';
  while (index < u8.length) {
    const slice = u8.subarray(index, Math.min(index + CHUNK, u8.length));
    result += String.fromCharCode.apply(null, Array.from(slice) as any);
    index += CHUNK;
  }
  return btoa(result);
};

const floatArrayFrom = (values: number[]) => new Float32Array(values);

const uint16ArrayFrom = (values: number[]) => new Uint16Array(values);

const uint32ArrayFrom = (values: number[]) => new Uint32Array(values);

/* Extract flattened arrays from meshes while tracking ranges and indices */
type PackedPart = {
  byteOffset: number;
  byteLength: number;
  componentType: number;
  count: number;
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4';
  min?: number[];
  max?: number[];
};

const computeMinMax = (arr: number[], tupleSize: number): { min: number[]; max: number[] } => {
  const min = Array(tupleSize).fill(Number.POSITIVE_INFINITY);
  const max = Array(tupleSize).fill(Number.NEGATIVE_INFINITY);
  for (let i = 0; i < arr.length; i += tupleSize) {
    for (let j = 0; j < tupleSize; j++) {
      const v = arr[i + j];
      if (v < min[j]) min[j] = v;
      if (v > max[j]) max[j] = v;
    }
  }
  return { min, max };
};

/* Main converter */
export const toGLTF = (scene: Scene): Result<string> => {
  try {
    // We'll accumulate binary parts into a list; then allocate a single buffer
    type BinaryChunk = { data: ArrayBuffer; alignTo4?: boolean };
    const chunks: BinaryChunk[] = [];
    const accessors: any[] = [];
    const bufferViews: any[] = [];
    const materialsMap = new Map<string, number>(); // material name -> index
    const gltfMaterials: any[] = [];
    const gltfMeshes: any[] = [];
    const gltfNodes: any[] = [];

    // For each mesh, collect attribute arrays and indices
    let globalVertexBase = 0;

    for (const mesh of scene.meshes) {
      // flattened per-attribute arrays
      const positions: number[] = [];
      const normals: number[] = [];
      const texcoords: number[] = [];
      const indices: number[] = [];

      // map local vertex index to sequential index
      for (const v of mesh.vertices) {
        positions.push(v.position.x, v.position.y, v.position.z);
        if (v.normal) normals.push(v.normal.x, v.normal.y, v.normal.z);
        if (v.texCoord) texcoords.push(v.texCoord.x, v.texCoord.y);
      }

      // faces -> indices (flatten)
      for (const f of mesh.faces) {
        // glTF expects triangles. If faces are arbitrary, assume they are triangles already.
        for (const idx of f.indices) {
          indices.push(idx); // local index
        }
      }

      // choose index component type
      const maxIndex = positions.length / 3 - 1;
      const needsUint32 = maxIndex >= 0xffff;
      const indexArray = needsUint32 ? uint32ArrayFrom(indices) : uint16ArrayFrom(indices);

      // prepare binary chunks and create bufferViews/accessors for attributes and indices
      // Keep 4-byte alignment between bufferViews
      // positions
      if (positions.length > 0) {
        const posArr = floatArrayFrom(positions);
        const buf = posArr.buffer.slice(0);
        const byteOffset = chunks.reduce((s, c) => s + align4(c.data.byteLength), 0);
        chunks.push({ data: buf, alignTo4: true });
        const bvIndex = bufferViews.length;
        bufferViews.push({
          buffer: 0,
          byteOffset,
          byteLength: buf.byteLength,
        });
        const { min, max } = computeMinMax(positions, 3);
        accessors.push({
          bufferView: bvIndex,
          byteOffset: 0,
          componentType: GLTF_COMPONENT.FLOAT,
          count: posArr.length / 3,
          type: 'VEC3',
          min,
          max,
        } as PackedPart);
      }

      // normals
      if (normals.length > 0) {
        const nArr = floatArrayFrom(normals);
        const byteOffset = chunks.reduce((s, c) => s + align4(c.data.byteLength), 0);
        const buf = nArr.buffer.slice(0);
        chunks.push({ data: buf, alignTo4: true });
        const bvIndex = bufferViews.length;
        bufferViews.push({
          buffer: 0,
          byteOffset,
          byteLength: buf.byteLength,
        });
        accessors.push({
          bufferView: bvIndex,
          byteOffset: 0,
          componentType: GLTF_COMPONENT.FLOAT,
          count: nArr.length / 3,
          type: 'VEC3',
        });
      }

      // texcoords
      if (texcoords.length > 0) {
        const tArr = floatArrayFrom(texcoords);
        const byteOffset = chunks.reduce((s, c) => s + align4(c.data.byteLength), 0);
        const buf = tArr.buffer.slice(0);
        chunks.push({ data: buf, alignTo4: true });
        const bvIndex = bufferViews.length;
        bufferViews.push({
          buffer: 0,
          byteOffset,
          byteLength: buf.byteLength,
        });
        accessors.push({
          bufferView: bvIndex,
          byteOffset: 0,
          componentType: GLTF_COMPONENT.FLOAT,
          count: tArr.length / 2,
          type: 'VEC2',
        });
      }

      // indices
      if (indices.length > 0) {
        const idxArr = needsUint32 ? uint32ArrayFrom(indices) : uint16ArrayFrom(indices);
        const byteOffset = chunks.reduce((s, c) => s + align4(c.data.byteLength), 0);
        const buf = idxArr.buffer.slice(0);
        chunks.push({ data: buf, alignTo4: true });
        const bvIndex = bufferViews.length;
        bufferViews.push({
          buffer: 0,
          byteOffset,
          byteLength: buf.byteLength,
        });
        accessors.push({
          bufferView: bvIndex,
          byteOffset: 0,
          componentType: needsUint32 ? GLTF_COMPONENT.UNSIGNED_INT : GLTF_COMPONENT.UNSIGNED_SHORT,
          count: idxArr.length,
          type: 'SCALAR',
        });
      }

      // Build a glTF mesh primitive referencing attribute accessors by indices.
      // We must compute accessor indices for the attributes we just pushed.
      // Accessor indices are the last ones pushed for positions/normals/texcoords/indices in that order.
      // To make this deterministic, record starting accessor index before pushing them.
      // However above we appended in fixed order: positions, normals, texcoords, indices.
      // Let's derive accessor indices relative to the end of accessors array.
      const lastAccessorIndex = accessors.length - 1;
      // Determine how many accessors belong to this mesh (could be 1..4)
      const meshAccessorCount = (positions.length > 0 ? 1 : 0)
        + (normals.length > 0 ? 1 : 0)
        + (texcoords.length > 0 ? 1 : 0)
        + (indices.length > 0 ? 1 : 0);

      // calculate first accessor index for this mesh
      const firstAccessorIndex = lastAccessorIndex - meshAccessorCount + 1;
      // Map attributes in the same order we created them:
      let ai = firstAccessorIndex;
      const attributes: Record<string, number> = {};
      if (positions.length > 0) {
        attributes.POSITION = ai++;
      }
      if (normals.length > 0) {
        attributes.NORMAL = ai++;
      }
      if (texcoords.length > 0) {
        attributes.TEXCOORD_0 = ai++;
      }
      let indicesAccessorIndex: number | undefined = undefined;
      if (indices.length > 0) {
        indicesAccessorIndex = ai++;
      }

      // material handling: create or reuse material index
      let materialIndex: number | undefined = undefined;
      if (mesh.material && mesh.material.name) {
        const name = mesh.material.name;
        if (materialsMap.has(name)) {
          materialIndex = materialsMap.get(name);
        } else {
          const mIndex = gltfMaterials.length;
          materialsMap.set(name, mIndex);
          gltfMaterials.push({ name });
          materialIndex = mIndex;
        }
      }

      const primitive: any = {
        attributes,
      };
      if (indicesAccessorIndex !== undefined) primitive.indices = indicesAccessorIndex;
      if (materialIndex !== undefined) primitive.material = materialIndex;

      gltfMeshes.push({
        primitives: [primitive],
        name: mesh.name || undefined,
      });

      // Create a node that references this mesh
      const nodeIndex = gltfNodes.length;
      gltfNodes.push({
        mesh: gltfMeshes.length - 1,
        name: mesh.name || `mesh_${nodeIndex}`,
      });

      // update base if multiple meshes were merged - local indices assumed
      globalVertexBase += positions.length / 3;
    }

    // Now we must fix bufferView byteOffset values to be cumulative aligned offsets,
    // because earlier we pushed tentative offsets based on chunk sizes before all chunks existed.
    // Recompute bufferViews from chunks in order.
    let cursor = 0;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      cursor = align4(cursor);
      bufferViews[i].byteOffset = cursor;
      bufferViews[i].byteLength = c.data.byteLength;
      cursor += c.data.byteLength;
    }
    const totalByteLength = align4(cursor);

    // Allocate final ArrayBuffer and copy chunk data in sequence (respecting 4-byte alignment)
    const finalBuffer = new ArrayBuffer(totalByteLength);
    const finalU8 = new Uint8Array(finalBuffer);
    let writeCursor = 0;
    for (const c of chunks) {
      writeCursor = align4(writeCursor);
      finalU8.set(new Uint8Array(c.data), writeCursor);
      writeCursor += align4(c.data.byteLength); // we pad each chunk to 4 bytes for next alignment
    }

    // Assemble glTF JSON structure
    const gltf: any = {
      asset: { version: '2.0', generator: 'freetheprogs toGLTF' },
      scenes: [{ nodes: gltfNodes.map((_, i) => i) }],
      scene: 0,
      nodes: gltfNodes,
      meshes: gltfMeshes,
      materials: gltfMaterials.length > 0 ? gltfMaterials : undefined,
      buffers: [
        {
          byteLength: totalByteLength,
          uri: `data:application/octet-stream;base64,${toBase64(finalU8)}`,
        },
      ],
      bufferViews,
      accessors,
    };

    // Clean up undefined fields to reduce output noise
    if (!gltf.materials) delete gltf.materials;

    const json = JSON.stringify(gltf, null, 2);
    return Ok(json);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Err(msg || 'Unknown error while converting to glTF');
  }
};

export default toGLTF;