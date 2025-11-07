/**
 * Composable validators using functional programming
 * All validators are pure functions that can be chained together
 */

import type { Scene, Vertex, Vec3, Vec2, Mesh } from '../types/scene';
import type { Result } from '../utils/result';
import { Ok, Err } from '../utils/result';

export type ValidationError = {
  readonly message: string;
  readonly code: string;
  readonly path?: string;
};

export type Validator<T> = (value: T) => Result<T, ValidationError>;

/**
 * Combine multiple validators into one (function composition)
 */
export const combine = <T>(
  ...validators: ReadonlyArray<Validator<T>>
): Validator<T> => {
  return (value: T): Result<T, ValidationError> => {
    for (const validator of validators) {
      const result = validator(value);
      if (!result.ok) {
        return result;
      }
    }
    return Ok(value);
  };
};

/**
 * Validate that a number is finite and not NaN
 */
export const validateNumber = (value: number): Result<number, ValidationError> => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return Err({
      message: `Invalid number: ${value}`,
      code: 'INVALID_NUMBER',
    });
  }
  return Ok(value);
};

/**
 * Validate that a 2D vector has valid components
 */
export const validateVec2 = (vec: Vec2): Result<Vec2, ValidationError> => {
  const xResult = validateNumber(vec.x);
  if (!xResult.ok) {
    return Err({
      ...xResult.error,
      path: 'vec2.x',
    });
  }

  const yResult = validateNumber(vec.y);
  if (!yResult.ok) {
    return Err({
      ...yResult.error,
      path: 'vec2.y',
    });
  }

  return Ok(vec);
};

/**
 * Validate that a vector has valid components
 */
export const validateVec3 = (vec: Vec3): Result<Vec3, ValidationError> => {
  const xResult = validateNumber(vec.x);
  if (!xResult.ok) {
    return Err({
      ...xResult.error,
      path: 'vec3.x',
    });
  }

  const yResult = validateNumber(vec.y);
  if (!yResult.ok) {
    return Err({
      ...yResult.error,
      path: 'vec3.y',
    });
  }

  const zResult = validateNumber(vec.z);
  if (!zResult.ok) {
    return Err({
      ...zResult.error,
      path: 'vec3.z',
    });
  }

  return Ok(vec);
};

/**
 * Validate that a vertex has valid position
 */
export const validateVertex = (vertex: Vertex): Result<Vertex, ValidationError> => {
  const positionResult = validateVec3(vertex.position);
  if (!positionResult.ok) {
    return Err({
      ...positionResult.error,
      path: 'vertex.position',
    });
  }

  if (vertex.normal !== undefined) {
    const normalResult = validateVec3(vertex.normal);
    if (!normalResult.ok) {
      return Err({
        ...normalResult.error,
        path: 'vertex.normal',
      });
    }
  }

  return Ok(vertex);
};

/**
 * Validate that face indices are within bounds
 */
export const validateFaceIndices = (
  indices: readonly number[],
  vertexCount: number
): Result<readonly number[], ValidationError> => {
  if (indices.length < 3) {
    return Err({
      message: 'Face must have at least 3 indices',
      code: 'INVALID_FACE_SIZE',
    });
  }

  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
      return Err({
        message: `Face index ${index} is out of bounds (0-${vertexCount - 1})`,
        code: 'INDEX_OUT_OF_BOUNDS',
      });
    }
  }

  return Ok(indices);
};

/**
 * Validate that mesh has valid structure
 */
export const validateMesh = (mesh: Mesh): Result<Mesh, ValidationError> => {
  if (mesh.vertices.length === 0) {
    return Err({
      message: 'Mesh must have at least one vertex',
      code: 'EMPTY_MESH',
      path: `mesh.${mesh.name}`,
    });
  }

  // Validate all vertices
  for (let i = 0; i < mesh.vertices.length; i++) {
    const vertexResult = validateVertex(mesh.vertices[i]);
    if (!vertexResult.ok) {
      return Err({
        ...vertexResult.error,
        path: `mesh.${mesh.name}.vertices[${i}]`,
      });
    }
  }

  // Validate all faces
  for (let i = 0; i < mesh.faces.length; i++) {
    const face = mesh.faces[i];
    const indicesResult = validateFaceIndices(face.indices, mesh.vertices.length);
    if (!indicesResult.ok) {
      return Err({
        ...indicesResult.error,
        path: `mesh.${mesh.name}.faces[${i}]`,
      });
    }
  }

  return Ok(mesh);
};

/**
 * Validate that scene has valid structure
 */
export const validateScene = (scene: Scene): Result<Scene, ValidationError> => {
  if (scene.meshes.length === 0) {
    return Err({
      message: 'Scene must have at least one mesh',
      code: 'EMPTY_SCENE',
    });
  }

  // Validate all meshes
  for (const mesh of scene.meshes) {
    const meshResult = validateMesh(mesh);
    if (!meshResult.ok) {
      return meshResult;
    }
  }

  // Validate metadata consistency
  const totalVertices = scene.meshes.reduce(
    (sum, mesh) => sum + mesh.vertices.length,
    0
  );
  const totalFaces = scene.meshes.reduce(
    (sum, mesh) => sum + mesh.faces.length,
    0
  );

  if (scene.metadata.vertexCount !== totalVertices) {
    return Err({
      message: `Metadata vertex count (${scene.metadata.vertexCount}) doesn't match actual count (${totalVertices})`,
      code: 'METADATA_MISMATCH',
      path: 'scene.metadata.vertexCount',
    });
  }

  if (scene.metadata.faceCount !== totalFaces) {
    return Err({
      message: `Metadata face count (${scene.metadata.faceCount}) doesn't match actual count (${totalFaces})`,
      code: 'METADATA_MISMATCH',
      path: 'scene.metadata.faceCount',
    });
  }

  return Ok(scene);
};

/**
 * Higher-order function: create a validator that checks non-empty arrays
 */
export const validateNonEmpty = <T>(
  items: readonly T[],
  itemName: string
): Result<readonly T[], ValidationError> => {
  if (items.length === 0) {
    return Err({
      message: `${itemName} array cannot be empty`,
      code: 'EMPTY_ARRAY',
    });
  }
  return Ok(items);
};
