/**
 * Pure OBJ parser using functional programming
 * Returns Result<Scene, Error> for monadic error handling
 */

import type { Scene, Vertex, Vec3, Face, Mesh, Material } from '../types/scene';
import type { Result } from '../utils/result';
import { Ok, Err } from '../utils/result';
import {
  createVec3,
  createVec2,
  createVertex,
  createFace,
  createMaterial,
  createMesh,
  createScene,
} from '../types/scene';
import { validateScene } from '../validators/validators';

export type ParseError = {
  readonly message: string;
  readonly line: number;
  readonly column?: number;
};

/**
 * Parse a line from OBJ file
 * Returns tuple [type, data]
 */
const parseLine = (line: string): Result<[string, string[]], ParseError> => {
  const trimmed = line.trim();

  // Skip empty lines and comments
  if (trimmed === '' || trimmed.startsWith('#')) {
    return Err({
      message: 'Empty or comment line',
      line: 0,
    });
  }

  const parts = trimmed.split(/\s+/);
  const type = parts[0];
  const data = parts.slice(1);

  return Ok([type, data]);
};

/**
 * Parse a vertex position (v x y z)
 */
const parseVertexPosition = (parts: string[]): Result<Vec3, ParseError> => {
  if (parts.length < 3) {
    return Err({
      message: 'Vertex position requires at least 3 components',
      line: 0,
    });
  }

  const x = parseFloat(parts[0]);
  const y = parseFloat(parts[1]);
  const z = parseFloat(parts[2]);

  if (isNaN(x) || isNaN(y) || isNaN(z)) {
    return Err({
      message: 'Invalid vertex position values',
      line: 0,
    });
  }

  return Ok(createVec3(x, y, z));
};

/**
 * Parse a texture coordinate (vt u v)
 */
const parseTextureCoord = (parts: string[]): Result<{ x: number; y: number }, ParseError> => {
  if (parts.length < 2) {
    return Err({
      message: 'Texture coordinate requires at least 2 components',
      line: 0,
    });
  }

  const u = parseFloat(parts[0]);
  const v = parseFloat(parts[1]);

  if (isNaN(u) || isNaN(v)) {
    return Err({
      message: 'Invalid texture coordinate values',
      line: 0,
    });
  }

  return Ok({ x: u, y: v });
};

/**
 * Parse a normal vector (vn x y z)
 */
const parseNormal = (parts: string[]): Result<Vec3, ParseError> => {
  if (parts.length < 3) {
    return Err({
      message: 'Normal requires 3 components',
      line: 0,
    });
  }

  const x = parseFloat(parts[0]);
  const y = parseFloat(parts[1]);
  const z = parseFloat(parts[2]);

  if (isNaN(x) || isNaN(y) || isNaN(z)) {
    return Err({
      message: 'Invalid normal values',
      line: 0,
    });
  }

  return Ok(createVec3(x, y, z));
};

/**
 * Parse a face index reference (can be v, v/vt, v/vt/vn, or v//vn)
 */
const parseFaceIndex = (ref: string): Result<{ posIndex: number; texIndex?: number; normIndex?: number }, ParseError> => {
  const parts = ref.split('/');
  
  // Must have at least the vertex index
  if (parts[0] === '') {
    return Err({
      message: `Invalid face index: ${ref}`,
      line: 0,
    });
  }

  const vertexIndex = parseInt(parts[0], 10);
  if (isNaN(vertexIndex)) {
    return Err({
      message: `Invalid face index: ${ref}`,
      line: 0,
    });
  }

  // OBJ uses 1-based indexing, convert to 0-based
  const posIndex = vertexIndex - 1;

  // Parse optional texture coordinate index
  const texIndex = parts[1] !== undefined && parts[1] !== '' 
    ? parseInt(parts[1], 10) - 1 
    : undefined;
  if (parts[1] !== undefined && parts[1] !== '' && isNaN(texIndex!)) {
    return Err({
      message: `Invalid texture index: ${ref}`,
      line: 0,
    });
  }

  // Parse optional normal index
  const normIndex = parts[2] !== undefined && parts[2] !== ''
    ? parseInt(parts[2], 10) - 1
    : undefined;
  if (parts[2] !== undefined && parts[2] !== '' && isNaN(normIndex!)) {
    return Err({
      message: `Invalid normal index: ${ref}`,
      line: 0,
    });
  }

  return Ok({ posIndex, texIndex, normIndex });
};

/**
 * Parse a face (f v1 v2 v3 ...)
 */
const parseFace = (parts: string[]): Result<Array<{ posIndex: number; texIndex?: number; normIndex?: number }>, ParseError> => {
  if (parts.length < 3) {
    return Err({
      message: 'Face must have at least 3 vertices',
      line: 0,
    });
  }

  const faceVertices: Array<{ posIndex: number; texIndex?: number; normIndex?: number }> = [];

  for (const part of parts) {
    const indexResult = parseFaceIndex(part);
    if (!indexResult.ok) {
      return Err({
        ...indexResult.error,
        line: 0,
      });
    }
    faceVertices.push(indexResult.value);
  }

  return Ok(faceVertices);
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

  const positions = vertices.map((v) => v.position);
  const min = createVec3(
    Math.min(...positions.map((p) => p.x)),
    Math.min(...positions.map((p) => p.y)),
    Math.min(...positions.map((p) => p.z))
  );
  const max = createVec3(
    Math.max(...positions.map((p) => p.x)),
    Math.max(...positions.map((p) => p.y)),
    Math.max(...positions.map((p) => p.z))
  );

  return { min, max };
};

/**
 * Main OBJ parser - pure function
 * Uses map, filter, reduce (higher-order functions)
 */
export const parseOBJ = (content: string): Result<Scene, ParseError> => {
  const lines = content.split('\n');

  const positions: Vec3[] = [];
  const normals: Vec3[] = [];
  const texCoords: { x: number; y: number }[] = [];
  const faces: { 
    vertices: Array<{ posIndex: number; texIndex?: number; normIndex?: number }>;
    material?: string 
  }[] = [];
  let currentMaterial: string | undefined;

  // Parse all lines using higher-order functions
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineResult = parseLine(line);

    if (!lineResult.ok) {
      // Skip empty/comment lines
      continue;
    }

    const [type, data] = lineResult.value;

    switch (type) {
      case 'v': {
        const posResult = parseVertexPosition(data);
        if (!posResult.ok) {
          return Err({
            ...posResult.error,
            line: i + 1,
          });
        }
        positions.push(posResult.value);
        break;
      }

      case 'vt': {
        const texResult = parseTextureCoord(data);
        if (!texResult.ok) {
          return Err({
            ...texResult.error,
            line: i + 1,
          });
        }
        texCoords.push(texResult.value);
        break;
      }

      case 'vn': {
        const normResult = parseNormal(data);
        if (!normResult.ok) {
          return Err({
            ...normResult.error,
            line: i + 1,
          });
        }
        normals.push(normResult.value);
        break;
      }

      case 'f': {
        const faceResult = parseFace(data);
        if (!faceResult.ok) {
          return Err({
            ...faceResult.error,
            line: i + 1,
          });
        }
        faces.push({
          vertices: faceResult.value,
          material: currentMaterial,
        });
        break;
      }

      case 'usemtl': {
        if (data.length > 0) {
          currentMaterial = data[0];
        }
        break;
      }

      // Ignore unsupported commands
      default:
        break;
    }
  }

  // Build vertices from positions, normals, and texture coordinates
  // For OBJ, we need to combine indexed data
  // For simplicity, create vertices based on face indices
  const vertices: Vertex[] = [];
  const vertexMap = new Map<string, number>();

  const getOrCreateVertex = (
    posIndex: number,
    texIndex?: number,
    normIndex?: number
  ): number => {
    const key = `${posIndex}-${texIndex ?? -1}-${normIndex ?? -1}`;

    if (vertexMap.has(key)) {
      return vertexMap.get(key)!;
    }

    const position = positions[posIndex];
    if (!position) {
      throw new Error(`Position index ${posIndex} out of bounds`);
    }

    const normal = normIndex !== undefined ? normals[normIndex] : undefined;
    const texCoord =
      texIndex !== undefined && texCoords[texIndex]
        ? createVec2(texCoords[texIndex].x, texCoords[texIndex].y)
        : undefined;

    const vertex = createVertex(position, normal, texCoord);
    const index = vertices.length;
    vertices.push(vertex);
    vertexMap.set(key, index);
    return index;
  };

  // Rebuild faces with new vertex indices by combining positions, normals, and texture coordinates
  const rebuiltFaces: Face[] = [];
  for (const face of faces) {
    const faceIndices: number[] = [];
    
    for (const faceVertex of face.vertices) {
      const vertexIndex = getOrCreateVertex(
        faceVertex.posIndex,
        faceVertex.texIndex,
        faceVertex.normIndex
      );
      faceIndices.push(vertexIndex);
    }
    
    rebuiltFaces.push(createFace(faceIndices, face.material));
  }

  // If we have positions but no faces, create vertices directly
  if (faces.length === 0 && positions.length > 0) {
    for (const position of positions) {
      vertices.push(createVertex(position));
    }
  }

  if (vertices.length === 0) {
    return Err({
      message: 'No vertices found in OBJ file',
      line: 0,
    });
  }

  // Create mesh
  const mesh = createMesh('default', vertices, rebuiltFaces);

  // Calculate metadata
  const boundingBox = calculateBoundingBox(vertices);
  const scene = createScene(
    [mesh],
    [],
    {
      format: 'OBJ',
      vertexCount: vertices.length,
      faceCount: rebuiltFaces.length,
      boundingBox,
    }
  );

  // Validate the scene
  const validationResult = validateScene(scene);
  if (!validationResult.ok) {
    return Err({
      message: `Validation error: ${validationResult.error.message}`,
      line: 0,
    });
  }

  return Ok(validationResult.value);
};
