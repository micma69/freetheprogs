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
 * Load buffer data
 */
const loadBuffer = (
  buffer: GLTFBuffer,
  index: number
): Result<ArrayBuffer, GLTFParseError> => {
  if (!buffer.uri) {
    return Err({ 
      message: `Buffer ${index} has no URI (external buffers not supported in this implementation)` 
    });
  }
  
  if (buffer.uri.startsWith('data:')) {
    return decodeDataURI(buffer.uri);
  }
  
  return Err({ 
    message: `External buffer URIs not supported: ${buffer.uri}` 
  });
};

/**
 * Load all buffers
 */
const loadBuffers = (
  gltf: GLTFJson
): Result<readonly ArrayBuffer[], GLTFParseError> => {
  if (!gltf.buffers || gltf.buffers.length === 0) {
    return Ok([]);
  }
  
  const bufferResults = gltf.buffers.map((buffer, i) => loadBuffer(buffer, i));
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
 * Parse a GLTF mesh
 */
const parseMesh = (
  gltf: GLTFJson,
  buffers: readonly ArrayBuffer[],
  gltfMesh: GLTFMesh,
  materials: readonly Material[]
): Result<readonly { vertices: readonly Vertex[]; faces: readonly Face[] }[], GLTFParseError> => {
  const primitiveResults = gltfMesh.primitives.map(primitive => {
    const verticesResult = buildPrimitiveVertices(gltf, buffers, primitive);
    if (!verticesResult.ok) {
      return verticesResult;
    }
    
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
    
    return Ok({ vertices: verticesResult.value, faces: facesResult.value });
  });
  
  return all(primitiveResults);
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
 * Build scene from GLTF data
 */
const buildScene = (
  gltf: GLTFJson,
  buffers: readonly ArrayBuffer[]
): Result<Scene, GLTFParseError> => {
  const materials = parseMaterials(gltf);
  
  if (!gltf.meshes || gltf.meshes.length === 0) {
    return Err({ message: 'No meshes found in GLTF' });
  }
  
  // Parse all meshes
  const meshResults = gltf.meshes.map((gltfMesh, i) => 
    andThen(
      parseMesh(gltf, buffers, gltfMesh, materials),
      primitives => {
        // Combine all primitives into single mesh
        const allVertices = primitives.flatMap(p => [...p.vertices]);
        const allFaces = primitives.flatMap(p => [...p.faces]);
        
        return Ok(
          createMesh(
            gltfMesh.name || `mesh_${i}`,
            allVertices,
            allFaces
          )
        );
      }
    )
  );
  
  return andThen(
    all(meshResults),
    meshes => {
      const allVertices = meshes.flatMap(m => [...m.vertices]);
      const allFaces = meshes.flatMap(m => [...m.faces]);
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
    }
  );
};

/**
 * Main GLTF parser using pure functional composition
 */
export const parseGLTF = (content: string): Result<Scene, GLTFParseError> => {
  return pipe(
    parseJSON(content),
    (r: Result<GLTFJson, GLTFParseError>) => andThen(r, gltf => 
      andThen(loadBuffers(gltf), buffers => Ok({ gltf, buffers }))
    ),
    (r: Result<{ gltf: GLTFJson; buffers: readonly ArrayBuffer[] }, GLTFParseError>) => 
      andThen(r, ({ gltf, buffers }) => buildScene(gltf, buffers))
  );
};