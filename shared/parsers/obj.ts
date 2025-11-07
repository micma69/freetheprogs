/**
 * Pure OBJ parser using functional programming with proper composition
 * Returns Result<Scene, Error> for monadic error handling
 */

import type { Scene, Vertex, Vec3, Vec2, Face, Mesh } from '../types/scene';
import type { Result } from '../utils/result';
import { Ok, Err, map, mapErr, andThen, all, pipe } from '../utils/result';
import {
  createVec3,
  createVec2,
  createVertex,
  createFace,
  createMesh,
  createScene,
} from '../types/scene';
import { validateScene } from '../validators/validators';

export type ParseError = {
  readonly message: string;
  readonly line: number;
  readonly column?: number;
};

type ParsedLine = {
  readonly type: string;
  readonly data: readonly string[];
  readonly lineNum: number;
};

type OBJData = {
  readonly positions: readonly Vec3[];
  readonly normals: readonly Vec3[];
  readonly texCoords: readonly Vec2[];
  readonly faces: readonly {
    readonly vertices: readonly { posIndex: number; texIndex?: number; normIndex?: number }[];
    readonly material?: string;
  }[];
};

/**
 * Parse a line from OBJ file
 */
const parseLine = (line: string, lineNum: number): Result<ParsedLine | null, ParseError> => {
  const trimmed = line.trim();

  // Skip empty lines and comments
  if (trimmed === '' || trimmed.startsWith('#')) {
    return Ok(null);
  }

  const parts = trimmed.split(/\s+/);
  const type = parts[0];
  const data = parts.slice(1);

  return Ok({ type, data, lineNum });
};

/**
 * Parse a vertex position (v x y z)
 */
const parseVertexPosition = (parts: readonly string[]): Result<Vec3, string> => {
  if (parts.length < 3) {
    return Err('Vertex position requires at least 3 components');
  }

  const x = parseFloat(parts[0]);
  const y = parseFloat(parts[1]);
  const z = parseFloat(parts[2]);

  if (isNaN(x) || isNaN(y) || isNaN(z)) {
    return Err('Invalid vertex position values');
  }

  return Ok(createVec3(x, y, z));
};

/**
 * Parse a texture coordinate (vt u v)
 */
const parseTextureCoord = (parts: readonly string[]): Result<Vec2, string> => {
  if (parts.length < 2) {
    return Err('Texture coordinate requires at least 2 components');
  }

  const u = parseFloat(parts[0]);
  const v = parseFloat(parts[1]);

  if (isNaN(u) || isNaN(v)) {
    return Err('Invalid texture coordinate values');
  }

  return Ok({ x: u, y: v });
};

/**
 * Parse a normal vector (vn x y z)
 */
const parseNormal = (parts: readonly string[]): Result<Vec3, string> => {
  if (parts.length < 3) {
    return Err('Normal requires 3 components');
  }

  const x = parseFloat(parts[0]);
  const y = parseFloat(parts[1]);
  const z = parseFloat(parts[2]);

  if (isNaN(x) || isNaN(y) || isNaN(z)) {
    return Err('Invalid normal values');
  }

  return Ok(createVec3(x, y, z));
};

/**
 * Parse a face index reference (can be v, v/vt, v/vt/vn, or v//vn)
 */
const parseFaceIndex = (ref: string): Result<{ posIndex: number; texIndex?: number; normIndex?: number }, string> => {
  const parts = ref.split('/');
  
  if (parts[0] === '') {
    return Err(`Invalid face index: ${ref}`);
  }

  const vertexIndex = parseInt(parts[0], 10);
  if (isNaN(vertexIndex)) {
    return Err(`Invalid face index: ${ref}`);
  }

  // OBJ uses 1-based indexing, convert to 0-based
  const posIndex = vertexIndex - 1;

  const texIndex = parts[1] !== undefined && parts[1] !== '' 
    ? parseInt(parts[1], 10) - 1 
    : undefined;
  if (parts[1] !== undefined && parts[1] !== '' && isNaN(texIndex!)) {
    return Err(`Invalid texture index: ${ref}`);
  }

  const normIndex = parts[2] !== undefined && parts[2] !== ''
    ? parseInt(parts[2], 10) - 1
    : undefined;
  if (parts[2] !== undefined && parts[2] !== '' && isNaN(normIndex!)) {
    return Err(`Invalid normal index: ${ref}`);
  }

  return Ok({ posIndex, texIndex, normIndex });
};

/**
 * Parse a face (f v1 v2 v3 ...)
 */
const parseFace = (parts: readonly string[]): Result<Array<{ posIndex: number; texIndex?: number; normIndex?: number }>, string> => {
  if (parts.length < 3) {
    return Err('Face must have at least 3 vertices');
  }

  const indexResults = parts.map(parseFaceIndex);
  return all(indexResults);
};

/**
 * Process a single parsed line and accumulate OBJ data
 */
const processLine = (
  acc: { data: OBJData; currentMaterial?: string },
  line: ParsedLine
): Result<{ data: OBJData; currentMaterial?: string }, ParseError> => {
  const { type, data: parts, lineNum } = line;

  switch (type) {
    case 'v':
      return map(
        mapErr(parseVertexPosition(parts), msg => ({ message: msg, line: lineNum })),
        pos => ({
          ...acc,
          data: {
            ...acc.data,
            positions: [...acc.data.positions, pos]
          }
        })
      );

    case 'vt':
      return map(
        mapErr(parseTextureCoord(parts), msg => ({ message: msg, line: lineNum })),
        tex => ({
          ...acc,
          data: {
            ...acc.data,
            texCoords: [...acc.data.texCoords, tex]
          }
        })
      );

    case 'vn':
      return map(
        mapErr(parseNormal(parts), msg => ({ message: msg, line: lineNum })),
        norm => ({
          ...acc,
          data: {
            ...acc.data,
            normals: [...acc.data.normals, norm]
          }
        })
      );

    case 'f':
      return map(
        mapErr(parseFace(parts), msg => ({ message: msg, line: lineNum })),
        vertices => ({
          ...acc,
          data: {
            ...acc.data,
            faces: [...acc.data.faces, { vertices, material: acc.currentMaterial }]
          }
        })
      );

    case 'usemtl':
      return Ok({
        ...acc,
        currentMaterial: parts.length > 0 ? parts[0] : undefined
      });

    default:
      // Ignore unsupported commands
      return Ok(acc);
  }
};

/**
 * Parse all lines into OBJData
 */
const parseLines = (content: string): Result<OBJData, ParseError> => {
  const lines = content.split('\n');
  
  // Parse all lines using flatMap 
  const parsedLines = lines
    .flatMap((line, i) => {
      const result = parseLine(line, i + 1);
      return result.ok && result.value !== null ? [result.value] : [];
    });

  // Initial accumulator
  const initial: { data: OBJData; currentMaterial?: string } = {
    data: {
      positions: [],
      normals: [],
      texCoords: [],
      faces: []
    }
  };

  // Fold over lines 
  const result = parsedLines.reduce<Result<{ data: OBJData; currentMaterial?: string }, ParseError>>(
    (accResult, line) => andThen(accResult, acc => processLine(acc, line)),
    Ok(initial)
  );

  return map(result, acc => acc.data);
};

/**
 * Build vertices from OBJ data using pure functional fold pattern
 * No mutations - returns immutable accumulator
 */
const buildVertices = (objData: OBJData): Result<{
  vertices: readonly Vertex[];
  faces: readonly Face[];
}, ParseError> => {
  const { positions, normals, texCoords, faces } = objData;

  // Immutable accumulator for building vertices
  type VertexAccumulator = {
    readonly vertexMap: Map<string, number>;
    readonly vertices: readonly Vertex[];
  };

  const initialAcc: VertexAccumulator = {
    vertexMap: new Map(),
    vertices: []
  };

  /**
   * Pure function to add or retrieve vertex index
   * Returns new accumulator state without mutation
   */
  const addVertex = (
    acc: VertexAccumulator,
    posIndex: number,
    texIndex?: number,
    normIndex?: number
  ): Result<[number, VertexAccumulator], ParseError> => {
    const key = `${posIndex}-${texIndex ?? -1}-${normIndex ?? -1}`;

    // Check if vertex already exists
    const existing = acc.vertexMap.get(key);
    if (existing !== undefined) {
      return Ok([existing, acc]);
    }

    // Validate position index
    const position = positions[posIndex];
    if (!position) {
      return Err({
        message: `Position index ${posIndex} out of bounds`,
        line: 0
      });
    }

    // Build vertex data
    const normal = normIndex !== undefined ? normals[normIndex] : undefined;
    const texCoord = texIndex !== undefined && texCoords[texIndex]
      ? createVec2(texCoords[texIndex].x, texCoords[texIndex].y)
      : undefined;

    const vertex = createVertex(position, normal, texCoord);
    const index = acc.vertices.length;

    // Return new immutable state
    const newMap = new Map(acc.vertexMap);
    newMap.set(key, index);

    return Ok([index, {
      vertexMap: newMap,
      vertices: [...acc.vertices, vertex]
    }]);
  };

  /**
   * Build all faces using fold pattern
   * Accumulates vertices and faces immutably
   */
  const buildFacesResult = faces.reduce<Result<VertexAccumulator & { faces: readonly Face[] }, ParseError>>(
    (accResult, face) => andThen(accResult, acc => {
      // Process each vertex reference in the face
      const faceIndicesResult = face.vertices.reduce<Result<[readonly number[], VertexAccumulator], ParseError>>(
        (indicesResult, v) => andThen(indicesResult, ([indices, currentAcc]) =>
          map(
            addVertex(currentAcc, v.posIndex, v.texIndex, v.normIndex),
            ([idx, newAcc]) => [[...indices, idx], newAcc] as [readonly number[], VertexAccumulator]
          )
        ),
        Ok([[], acc] as [readonly number[], VertexAccumulator])
      );

      return map(faceIndicesResult, ([indices, newAcc]) => ({
        ...newAcc,
        faces: [...acc.faces, createFace(indices, face.material)]
      }));
    }),
    Ok({ ...initialAcc, faces: [] })
  );

  return andThen(buildFacesResult, result => {
    // If no faces but have positions, create vertices directly
    if (result.faces.length === 0 && positions.length > 0) {
      const directVertices = positions.map(pos => createVertex(pos));
      return Ok({ vertices: directVertices, faces: [] });
    }

    if (result.vertices.length === 0) {
      return Err({
        message: 'No vertices found in OBJ file',
        line: 0
      });
    }

    return Ok({ vertices: result.vertices, faces: result.faces });
  });
};

/**
 * Calculate bounding box for a scene
 */
const calculateBoundingBox = (
  vertices: readonly Vertex[]
): { min: Vec3; max: Vec3 } | undefined => {
  if (vertices.length === 0) {
    return undefined;
  }

  const positions = vertices.map(v => v.position);
  const min = createVec3(
    Math.min(...positions.map(p => p.x)),
    Math.min(...positions.map(p => p.y)),
    Math.min(...positions.map(p => p.z))
  );
  const max = createVec3(
    Math.max(...positions.map(p => p.x)),
    Math.max(...positions.map(p => p.y)),
    Math.max(...positions.map(p => p.z))
  );

  return { min, max };
};

/**
 * Build scene from vertices and faces
 */
const buildScene = (data: { vertices: readonly Vertex[]; faces: readonly Face[] }): Result<Scene, ParseError> => {
  const { vertices, faces } = data;
  const mesh = createMesh('default', vertices, faces);
  const boundingBox = calculateBoundingBox(vertices);

  const scene = createScene(
    [mesh],
    [],
    {
      format: 'OBJ',
      vertexCount: vertices.length,
      faceCount: faces.length,
      boundingBox,
    }
  );

  return Ok(scene);
};

/**
 * Main OBJ parser 
 */
export const parseOBJ = (content: string): Result<Scene, ParseError> => {
  return andThen(
    parseLines(content),
    objData => andThen(
      buildVertices(objData),
      vertexData => andThen(
        buildScene(vertexData),
        scene => mapErr(
          validateScene(scene),
          err => ({ message: `Validation error: ${err.message}`, line: 0 })
        )
      )
    )
  );
};


// Obj parse with pipe
export const parseOBJWithPipe = (content: string): Result<Scene, ParseError> => {
  return pipe(
    parseLines(content),
    (r: Result<OBJData, ParseError>) => andThen(r, buildVertices),
    (r: Result<{vertices: readonly Vertex[]; faces: readonly Face[]}, ParseError>) => andThen(r, buildScene),
    (r: Result<Scene, ParseError>) => andThen(r, scene => 
      mapErr(validateScene(scene), err => ({ 
        message: `Validation error: ${err.message}`, 
        line: 0 
      }))
    )
  );
};