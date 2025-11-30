/**
 * Pure functional STL parser using functional programming
 * Produces Result<Scene, ParseError>
 */

import type { Scene, Mesh, Vertex, Face, Vec3 } from "../types/scene";
import type { Result } from "../utils/result";

import { Ok, Err, map, andThen, pipe } from "../utils/result";
import { createVec3, createVertex, createFace, createMesh, createScene } from "../types/scene";

export type ParseError = {
  readonly message: string;
  readonly line: number;
};

const detectSTLType = (buffer: Buffer): Result<"ascii" | "binary", ParseError> => {
  if (buffer.length < 6) {
    return Err({ message: "File too small to be STL", line: 0 });
  }

  const ascii = buffer.toString("utf8");

  // Must start with "solid <word>" AND include "facet"
  const trimmed = ascii.trimStart().toLowerCase();

  if (trimmed.startsWith("solid")) {
    // ASCII STLs always contain "facet normal"
    if (trimmed.includes("facet normal")) {
      return Ok("ascii");
    }
  }

  // Otherwise must be binary
  if (buffer.length >= 84) return Ok("binary");

  return Err({ message: "Unrecognized STL format", line: 0 });
};

/**
 * ASCII STL Parser
 */

const parseAsciiSTL = (text: string): Result<Scene, ParseError> => {
  if (!text.trim().toLowerCase().startsWith("solid")) {
    return Err({ message: "ASCII STL must begin with 'solid'", line: 1 });
  }

  const lines = text.split(/\r?\n/);

  const vertices: Vertex[] = [];
  const faces: Face[] = [];

  let currentTriangle: Vec3[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();

    if (raw.startsWith("vertex")) {
      const parts = raw.split(/\s+/).slice(1).map(Number);
      if (parts.length !== 3 || parts.some(isNaN)) {
        return Err({ message: "Invalid vertex line", line: i + 1 });
      }
      currentTriangle.push(createVec3(parts[0], parts[1], parts[2]));
    }

    if (raw.startsWith("endloop")) {
      if (currentTriangle.length !== 3) {
        return Err({ message: "Triangle does not have 3 vertices", line: i + 1 });
      }

      const baseIndex = vertices.length;
      vertices.push(
        createVertex(currentTriangle[0]),
        createVertex(currentTriangle[1]),
        createVertex(currentTriangle[2])
      );

      faces.push(createFace([baseIndex, baseIndex + 1, baseIndex + 2]));
      currentTriangle = [];
    }
  }

  return Ok(
    createScene(
      [createMesh("stl", vertices, faces)],
      [],
      {
        format: "STL",
        vertexCount: vertices.length,
        faceCount: faces.length,
      }
    )
  );
};

/**
 * Binary STL Parser
 */

const parseBinarySTL = (buffer: Buffer): Result<Scene, ParseError> => {
  if (buffer.length < 84) {
    return Err({ message: "Binary STL too small", line: 0 });
  }

  const count = buffer.readUInt32LE(80);
  const expected = 84 + count * 50;

  if (expected > buffer.length) {
    return Err({ message: "Binary STL is truncated", line: 0 });
  }

  const vertices: Vertex[] = [];
  const faces: Face[] = [];

  let offset = 84;

  for (let i = 0; i < count; i++) {
    if (offset + 50 > buffer.length) {
      return Err({ message: "Unexpected end of file", line: i });
    }

    // skip normal
    offset += 12;

    const v1 = createVec3(
      buffer.readFloatLE(offset),
      buffer.readFloatLE(offset + 4),
      buffer.readFloatLE(offset + 8)
    );
    const v2 = createVec3(
      buffer.readFloatLE(offset + 12),
      buffer.readFloatLE(offset + 16),
      buffer.readFloatLE(offset + 20)
    );
    const v3 = createVec3(
      buffer.readFloatLE(offset + 24),
      buffer.readFloatLE(offset + 28),
      buffer.readFloatLE(offset + 32)
    );

    const base = vertices.length;
    vertices.push(createVertex(v1), createVertex(v2), createVertex(v3));
    faces.push(createFace([base, base + 1, base + 2]));

    offset += 50;
  }

  return Ok(
    createScene(
      [createMesh("stl", vertices, faces)],
      [],
      {
        format: "STL",
        vertexCount: vertices.length,
        faceCount: faces.length,
      }
    )
  );
};

/**
 * Top-level STL Parser
 */

export const parseSTLFromBuffer = (buffer: Buffer): Result<Scene, ParseError> =>
  pipe(
    detectSTLType(buffer),
    result =>
      andThen(result, type =>
        type === "ascii"
          ? parseAsciiSTL(buffer.toString("utf8"))
          : parseBinarySTL(buffer)
      )
  );
