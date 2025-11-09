/**
 * Pure PLY parser using functional programming
 * Returns Result<Scene, Error> for monadic error handling
 * Supports ASCII, binary_little_endian, and binary_big_endian formats
 */

import type { Scene, Vertex, Vec3, Vec2, Face, Mesh, Material } from '../types/scene';
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
 * ASCII body parser that handles normals and texture coordinates
 */
const parseAsciiBody = (
  lines: readonly string[],
  header: PLYHeader,
  startIndex: number
): Result<{ vertices: readonly Vertex[]; faces: readonly Face[] }, ParseError> => {
  const vertexElem = header.elements["vertex"];
  const faceElem = header.elements["face"];

  if (!vertexElem) {
    return Err({ message: "Missing vertex element", line: startIndex });
  }

  const vertices: Vertex[] = [];
  const faces: Face[] = [];
  let lineIndex = startIndex;

  // Parse vertex lines with support for normals and texture coordinates
  for (let i = 0; i < vertexElem.count; i++) {
    const line = lines[lineIndex++]?.trim();
    if (!line) return Err({ message: "Unexpected end of file in vertex list", line: lineIndex });
    
    const parts = line.split(/\s+/).map(parseFloat);
    const vertexData = parseAsciiVertexProperties(parts, vertexElem.properties);
    
    if (!vertexData.ok) return vertexData;
    
    vertices.push(createVertex(
      vertexData.value.position,
      vertexData.value.normal,
      vertexData.value.texCoord
    ));
  }

  // Parse face lines
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
 * Parse ASCII vertex properties with support for normals and texture coordinates
 */
const parseAsciiVertexProperties = (
  values: number[],
  properties: readonly string[]
): Result<{ position: Vec3; normal?: Vec3; texCoord?: Vec2 }, ParseError> => {
  let position: Vec3 | undefined;
  let normal: Vec3 | undefined;
  let texCoord: Vec2 | undefined;

  for (let i = 0; i < properties.length; i++) {
    const prop = properties[i];
    const value = values[i];
    
    if (isNaN(value)) {
      return Err({ message: `Invalid vertex property value for ${prop}`, line: -1 });
    }

    switch (prop) {
      case 'x':
        if (!position) position = createVec3(value, 0, 0);
        else position = createVec3(value, position.y, position.z);
        break;
      case 'y':
        if (!position) position = createVec3(0, value, 0);
        else position = createVec3(position.x, value, position.z);
        break;
      case 'z':
        if (!position) position = createVec3(0, 0, value);
        else position = createVec3(position.x, position.y, value);
        break;
      case 'nx':
        if (!normal) normal = createVec3(value, 0, 0);
        else normal = createVec3(value, normal.y, normal.z);
        break;
      case 'ny':
        if (!normal) normal = createVec3(0, value, 0);
        else normal = createVec3(normal.x, value, normal.z);
        break;
      case 'nz':
        if (!normal) normal = createVec3(0, 0, value);
        else normal = createVec3(normal.x, normal.y, value);
        break;
      case 's': case 'u': case 'texture_u':
        if (!texCoord) texCoord = createVec2(value, 0);
        else texCoord = createVec2(value, texCoord.y);
        break;
      case 't': case 'v': case 'texture_v':
        if (!texCoord) texCoord = createVec2(0, value);
        else texCoord = createVec2(texCoord.x, value);
        break;
      // Ignore color properties
      case 'r': case 'g': case 'b': case 'red': case 'green': case 'blue': case 'alpha':
        break;
    }
  }

  if (!position) {
    return Err({ message: "Missing vertex position data", line: -1 });
  }

  return Ok({ position, normal, texCoord });
};

/**
 * Parse binary PLY from ArrayBuffer
 */
const parseBinaryFromArrayBuffer = (buffer: ArrayBuffer): Result<Scene, ParseError> => {
  // Extract header text (first ~1KB)
  const headerBytes = new Uint8Array(buffer, 0, Math.min(1024, buffer.byteLength));
  const headerText = new TextDecoder('ascii').decode(headerBytes);
  const headerLines = headerText.split('\n');

  const headerResult = parseHeader(headerLines);
  if (!headerResult.ok) return headerResult;

  const { header } = headerResult.value;

  // Find binary data start (after "end_header")
  const endHeaderIndex = headerText.indexOf('end_header');
  if (endHeaderIndex === -1) {
    return Err({ message: "Could not find end_header", line: -1 });
  }

  // Calculate exact binary data start position
  let binaryStart = endHeaderIndex + 'end_header'.length;
  
  // Skip line endings
  const nextChar = headerText[binaryStart];
  if (nextChar === '\r') binaryStart++;
  if (headerText[binaryStart] === '\n') binaryStart++;

  // Get binary data directly from ArrayBuffer
  const binaryData = buffer.slice(binaryStart);
  const bodyResult = parseBinaryBodyFromArrayBuffer(binaryData, header);
  if (!bodyResult.ok) return bodyResult;

  const { vertices, faces } = bodyResult.value;

  const mesh = createMesh("default", vertices, faces);
  const boundingBox = calculateBoundingBox(vertices);

  const scene = createScene(
    [mesh],
    [],
    {
      format: "PLY",
      vertexCount: vertices.length,
      faceCount: faces.length,
      boundingBox
    }
  );

  return Ok(scene);
};

/**
 * Parse binary body from ArrayBuffer
 */
const parseBinaryBodyFromArrayBuffer = (
  buffer: ArrayBuffer,
  header: PLYHeader
): Result<{ vertices: readonly Vertex[]; faces: readonly Face[] }, ParseError> => {
  const vertexElem = header.elements["vertex"];
  const faceElem = header.elements["face"];

  if (!vertexElem) {
    return Err({ message: "Missing vertex element", line: -1 });
  }

  const littleEndian = header.format === "binary_little_endian";
  const dataView = new DataView(buffer);
  let offset = 0;

  const vertices: Vertex[] = [];
  const faces: Face[] = [];

  // Helper functions
  const readFloat32 = (): Result<number, ParseError> => {
    if (offset + 4 > buffer.byteLength) {
      return Err({ message: "Unexpected end of file in binary data", line: -1 });
    }
    const value = dataView.getFloat32(offset, littleEndian);
    offset += 4;
    return Ok(value);
  };

  const readUint8 = (): Result<number, ParseError> => {
    if (offset + 1 > buffer.byteLength) {
      return Err({ message: "Unexpected end of file in binary data", line: -1 });
    }
    const value = dataView.getUint8(offset);
    offset += 1;
    return Ok(value);
  };

  const readInt32 = (): Result<number, ParseError> => {
    if (offset + 4 > buffer.byteLength) {
      return Err({ message: "Unexpected end of file in binary data", line: -1 });
    }
    const value = dataView.getInt32(offset, littleEndian);
    offset += 4;
    return Ok(value);
  };

  // Parse vertices
  for (let i = 0; i < vertexElem.count; i++) {
    let position: Vec3 | undefined;

    for (const prop of vertexElem.properties) {
      if (prop === 'x' || prop === 'y' || prop === 'z') {
        const valueResult = readFloat32();
        if (!valueResult.ok) return valueResult;
        
        if (prop === 'x') position = createVec3(valueResult.value, position?.y || 0, position?.z || 0);
        if (prop === 'y') position = createVec3(position?.x || 0, valueResult.value, position?.z || 0);
        if (prop === 'z') position = createVec3(position?.x || 0, position?.y || 0, valueResult.value);
      } else {
        // Skip other vertex properties - assume float32
        const skipResult = readFloat32();
        if (!skipResult.ok) return skipResult;
      }
    }

    if (!position) {
      return Err({ message: "Missing vertex position data", line: -1 });
    }

    vertices.push(createVertex(position));
  }

  // Parse faces
  if (faceElem) {
    for (let i = 0; i < faceElem.count; i++) {
      let vertexCount: number = 0;
      const indices: number[] = [];
      
      // Process each face property in the exact order from header
      for (const prop of faceElem.properties) {
        if (prop === 'vertex_indices' || prop === 'vertex_index') {
          // This is the list property - read count and indices
          const countResult = readUint8();
          if (!countResult.ok) return countResult;
          
          vertexCount = countResult.value;
          
          for (let j = 0; j < vertexCount; j++) {
            const indexResult = readInt32();
            if (!indexResult.ok) return indexResult;
            indices.push(indexResult.value);
          }
        } else if (prop === 'red' || prop === 'green' || prop === 'blue' || prop === 'alpha') {
          // Skip color properties - these are SINGLE values (not lists)
          const skipResult = readUint8();
          if (!skipResult.ok) return skipResult;
        }
      }

      if (indices.length > 0) {
        faces.push(createFace(indices));
      }
    }
  }

  return Ok({
    vertices: Object.freeze(vertices),
    faces: Object.freeze(faces),
  });
};

/**
 * Calculate bounding box for scene metadata
 */
const calculateBoundingBox = (vertices: readonly Vertex[]): { readonly min: Vec3; readonly max: Vec3 } | undefined => {
  if (vertices.length === 0) return undefined;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const vertex of vertices) {
    const { x, y, z } = vertex.position;
    minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
  }

  return {
    min: createVec3(minX, minY, minZ),
    max: createVec3(maxX, maxY, maxZ)
  };
};

/**
 * Parse ASCII PLY from string
 */
const parseASCII = (content: string): Result<Scene, ParseError> => {
  const lines = Object.freeze(content.split(/\r?\n/));
  if (lines.length === 0) {
    return Err({ message: "Empty PLY file", line: 0 });
  }

  const headerResult = parseHeader(lines);
  if (!headerResult.ok) return headerResult;

  const { header, dataStartIndex } = headerResult.value;

  // Allow ASCII format to proceed
  if (header.format !== "ascii") {
    // If it's binary but passed as string, try to parse it anyway (fallback)
    console.warn('Binary PLY passed as string - attempting fallback parsing');
  }

  const bodyResult = parseAsciiBody(lines, header, dataStartIndex);
  if (!bodyResult.ok) return bodyResult;

  const { vertices, faces } = bodyResult.value;

  const mesh = createMesh("default", vertices, faces);
  const boundingBox = calculateBoundingBox(vertices);

  const scene = createScene(
    [mesh],
    [],
    {
      format: "PLY",
      vertexCount: vertices.length,
      faceCount: faces.length,
      boundingBox
    }
  );

  return Ok(scene);
};

/**
 * Top-level PLY parser - handles both string and ArrayBuffer inputs correctly
 */
export const parsePLY = (content: string | ArrayBuffer): Result<Scene, ParseError> => {
  try {
    // Handle string input (ASCII PLY)
    if (typeof content === 'string') {
      return parseASCII(content);
    }
    
    // Handle ArrayBuffer input (could be ASCII or binary)
    const headerView = new Uint8Array(content, 0, Math.min(1024, content.byteLength));
    const headerText = new TextDecoder('utf-8').decode(headerView);
    
    // More robust format detection
    const isBinary = headerText.includes('format binary_');
    
    if (isBinary) {
      return parseBinaryFromArrayBuffer(content);
    } else {
      // It's ASCII format but came as ArrayBuffer
      const fullText = new TextDecoder('utf-8').decode(new Uint8Array(content));
      return parseASCII(fullText);
    }
  } catch (error) {
    return { success: false, error: new ParseError(`Failed to parse PLY: ${error}`) };
  }
};