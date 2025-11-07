/**
 * Immutable 3D scene data types
 * All types are readonly to ensure immutability
 */

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface Vertex {
  readonly position: Vec3;
  readonly normal?: Vec3;
  readonly texCoord?: Vec2;
}

export interface Face {
  readonly indices: readonly number[];
  readonly material?: string;
}

export interface Material {
  readonly name: string;
  readonly ambient?: Vec3;
  readonly diffuse?: Vec3;
  readonly specular?: Vec3;
  readonly shininess?: number;
  readonly textureMap?: string;
}

export interface Mesh {
  readonly name: string;
  readonly vertices: readonly Vertex[];
  readonly faces: readonly Face[];
  readonly material?: Material;
}

export interface Scene {
  readonly meshes: readonly Mesh[];
  readonly materials: readonly Material[];
  readonly metadata: {
    readonly format: string;
    readonly vertexCount: number;
    readonly faceCount: number;
    readonly boundingBox?: {
      readonly min: Vec3;
      readonly max: Vec3;
    };
  };
}

/**
 * Pure functions for creating immutable structures
 */
export const createVec3 = (x: number, y: number, z: number): Vec3 => ({
  x,
  y,
  z,
});

export const createVec2 = (x: number, y: number): Vec2 => ({
  x,
  y,
});

export const createVertex = (
  position: Vec3,
  normal?: Vec3,
  texCoord?: Vec2
): Vertex => ({
  position,
  normal,
  texCoord,
});

export const createFace = (
  indices: readonly number[],
  material?: string
): Face => ({
  indices: Object.freeze([...indices]),
  material,
});

export const createMaterial = (
  name: string,
  properties?: {
    ambient?: Vec3;
    diffuse?: Vec3;
    specular?: Vec3;
    shininess?: number;
    textureMap?: string;
  }
): Material => ({
  name,
  ...properties,
});

export const createMesh = (
  name: string,
  vertices: readonly Vertex[],
  faces: readonly Face[],
  material?: Material
): Mesh => ({
  name,
  vertices: Object.freeze([...vertices]),
  faces: Object.freeze([...faces]),
  material,
});

export const createScene = (
  meshes: readonly Mesh[],
  materials: readonly Material[],
  metadata: Scene['metadata']
): Scene => ({
  meshes: Object.freeze([...meshes]),
  materials: Object.freeze([...materials]),
  metadata: { ...metadata },
});
