// stl-parser.ts
// Full STL parser (ASCII + Binary) — returns Result<Scene, string>
// Uses your existing types and Result monad (assumed to exist at these import paths)

import type { Scene, Vertex, Vec3, Vec2, Face, Mesh } from '../types/scene';
import type { Result } from '../utils/result';
import { Ok, Err, map, andThen, pipe, all } from '../utils/result';
import {
  createVec3,
  createVec2,
  createVertex,
  createFace,
  createMesh,
  createScene,
} from '../types/scene';

/**
 * STL-specific types
 */
export interface StlTriangle {
  readonly normal: Vec3;
  readonly vertices: readonly [Vec3, Vec3, Vec3];
  readonly attributes?: number;
}

export interface StlHeader {
  readonly isBinary: boolean;
  readonly name?: string;
  readonly triangleCount: number;
}

/**
 * Constants
 */
const STL_HEADER_SIZE = 80;
const STL_TRIANGLE_SIZE = 50; // 12 floats (48) + 2 bytes attr = 50

/**
 * Helpers to make a DataView safely from ArrayBuffer | Uint8Array | Buffer
 */
const toUint8Array = (input: ArrayBuffer | Uint8Array | Buffer): Uint8Array => {
  if (input instanceof Uint8Array) return input;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input as Buffer)) {
    return new Uint8Array((input as Buffer).buffer, (input as Buffer).byteOffset, (input as Buffer).byteLength);
  }
  return new Uint8Array(input as ArrayBuffer);
};

const createBinaryReader = (input: ArrayBuffer | Uint8Array | Buffer, littleEndian = true) => {
  const view = toUint8Array(input);
  const dataView = new DataView(view.buffer, view.byteOffset, view.byteLength);
  let offset = 0;

  const readFloat32 = (): Result<number, string> => {
    if (offset + 4 > dataView.byteLength) return Err('Unexpected EOF reading float32');
    const v = dataView.getFloat32(offset, littleEndian);
    offset += 4;
    return Ok(v);
  };

  const readUint32 = (): Result<number, string> => {
    if (offset + 4 > dataView.byteLength) return Err('Unexpected EOF reading uint32');
    const v = dataView.getUint32(offset, littleEndian);
    offset += 4;
    return Ok(v);
  };

  const readUint16 = (): Result<number, string> => {
    if (offset + 2 > dataView.byteLength) return Err('Unexpected EOF reading uint16');
    const v = dataView.getUint16(offset, littleEndian);
    offset += 2;
    return Ok(v);
  };

  const skip = (n: number): Result<void, string> => {
    if (offset + n > dataView.byteLength) return Err('Unexpected EOF while skipping');
    offset += n;
    return Ok(undefined);
  };

  const setOffset = (o: number) => {
    offset = o;
  };

  const getOffset = () => offset;

  const byteLength = dataView.byteLength;

  return { readFloat32, readUint32, readUint16, skip, setOffset, getOffset, byteLength, dataView, view };
};

/**
 * Detect binary vs ascii more robustly
 *
 * Heuristics applied:
 * - If file < 84 bytes -> invalid (return Err)
 * - If header (first 80 bytes) contains a NUL byte -> binary
 * - If header doesn't start with 'solid' -> binary
 * - If first ~1KB contains tokens 'facet' or 'vertex' -> ascii
 * - Else fallback to size heuristic: if file length >= 84 + n * 50 it's likely binary
 */
const detectBinaryFormat = (input: ArrayBuffer | Uint8Array | Buffer): Result<boolean, string> => {
  const view = toUint8Array(input);
  if (view.byteLength < 84) return Err('File too small to be valid STL');

  // header 0..80
  const headerBytes = view.subarray(0, Math.min(80, view.byteLength));
  const headerText = (() => {
    try {
      return new TextDecoder().decode(headerBytes);
    } catch {
      return '';
    }
  })();

  // If header contains any zero bytes -> binary (very common)
  for (let i = 0; i < headerBytes.length; i++) {
    if (headerBytes[i] === 0) return Ok(true);
  }

  const startsWithSolid = headerText.trim().toLowerCase().startsWith('solid');

  // Read at most first 4KB as text (some ascii files are long)
  const headLen = Math.min(view.byteLength, 4096);
  const headText = new TextDecoder().decode(view.subarray(0, headLen)).toLowerCase();

  const hasFacet = headText.includes('facet');
  const hasVertex = headText.includes('vertex');

  if (!startsWithSolid) {
    // Not starting with 'solid' => almost certainly binary
    return Ok(true);
  }

  // If we find 'facet' or 'vertex' in the head, very likely ASCII
  if (hasFacet || hasVertex) {
    return Ok(false);
  }

  // fallback: read triangle count at byte 80 (little-endian)
  const reader = createBinaryReader(view, true);
  reader.setOffset(80);
  const triCountRes = reader.readUint32();
  if (!triCountRes.ok) {
    // Can't read triangle count -> assume ASCII (safer)
    return Ok(false);
  }
  const triCount = triCountRes.value;
  const expectedSize = 84 + triCount * STL_TRIANGLE_SIZE;

  // If file size equals expectedSize OR is greater but plausible -> binary
  if (view.byteLength === expectedSize || view.byteLength >= expectedSize) {
    return Ok(true);
  }

  // Default to ASCII if none of the binary heuristics matched
  return Ok(false);
};

/**
 * Parse Binary Header -> name + triangleCount
 */
const parseBinaryHeader = (input: ArrayBuffer | Uint8Array | Buffer): Result<StlHeader, string> => {
  const view = toUint8Array(input);
  if (view.byteLength < 84) return Err('Binary file too small for header + count');

  const headerBytes = view.subarray(0, Math.min(STL_HEADER_SIZE, view.byteLength));
  // name may be padded with nulls; find first null or use trim
  let name = '';
  for (let i = 0; i < headerBytes.length; i++) {
    if (headerBytes[i] === 0) {
      name = new TextDecoder().decode(headerBytes.subarray(0, i)).trim();
      break;
    }
  }
  if (!name) {
    try {
      name = new TextDecoder().decode(headerBytes).trim();
    } catch {
      name = '';
    }
  }

  const reader = createBinaryReader(view, true);
  reader.setOffset(80);
  return map(reader.readUint32(), (triangleCount) => ({
    isBinary: true,
    name: name || undefined,
    triangleCount,
  }));
};

/**
 * Parse ASCII header: count facets roughly and return header
 */
const parseAsciiHeader = (input: ArrayBuffer | Uint8Array | Buffer): Result<StlHeader, string> => {
  const view = toUint8Array(input);
  const text = new TextDecoder().decode(view);
  if (!text.toLowerCase().startsWith('solid')) return Err('Not an ASCII STL (no "solid")');
  const nameMatch = text.match(/solid\s+([^\r\n]+)/i);
  const name = nameMatch ? nameMatch[1].trim() : undefined;

  // Count facets by token 'facet' — robust enough
  const facetCount = (text.match(/facet/gi) || []).length;
  return Ok({ isBinary: false, name: name || undefined, triangleCount: facetCount });
};

/**
 * Parse combined header
 */
const parseStlHeader = (input: ArrayBuffer | Uint8Array | Buffer): Result<StlHeader, string> =>
  pipe(
    ((): Result<boolean, string> => detectBinaryFormat(input))(),
    andThen(isBinary => (isBinary ? parseBinaryHeader(input) : parseAsciiHeader(input)))
  );

/**
 * Parse a single binary triangle: reader expected to be positioned at triangle start
 * (normal x,y,z then v1 x,y,z v2 x,y,z v3 x,y,z then attr uint16)
 */
const parseBinaryTriangle = (reader: ReturnType<typeof createBinaryReader>): Result<StlTriangle, string> => {
  // read 12 floats (normal + 3 vertices)
  return pipe(
    all([
      reader.readFloat32(), reader.readFloat32(), reader.readFloat32(), // n
      reader.readFloat32(), reader.readFloat32(), reader.readFloat32(), // v1
      reader.readFloat32(), reader.readFloat32(), reader.readFloat32(), // v2
      reader.readFloat32(), reader.readFloat32(), reader.readFloat32(), // v3
    ]),
    andThen(values => {
      // values is number[]
      const nx = values[0], ny = values[1], nz = values[2];
      const v1 = createVec3(values[3], values[4], values[5]);
      const v2 = createVec3(values[6], values[7], values[8]);
      const v3 = createVec3(values[9], values[10], values[11]);

      return pipe(
        reader.readUint16(),
        map(attr => ({
          normal: createVec3(nx, ny, nz),
          vertices: [v1, v2, v3] as const,
          attributes: attr > 0 ? attr : undefined,
        }))
      );
    })
  );
};

/**
 * Parse all binary triangles (reader starts at 0, we'll set offset to 84)
 */
const parseBinaryTriangles = (input: ArrayBuffer | Uint8Array | Buffer, count: number): Result<readonly StlTriangle[], string> => {
  const view = toUint8Array(input);
  const reader = createBinaryReader(view, true);
  reader.setOffset(0); // we'll use offsets relative to full buffer; caller should pass full buffer
  // move to after header + count
  const ok = reader.skip ? reader.skip(STL_HEADER_SIZE + 4) : Ok(undefined);
  if (!ok.ok) return Err('Binary buffer too small to position at triangle data');

  const parseRec = (acc: StlTriangle[], remaining: number): Result<readonly StlTriangle[], string> => {
    if (remaining === 0) return Ok(Object.freeze(acc));
    return pipe(
      parseBinaryTriangle(reader),
      andThen(tri => parseRec([...acc, tri], remaining - 1))
    );
  };

  return parseRec([], count);
};

/**
 * Parse ASCII triangles using regex (more robust than line-based)
 */
const parseAsciiTriangles = (input: ArrayBuffer | Uint8Array | Buffer): Result<readonly StlTriangle[], string> => {
  const view = toUint8Array(input);
  const text = new TextDecoder().decode(view);

  // Regex to match facets including nested whitespace and newlines (non-greedy)
  const facetRegex = /facet\s+normal\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+outer\s+loop\s+vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+endloop\s+endfacet/gi;

  const triangles: StlTriangle[] = [];
  let m: RegExpExecArray | null;
  while ((m = facetRegex.exec(text)) !== null) {
    const nx = parseFloat(m[1]), ny = parseFloat(m[2]), nz = parseFloat(m[3]);
    const v1 = createVec3(parseFloat(m[4]), parseFloat(m[5]), parseFloat(m[6]));
    const v2 = createVec3(parseFloat(m[7]), parseFloat(m[8]), parseFloat(m[9]));
    const v3 = createVec3(parseFloat(m[10]), parseFloat(m[11]), parseFloat(m[12]));

    triangles.push({
      normal: createVec3(nx, ny, nz),
      vertices: [v1, v2, v3] as const,
    });
  }

  return Ok(Object.freeze(triangles));
};

/**
 * Main parse function: returns triangles (Result)
 *
 * Accepts ArrayBuffer | Uint8Array | Buffer
 */
export const parseStl = (input: ArrayBuffer | Uint8Array | Buffer): Result<readonly StlTriangle[], string> =>
  pipe(
    parseStlHeader(input),
    andThen(header => {
      if (header.isBinary) {
        // For binary we parse from the full buffer (not sliced) and the parser will skip header
        return parseBinaryTriangles(input, header.triangleCount);
      } else {
        return parseAsciiTriangles(input);
      }
    })
  );

/**
 * Convert triangles -> Scene
 *
 * Keeps every triangle's three vertices separate (no deduplication),
 * calculates normals if absent (fall back).
 */
const calculateFaceNormal = (v0: Vec3, v1: Vec3, v2: Vec3): Vec3 => {
  const ux = v1.x - v0.x, uy = v1.y - v0.y, uz = v1.z - v0.z;
  const vx = v2.x - v0.x, vy = v2.y - v0.y, vz = v2.z - v0.z;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  return len > 0 ? createVec3(nx / len, ny / len, nz / len) : createVec3(0, 0, 1);
};

const calculateBoundingBox = (vertices: readonly Vertex[]):
  { readonly min: Vec3; readonly max: Vec3 } | undefined => {
  if (vertices.length === 0) return undefined;
  const first = vertices[0].position;
  const init = { min: createVec3(first.x, first.y, first.z), max: createVec3(first.x, first.y, first.z) };
  const res = vertices.slice(1).reduce((acc, v) => {
    const p = v.position;
    return {
      min: createVec3(Math.min(acc.min.x, p.x), Math.min(acc.min.y, p.y), Math.min(acc.min.z, p.z)),
      max: createVec3(Math.max(acc.max.x, p.x), Math.max(acc.max.y, p.y), Math.max(acc.max.z, p.z)),
    };
  }, init);
  return res;
};

export const stlToScene = (triangles: readonly StlTriangle[], name = 'STL Model'): Result<Scene, string> => {
  if (!triangles || triangles.length === 0) return Err('No triangles to convert');

  // each triangle -> 3 vertices, 1 face
  const vertices: Vertex[] = [];
  const faces: Face[] = [];

  triangles.forEach((tri, i) => {
    const base = vertices.length;
    const normal = tri.normal && (tri.normal.x !== 0 || tri.normal.y !== 0 || tri.normal.z !== 0)
      ? tri.normal
      : calculateFaceNormal(tri.vertices[0], tri.vertices[1], tri.vertices[2]);

    tri.vertices.forEach(v => vertices.push(createVertex(v, normal)));
    faces.push(createFace([base, base + 1, base + 2]));
  });

  const bbox = calculateBoundingBox(vertices);
  const mesh = createMesh(name, Object.freeze(vertices), Object.freeze(faces));
  const scene = createScene([mesh], [], {
    format: 'STL',
    vertexCount: vertices.length,
    faceCount: faces.length,
    boundingBox: bbox,
  });

  return Ok(scene);
};

/**
 * Combined pipeline: buffer -> triangles -> scene
 */
export const parseStlToScene = (input: ArrayBuffer | Uint8Array | Buffer, meshName?: string): Result<Scene, string> =>
  pipe(
    parseStl(input),
    andThen(triangles => stlToScene(triangles, meshName || 'STL Model'))
  );

/**
 * Convenience wrapper for Node.js Buffer input (async-friendly)
 * Accepts Node Buffer and returns Result<Scene, string>
 */
export const parseSTL = async (nodeBuffer: Buffer, meshName?: string): Promise<Result<Scene, string>> => {
  try {
    // Convert Node Buffer into Uint8Array view safely
    const uint8 = new Uint8Array(nodeBuffer.buffer, nodeBuffer.byteOffset, nodeBuffer.byteLength);
    return parseStlToScene(uint8, meshName);
  } catch (err) {
    return Err(`STL parsing failed: ${(err as Error)?.message ?? String(err)}`);
  }
};
