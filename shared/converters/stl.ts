import type { Scene, Mesh, Vertex, Face, Vec3 } from "../types/scene";
import { type Result, Ok, Err, pipe, mapArray } from "../utils/result";
import { createVec3 } from "../types/scene";

export type ConvertError = { readonly message: string };

/**
 * Calculate face normal from three vertices
 */
const calculateFaceNormal = (v0: Vec3, v1: Vec3, v2: Vec3): Vec3 => {
  const u = createVec3(v1.x - v0.x, v1.y - v0.y, v1.z - v0.z);
  const v = createVec3(v2.x - v0.x, v2.y - v0.y, v2.z - v0.z);
  
  const nx = u.y * v.z - u.z * v.y;
  const ny = u.z * v.x - u.x * v.z;
  const nz = u.x * v.y - u.y * v.x;
  
  const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
  
  return length > 0 
    ? createVec3(nx / length, ny / length, nz / length)
    : createVec3(0, 0, 1);
};

/**
 * Convert a triangular face to STL facet lines
 */
const faceToFacetLines = (vertices: readonly Vertex[], face: Face): readonly string[] => {
  if (face.indices.length !== 3) {
    return [];
  }

  const [v0, v1, v2] = face.indices.map(idx => vertices[idx].position);
  const normal = calculateFaceNormal(v0, v1, v2);
  
  return [
    `facet normal ${normal.x} ${normal.y} ${normal.z}`,
    "  outer loop",
    `    vertex ${v0.x} ${v0.y} ${v0.z}`,
    `    vertex ${v1.x} ${v1.y} ${v1.z}`,
    `    vertex ${v2.x} ${v2.y} ${v2.z}`,
    "  endloop",
    "endfacet"
  ];
};

export const toSTL = (scene: Scene, solidName: string = "converted"): Result<string, ConvertError> =>
  pipe(
    scene.meshes,
    meshes => meshes.length === 0 
      ? Err({ message: "Scene contains no meshes" }) 
      : Ok(meshes),
    result =>
      result.ok
        ? Ok(
            result.value.flatMap(mesh =>
              mesh.faces.flatMap(face => 
                faceToFacetLines(mesh.vertices, face)
              )
            )
          )
        : result,
    result =>
      result.ok
        ? Ok(
            pipe(
              [`solid ${solidName}`],
              header =>
                header
                  .concat(result.value)
                  .concat(`endsolid ${solidName}`)
                  .join("\n")
            )
          )
        : result
  );