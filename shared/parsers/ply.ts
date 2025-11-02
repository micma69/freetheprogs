/**
 * Pure PLY parser using functional programming
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

export type ParseError = {
  readonly message: string;
  readonly line: number;
};

type PLYElement = {
  readonly name: string;
  readonly count: number;
  readonly properties: readonly string[];
};

type PLYHeader = {
  readonly format: "ascii" | "binary_little_endian" | "binary_big_endian";
  readonly version: string;
  readonly elements: Readonly<Record<string, PLYElement>>;
};

/**
 * Parse PLY header into structured data
 */
const parseFormat = (line: string, lineNumber: number): Result<{ format: PLYHeader["format"]; version: string }, ParseError> => {
  const parts = line.split(/\s+/);
  if (parts.length < 3) return Err({ message: "Invalid format line", line: lineNumber });

  const format = parts[1] as PLYHeader["format"];
  const version = parts[2];

  if (!["ascii", "binary_little_endian", "binary_big_endian"].includes(format)) {
    return Err({ message: `Unsupported format: ${format}`, line: lineNumber });
  }
  return Ok({ format, version });
};

const parseElement = (line: string, lineNumber: number): Result<PLYElement, ParseError> => {
  const parts = line.split(/\s+/);
  if (parts.length < 3) return Err({ message: "Invalid element line", line: lineNumber });

  const name = parts[1];
  const count = parseInt(parts[2], 10);
  
  if (isNaN(count)) return Err({ message: "Invalid element count", line: lineNumber });
  return Ok({ name, count, properties: [] });
};

const addPropertyToElement = (elem: PLYElement, property: string): PLYElement => ({
  ...elem,
  properties: [...elem.properties, property],
});

const parseProperty = (line: string, lineNumber: number): Result<string, ParseError> => {
  const parts = line.split(/\s+/);
  if (parts.length < 2) return Err({ message: "Invalid property line", line: lineNumber });
  const propertyName = parts[parts.length - 1];
  return Ok(propertyName);
};

const parseHeader = (lines: readonly string[]): Result<{ header: PLYHeader; dataStartIndex: number }, ParseError> => {
  if (lines[0]?.trim() !== "ply") {
    return Err({ message: "Missing 'ply' header", line: 1 });
  }

  let format: PLYHeader["format"] = "ascii";
  let version = "1.0";
  const elements: Record<string, PLYElement> = {};
  let currentElement: PLYElement | null = null;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "end_header") {
      return Ok({
        header: { format, version, elements },
        dataStartIndex: i + 1,
      });
    }

    if (line === "" || line.startsWith("comment")) continue;

    if (line.startsWith("format")) {
      const result = parseFormat(line, i + 1);
      if (!result.ok) return result;
      ({ format, version } = result.value);
      continue;
    }

    if (line.startsWith("element")) {
      const result = parseElement(line, i + 1);
      if (!result.ok) return result;
      currentElement = result.value;
      elements[currentElement.name] = currentElement;
      continue;
    }

    if (line.startsWith("property")) {
      if (!currentElement) return Err({ message: "Property without element", line: i + 1 });
      const result = parseProperty(line, i + 1);
      if (!result.ok) return result;
      currentElement = addPropertyToElement(currentElement, result.value);
      elements[currentElement.name] = currentElement;
    }
  }

  return Err({ message: "Missing end_header", line: lines.length });
};

/**
 * Parse ASCII body (vertices and faces)
 */
const parseBody = (
  lines: readonly string[],
  header: PLYHeader,
  startIndex: number
): Result<{ vertices: readonly Vec3[]; faces: readonly Face[] }, ParseError> => {
  const vertexElem = header.elements["vertex"];
  const faceElem = header.elements["face"];

  if (!vertexElem) {
    return Err({ message: "Missing vertex element", line: startIndex });
  }

  const vertices: Vec3[] = [];
  const faces: Face[] = [];
  let lineIndex = startIndex;

  // Parse vertex lines
  for (let i = 0; i < vertexElem.count; i++) {
    const line = lines[lineIndex++]?.trim();
    if (!line) return Err({ message: "Unexpected end of file in vertex list", line: lineIndex });
    const parts = line.split(/\s+/).map(parseFloat);
    if (parts.length < 3) {
      return Err({ message: "Invalid vertex line", line: lineIndex });
    }

    // Support optional color properties if present (r, g, b)
    const [x, y, z] = parts;
    vertices.push(createVec3(x, y, z));
  }

  // Parse face lines (optional)
  if (faceElem) {
    for (let i = 0; i < faceElem.count; i++) {
      const line = lines[lineIndex++]?.trim();
      if (!line) return Err({ message: "Unexpected end of file in face list", line: lineIndex });
      const parts = line.split(/\s+/).map(parseFloat);
      const vertexCount = parts[0];
      if (isNaN(vertexCount) || vertexCount < 3) {
        return Err({ message: "Invalid face vertex count", line: lineIndex });
      }

      const indices = parts.slice(1, 1 + vertexCount).map((n) => n | 0);
      faces.push(createFace(indices));
    }
  }

  return Ok({
    vertices: Object.freeze(vertices),
    faces: Object.freeze(faces),
  });
};

/**
 * Top-level PLY parser
 */
export const parsePLY = (content: string): Result<Scene, ParseError> => {
  const lines = Object.freeze(content.split(/\r?\n/));
  if (lines.length === 0) {
    return Err({ message: "Empty PLY file", line: 0 });
  }

  const headerResult = parseHeader(lines);
  if (!headerResult.ok) return headerResult;

  const { header, dataStartIndex } = headerResult.value;

  if (header.format !== "ascii") {
    return Err({ message: "Only ASCII PLY supported", line: 0 });
  }

  const bodyResult = parseBody(lines, header, dataStartIndex);
  if (!bodyResult.ok) return bodyResult;

  const { vertices, faces } = bodyResult.value;

  // Build vertex objects
  const vertexObjects: Vertex[] = vertices.map((pos) => createVertex(pos));
  const mesh = createMesh("default", vertexObjects, faces);

  const scene = createScene(
    [mesh],
    [],
    {
      format: "PLY",
      vertexCount: vertexObjects.length,
      faceCount: faces.length,
    }
  );

  return Ok(scene);
};