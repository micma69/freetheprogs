import { Ok, Err, type Result } from "../utils/result";
import type { Scene } from "../types/scene";

export const convertSceneToPLY = (scene: Scene): Result<string, string> => {
  // --- Validate scene ----------------------------------------------------

  if (!scene.meshes || scene.meshes.length === 0) {
    return Err("Scene contains no meshes");
  }

  const mesh = scene.meshes[0];

  if (!mesh.vertices || mesh.vertices.length === 0) {
    return Err("Mesh contains no vertices");
  }

  if (!mesh.faces || mesh.faces.length === 0) {
    return Err("Mesh contains no faces");
  }

  const vertices = mesh.vertices;
  const faces = mesh.faces;

  // --- Build header -------------------------------------------------------

  const header =
    [
      "ply",
      "format ascii 1.0",
      `element vertex ${vertices.length}`,
      "property float x",
      "property float y",
      "property float z",
      "property float nx",
      "property float ny",
      "property float nz",
      `element face ${faces.length}`,
      "property list uchar int vertex_indices",
      "end_header",
    ].join("\n") + "\n";

  // --- Build vertex section (pure mapping) -------------------------------

  const vertexLines = vertices
    .map((v) => {
      const nx = v.normal?.x ?? 0;
      const ny = v.normal?.y ?? 0;
      const nz = v.normal?.z ?? 0;

      return [
        v.position.x,
        v.position.y,
        v.position.z,
        nx,
        ny,
        nz,
      ].join(" ");
    })
    .join("\n");

  // --- Build face section -------------------------------------------------

  const faceLines = faces
    .map((f) => `${f.indices.length} ${f.indices.join(" ")}`)
    .join("\n");

  // --- Combine result (still pure) ---------------------------------------

  const ply = `${header}${vertexLines}\n${faceLines}\n`;

  return Ok(ply);
};
