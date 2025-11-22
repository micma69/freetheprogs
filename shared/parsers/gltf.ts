/**
 * Pure GLTF parser using functional programming with proper composition
 * Returns Result<Scene, Error> for monadic error handling
 */

import type { Scene, Vertex, Vec3, Face, Material } from '../types/scene';
import type { Result } from '../utils/result';
import { Ok, Err, map, mapErr, andThen, all, pipe } from '../utils/result';
import {
  createVec3,
  createVec2,
  createVertex,
  createFace,
  createMesh,
  createMaterial,
  createScene,
} from '../types/scene';

export type GLTFParseError = {
  readonly message: string;
  readonly path?: string;
};

// Node transformation type
type NodeTransform = {
  readonly matrix: readonly number[];
  readonly nodeIndex: number;
  readonly meshIndex: number;
};

// GLTF JSON Type Definitions
type GLTFJson = {
  readonly asset: { readonly version: string };
  readonly scene?: number;
  readonly scenes?: readonly GLTFScene[];
  readonly nodes?: readonly GLTFNode[];
  readonly meshes?: readonly GLTFMesh[];
  readonly accessors?: readonly GLTFAccessor[];
  readonly bufferViews?: readonly GLTFBufferView[];
  readonly buffers?: readonly GLTFBuffer[];
  readonly materials?: readonly GLTFMaterial[];
};

type GLTFScene = {
  readonly name?: string;
  readonly nodes?: readonly number[];
};

type GLTFNode = {
  readonly name?: string;
  readonly mesh?: number;
  readonly matrix?: readonly number[];
  readonly translation?: readonly number[];
  readonly rotation?: readonly number[];
  readonly scale?: readonly number[];
  readonly children?: readonly number[];
};

type GLTFMesh = {
  readonly name?: string;
  readonly primitives: readonly GLTFPrimitive[];
};

type GLTFPrimitive = {
  readonly attributes: {
    readonly POSITION?: number;
    readonly NORMAL?: number;
    readonly TEXCOORD_0?: number;
  };
  readonly indices?: number;
  readonly material?: number;
  readonly mode?: number;
};

type GLTFAccessor = {
  readonly bufferView?: number;
  readonly byteOffset?: number;
  readonly componentType: number;
  readonly count: number;
  readonly type: string;
  readonly max?: readonly number[];
  readonly min?: readonly number[];
};

type GLTFBufferView = {
  readonly buffer: number;
  readonly byteOffset?: number;
  readonly byteLength: number;
  readonly byteStride?: number;
  readonly target?: number;
};

type GLTFBuffer = {
  readonly byteLength: number;
  readonly uri?: string;
};

type GLTFMaterial = {
  readonly name?: string;
  readonly pbrMetallicRoughness?: {
    readonly baseColorFactor?: readonly number[];
    readonly metallicFactor?: number;
    readonly roughnessFactor?: number;
  };
  readonly emissiveFactor?: readonly number[];
};

// Component type constants
const ComponentType = {
  BYTE: 5120,
  UNSIGNED_BYTE: 5121,
  SHORT: 5122,
  UNSIGNED_SHORT: 5123,
  UNSIGNED_INT: 5125,
  FLOAT: 5126,
} as const;

const ComponentSize: Record<number, number> = {
  [ComponentType.BYTE]: 1,
  [ComponentType.UNSIGNED_BYTE]: 1,
  [ComponentType.SHORT]: 2,
  [ComponentType.UNSIGNED_SHORT]: 2,
  [ComponentType.UNSIGNED_INT]: 4,
  [ComponentType.FLOAT]: 4,
};

const TypeSize: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

/**
 * Normalize a vector
 */
const normalize = (v: { x: number; y: number; z: number }): Vec3 => {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len > 0.0001) {
    return createVec3(v.x / len, v.y / len, v.z / len);
  }
  return createVec3(0, 1, 0); // default up
};

/**
 * Parse JSON content
 */
const parseJSON = (content: string): Result<GLTFJson, GLTFParseError> => {
  try {
    const json = JSON.parse(content) as GLTFJson;
    
    if (!json.asset || !json.asset.version) {
      return Err({ message: 'Invalid GLTF: missing asset information' });
    }
    
    return Ok(json);
  } catch (e) {
    return Err({ 
      message: `Failed to parse JSON: ${e instanceof Error ? e.message : 'unknown error'}` 
    });
  }
};

/**
 * Decode base64 URI to ArrayBuffer
 */
const decodeDataURI = (uri: string): Result<ArrayBuffer, GLTFParseError> => {
  try {
    const base64Match = uri.match(/^data:.*?;base64,(.*)$/);
    if (!base64Match) {
      return Err({ message: 'Invalid data URI format' });
    }
    
    const base64 = base64Match[1];
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    return Ok(bytes.buffer);
  } catch (e) {
    return Err({ 
      message: `Failed to decode data URI: ${e instanceof Error ? e.message : 'unknown error'}` 
    });
  }
};

/**
 * Load buffer data - updated to handle external buffers
 */
const loadBuffer = (
  buffer: GLTFBuffer,
  index: number,
  externalBuffers?: Map<string, ArrayBuffer>
): Result<ArrayBuffer, GLTFParseError> => {
  if (!buffer.uri) {
    return Err({ 
      message: `Buffer ${index} has no URI` 
    });
  }
  
  // Handle data URI (embedded)
  if (buffer.uri.startsWith('data:')) {
    return decodeDataURI(buffer.uri);
  }
  
  // Handle external buffer
  if (externalBuffers) {
    const bufferData = externalBuffers.get(buffer.uri);
    if (bufferData) {
      return Ok(bufferData);
    }
  }
  
  return Err({ 
    message: `External buffer not provided: ${buffer.uri}` 
  });
};

/**
 * Load all buffers 
 */
const loadBuffers = (
  gltf: GLTFJson,
  externalBuffers?: Map<string, ArrayBuffer>
): Result<readonly ArrayBuffer[], GLTFParseError> => {
  if (!gltf.buffers || gltf.buffers.length === 0) {
    return Ok([]);
  }
  
  const bufferResults = gltf.buffers.map((buffer, i) => 
    loadBuffer(buffer, i, externalBuffers)
  );
  return all(bufferResults);
};

/**
 * Read typed array from accessor
 */
const readAccessor = (
  gltf: GLTFJson,
  buffers: readonly ArrayBuffer[],
  accessorIndex: number
): Result<Float32Array | Uint16Array | Uint32Array, GLTFParseError> => {
  const accessor = gltf.accessors?.[accessorIndex];
  if (!accessor) {
    return Err({ message: `Accessor ${accessorIndex} not found` });
  }
  
  const bufferViewIndex = accessor.bufferView;
  if (bufferViewIndex === undefined) {
    return Err({ message: `Accessor ${accessorIndex} has no bufferView` });
  }
  
  const bufferView = gltf.bufferViews?.[bufferViewIndex];
  if (!bufferView) {
    return Err({ message: `BufferView ${bufferViewIndex} not found` });
  }
  
  const buffer = buffers[bufferView.buffer];
  if (!buffer) {
    return Err({ message: `Buffer ${bufferView.buffer} not found` });
  }
  
  const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  const componentSize = ComponentSize[accessor.componentType];
  const elementSize = TypeSize[accessor.type];
  const totalElements = accessor.count * elementSize;
  
  try {
    switch (accessor.componentType) {
      case ComponentType.FLOAT:
        return Ok(new Float32Array(buffer, byteOffset, totalElements));
      case ComponentType.UNSIGNED_SHORT:
        return Ok(new Uint16Array(buffer, byteOffset, totalElements));
      case ComponentType.UNSIGNED_INT:
        return Ok(new Uint32Array(buffer, byteOffset, totalElements));
      default:
        return Err({ 
          message: `Unsupported component type: ${accessor.componentType}` 
        });
    }
  } catch (e) {
    return Err({ 
      message: `Failed to read accessor: ${e instanceof Error ? e.message : 'unknown error'}` 
    });
  }
};

/**
 * Convert typed array to Vec3 array
 */
const toVec3Array = (data: Float32Array): readonly Vec3[] => {
  const result: Vec3[] = [];
  for (let i = 0; i < data.length; i += 3) {
    result.push(createVec3(data[i], data[i + 1], data[i + 2]));
  }
  return result;
};

/**
 * Convert typed array to Vec2 array
 */
const toVec2Array = (data: Float32Array): readonly { x: number; y: number }[] => {
  const result: { x: number; y: number }[] = [];
  for (let i = 0; i < data.length; i += 2) {
    result.push({ x: data[i], y: data[i + 1] });
  }
  return result;
};

/**
 * Parse GLTF material
 */
const parseMaterial = (
  gltfMaterial: GLTFMaterial
): Material => {
  const pbr = gltfMaterial.pbrMetallicRoughness;
  const baseColor = pbr?.baseColorFactor;
  
  return createMaterial(
    gltfMaterial.name || 'default',
    {
      diffuse: baseColor 
        ? createVec3(baseColor[0], baseColor[1], baseColor[2])
        : undefined,
      ambient: gltfMaterial.emissiveFactor
        ? createVec3(
            gltfMaterial.emissiveFactor[0],
            gltfMaterial.emissiveFactor[1],
            gltfMaterial.emissiveFactor[2]
          )
        : undefined,
      shininess: pbr?.roughnessFactor !== undefined 
        ? (1 - pbr.roughnessFactor) * 128 
        : undefined,
    }
  );
};

/**
 * Parse GLTF materials
 */
const parseMaterials = (
  gltf: GLTFJson
): readonly Material[] => {
  if (!gltf.materials) {
    return [];
  }
  
  return gltf.materials.map(parseMaterial);
};

/**
 * Build vertices from primitive attributes
 */
const buildPrimitiveVertices = (
  gltf: GLTFJson,
  buffers: readonly ArrayBuffer[],
  primitive: GLTFPrimitive
): Result<readonly Vertex[], GLTFParseError> => {
  const { attributes } = primitive;
  
  if (attributes.POSITION === undefined) {
    return Err({ message: 'Primitive missing POSITION attribute' });
  }
  
  // Read positions
  const positionsResult = readAccessor(gltf, buffers, attributes.POSITION);
  if (!positionsResult.ok) {
    return positionsResult;
  }
  const positions = toVec3Array(positionsResult.value as Float32Array);
  
  // Read normals (optional)
  let normals: readonly Vec3[] | undefined;
  if (attributes.NORMAL !== undefined) {
    const normalsResult = readAccessor(gltf, buffers, attributes.NORMAL);
    if (normalsResult.ok) {
      normals = toVec3Array(normalsResult.value as Float32Array);
    }
  }
  
  // Read texture coordinates (optional)
  let texCoords: readonly { x: number; y: number }[] | undefined;
  if (attributes.TEXCOORD_0 !== undefined) {
    const texCoordsResult = readAccessor(gltf, buffers, attributes.TEXCOORD_0);
    if (texCoordsResult.ok) {
      texCoords = toVec2Array(texCoordsResult.value as Float32Array);
    }
  }
  
  // Build vertices
  const vertices = positions.map((pos, i) => 
    createVertex(
      pos,
      normals?.[i],
      texCoords?.[i] ? createVec2(texCoords[i].x, texCoords[i].y) : undefined
    )
  );
  
  return Ok(vertices);
};

/**
 * Build faces from indices
 */
const buildPrimitiveFaces = (
  gltf: GLTFJson,
  buffers: readonly ArrayBuffer[],
  primitive: GLTFPrimitive,
  materialName?: string
): Result<readonly Face[], GLTFParseError> => {
  if (primitive.indices === undefined) {
    return Ok([]);
  }
  
  const indicesResult = readAccessor(gltf, buffers, primitive.indices);
  if (!indicesResult.ok) {
    return indicesResult;
  }
  
  const indices = Array.from(indicesResult.value);
  const faces: Face[] = [];
  
  // Assuming triangles (mode 4 or default)
  for (let i = 0; i < indices.length; i += 3) {
    faces.push(createFace([indices[i], indices[i + 1], indices[i + 2]], materialName));
  }
  
  return Ok(faces);
};

/**
 * Calculate bounding box
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
 * Basic 4x4 matrix helpers (minimal, self-contained)
 */
const createMat4 = (): readonly number[] => [
  1,0,0,0,
  0,1,0,0,
  0,0,1,0,
  0,0,0,1
];

const multiplyMat4 = (a: readonly number[], b: readonly number[]): readonly number[] => {
  const out = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[r * 4 + k] * b[k * 4 + c];
      }
      out[r * 4 + c] = sum;
    }
  }
  return out;
};

const transformVec3 = (m: readonly number[], v: { x: number; y: number; z: number }): Vec3 => {
  const x = v.x, y = v.y, z = v.z;
  const w = m[3]*x + m[7]*y + m[11]*z + m[15];
  const tx = (m[0]*x + m[4]*y + m[8]*z + m[12]) / w;
  const ty = (m[1]*x + m[5]*y + m[9]*z + m[13]) / w;
  const tz = (m[2]*x + m[6]*y + m[10]*z + m[14]) / w;
  return createVec3(tx, ty, tz);
};

/**
 * Transform a normal by the inverse-transpose of the 3x3 part of the matrix.
 */
const transformNormal = (m: readonly number[], n: { x: number; y: number; z: number }): Vec3 => {
  // Build 3x3
  const a00 = m[0], a01 = m[4], a02 = m[8];
  const a10 = m[1], a11 = m[5], a12 = m[9];
  const a20 = m[2], a21 = m[6], a22 = m[10];

  // compute cofactors (adjugate) as proxy for inverse-transpose
  const c00 =  a11 * a22 - a12 * a21;
  const c01 = -(a10 * a22 - a12 * a20);
  const c02 =  a10 * a21 - a11 * a20;
  const c10 = -(a01 * a22 - a02 * a21);
  const c11 =  a00 * a22 - a02 * a20;
  const c12 = -(a00 * a21 - a01 * a20);
  const c20 =  a01 * a12 - a02 * a11;
  const c21 = -(a00 * a12 - a02 * a10);
  const c22 =  a00 * a11 - a01 * a10;

  const nx = c00 * n.x + c10 * n.y + c20 * n.z;
  const ny = c01 * n.x + c11 * n.y + c21 * n.z;
  const nz = c02 * n.x + c12 * n.y + c22 * n.z;

  return normalize({ x: nx, y: ny, z: nz });
};

/**
 * Convert quaternion to matrix
 */
const quaternionToMat4 = (quat: readonly number[]): readonly number[] => {
  const [x, y, z, w] = quat;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;

  return [
    1 - (yy + zz), xy + wz, xz - wy, 0,
    xy - wz, 1 - (xx + zz), yz + wx, 0,
    xz + wy, yz - wx, 1 - (xx + yy), 0,
    0, 0, 0, 1
  ];
};

/**
 * Get transformation matrix for a node
 */
const getNodeMatrix = (node: GLTFNode): readonly number[] => {
  if (node.matrix) {
    return [...node.matrix];
  }

  // Start with identity
  let mat = createMat4();

  // Apply translation
  if (node.translation) {
    const [tx, ty, tz] = node.translation;
    const tMat = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      tx, ty, tz, 1
    ];
    mat = multiplyMat4(mat, tMat);
  }

  // Apply rotation (quaternion)
  if (node.rotation) {
    const rMat = quaternionToMat4(node.rotation);
    mat = multiplyMat4(mat, rMat);
  }

  // Apply scale
  if (node.scale) {
    const [sx, sy, sz] = node.scale;
    const sMat = [
      sx, 0, 0, 0,
      0, sy, 0, 0,
      0, 0, sz, 0,
      0, 0, 0, 1
    ];
    mat = multiplyMat4(mat, sMat);
  }

  return mat;
};

/**
 * Recursively collect all node transformations that contain meshes
 */
const collectMeshNodes = (
  gltf: GLTFJson,
  nodeIndex: number,
  parentMatrix: readonly number[],
  collected: NodeTransform[]
): void => {
  const node = gltf.nodes?.[nodeIndex];
  if (!node) return;

  const nodeMatrix = getNodeMatrix(node);
  const worldMatrix = multiplyMat4(parentMatrix, nodeMatrix);

  if (node.mesh !== undefined) {
    collected.push({ 
      matrix: worldMatrix, 
      nodeIndex,
      meshIndex: node.mesh 
    });
  }

  if (node.children) {
    node.children.forEach(childIndex => {
      collectMeshNodes(gltf, childIndex, worldMatrix, collected);
    });
  }
};

/**
 * Find all mesh nodes in the scene
 */
const findMeshNodes = (
  gltf: GLTFJson
): Result<readonly NodeTransform[], GLTFParseError> => {
  const sceneIndex = gltf.scene ?? 0;
  const scene = gltf.scenes?.[sceneIndex];

  if (!scene) {
    return Err({ message: `Scene ${sceneIndex} not found` });
  }

  const meshNodes: NodeTransform[] = [];

  if (scene.nodes) {
    scene.nodes.forEach(nodeIndex => {
      collectMeshNodes(gltf, nodeIndex, createMat4(), meshNodes);
    });
  }

  return Ok(meshNodes);
};

/**
 * Transform vertices and normals by node matrix
 */
const transformMeshData = (
  vertices: readonly Vertex[],
  matrix: readonly number[]
): readonly Vertex[] => {
  return vertices.map(vertex => {
    const transformedPosition = transformVec3(matrix, vertex.position);
    const transformedNormal = vertex.normal
      ? transformNormal(matrix, vertex.normal)
      : undefined;

    return createVertex(
      transformedPosition,
      transformedNormal,
      vertex.texCoord
    );
  });
};

/**
 * Parse a GLTF mesh with node transformation
 */
const parseMeshWithTransformation = (
  gltf: GLTFJson,
  buffers: readonly ArrayBuffer[],
  gltfMesh: GLTFMesh,
  materials: readonly Material[],
  transformMatrix: readonly number[]
): Result<readonly { vertices: readonly Vertex[]; faces: readonly Face[] }[], GLTFParseError> => {
  const primitiveResults = gltfMesh.primitives.map(primitive => {
    const verticesResult = buildPrimitiveVertices(gltf, buffers, primitive);
    if (!verticesResult.ok) {
      return verticesResult;
    }

    const transformedVertices = transformMeshData(verticesResult.value, transformMatrix);

    const material = primitive.material !== undefined
      ? materials[primitive.material]
      : undefined;

    const facesResult = buildPrimitiveFaces(
      gltf,
      buffers,
      primitive,
      material?.name
    );
    if (!facesResult.ok) {
      return facesResult;
    }

    return Ok({ vertices: transformedVertices, faces: facesResult.value });
  });

  return all(primitiveResults);
};

/**
 * Build scene from GLTF data with proper node transformations
 */
const buildSceneWithNodes = (
  gltf: GLTFJson,
  buffers: readonly ArrayBuffer[]
): Result<Scene, GLTFParseError> => {
  const materials = parseMaterials(gltf);

  // Find all mesh nodes in the scene graph
  const meshNodesResult = findMeshNodes(gltf);
  if (!meshNodesResult.ok) {
    return meshNodesResult;
  }

  const meshNodes = meshNodesResult.value;

  if (meshNodes.length === 0) {
    return Err({ message: 'No meshes found in GLTF scene' });
  }

  // Parse all meshes with their transformations
  const meshResults = meshNodes.map(({ matrix, nodeIndex, meshIndex }) => {
    const gltfMesh = gltf.meshes![meshIndex];

    const parseResult = parseMeshWithTransformation(
      gltf,
      buffers,
      gltfMesh,
      materials,
      matrix
    );

    if (!parseResult.ok) {
      return parseResult;
    }

    const primitives = parseResult.value;
    const allVertices = primitives.flatMap(p => p.vertices);
    const allFaces = primitives.flatMap(p => p.faces);

    return Ok(
      createMesh(
        gltfMesh.name || `mesh_${meshIndex}_node_${nodeIndex}`,
        allVertices,
        allFaces
      )
    );
  });

  const meshesResult = all(meshResults);
  if (!meshesResult.ok) {
    return meshesResult;
  }

  const meshes = meshesResult.value;

  const allVertices = meshes.flatMap(m => m.vertices);
  const allFaces = meshes.flatMap(m => m.faces);
  const boundingBox = calculateBoundingBox(allVertices);

  const scene = createScene(
    meshes,
    materials,
    {
      format: 'GLTF',
      vertexCount: allVertices.length,
      faceCount: allFaces.length,
      boundingBox,
    }
  );

  return Ok(scene);
};

/**
 * Updated main GLTF parser with node support
 */
export const parseGLTF = (
  content: string,
  externalBuffers?: Map<string, ArrayBuffer>
): Result<Scene, GLTFParseError> => {
  return pipe(
    parseJSON(content),
    (r) => andThen(r, gltf =>
      andThen(
        loadBuffers(gltf, externalBuffers),
        buffers => Ok({ gltf, buffers })
      )
    ),
    (r) => andThen(r, ({ gltf, buffers }) => buildSceneWithNodes(gltf, buffers))
  );
};