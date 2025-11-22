import type { Scene, Mesh, Vertex, Face } from "../types/scene";
import { type Result, Ok, Err, pipe, mapArray, flatMapArray } from "../utils/result";

export type ConvertError = { readonly message: string };

const formatVertex = (v: Vertex): string =>
  [
    v.position.x,
    v.position.y,
    v.position.z,
    v.normal?.x ?? 0,
    v.normal?.y ?? 0,
    v.normal?.z ?? 0,
    v.texCoord?.x ?? 0,
    v.texCoord?.y ?? 0,
  ].join(" ");

const formatFace = (f: Face): string =>
  `${f.indices.length} ${f.indices.join(" ")}`;

export const convertToPLY = (scene: Scene): Result<string, ConvertError> =>
  pipe(
    scene.meshes,
    // flatten all meshes → vertices & faces
    meshes =>
      meshes.length === 0
        ? Err({ message: "Scene contains no meshes" })
        : Ok(meshes),
    flatMapResult => flatMapResult.ok
      ? Ok({
          vertices: flatMapArray((m: Mesh) => m.vertices)(flatMapResult.value),
          faces: flatMapArray((m: Mesh) => m.faces)(flatMapResult.value),
        })
      : flatMapResult,
    result =>
      result.ok
        ? Ok(
            pipe(
              [
                "ply",
                "format ascii 1.0",
                `element vertex ${result.value.vertices.length}`,
                "property float x",
                "property float y",
                "property float z",
                "property float nx",
                "property float ny",
                "property float nz",
                "property float s",
                "property float t",
                `element face ${result.value.faces.length}`,
                "property list uchar int vertex_indices",
                "end_header",
              ],
              header =>
                header
                  .concat(
                    mapArray(formatVertex)(result.value.vertices)
                  )
                  .concat(
                    mapArray(formatFace)(result.value.faces)
                  )
                  .join("\n")
            )
          )
        : result
  );
