/**
 * Pure PLY parser using functional programming
 * Returns Result<Scene, Error> for monadic error handling
 * Supports ASCII, binary_little_endian, and binary_big_endian formats
 */

import type { Scene, Vertex, Vec3, Vec2, Face, Mesh } from '../types/scene';
import type { Result } from '../utils/result';
import { Ok, Err, map, andThen, pipe, all, takeArray, dropArray, zipArray, traverse } from '../utils/result';
import {
  createVec3,
  createVec2,
  createVertex,
  createFace,
  createMesh,
  createScene,
} from '../types/scene';

export type ParseError = {
  readonly message: string;
  readonly line: number;
};

type PLYProperty = {
  readonly name: string;
  readonly type: string;
  readonly isList: boolean;
  readonly listType?: string;
};

type PLYElement = {
  readonly name: string;
  readonly count: number;
  readonly properties: readonly PLYProperty[];
};

type PLYHeader = {
  readonly format: "ascii" | "binary_little_endian" | "binary_big_endian";
  readonly version: string;
  readonly elements: Readonly<Record<string, PLYElement>>;
};

type VertexData = {
  readonly position: Vec3;
  readonly normal?: Vec3;
  readonly texCoord?: Vec2;
};

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

const parseProperty = (line: string, lineNumber: number): Result<PLYProperty, ParseError> => {
  const parts = line.split(/\s+/);
  if (parts.length < 3) return Err({ message: "Invalid property line", line: lineNumber });
  
  if (parts[1] === 'list') {
    if (parts.length < 5) return Err({ message: "Invalid list property line", line: lineNumber });
    return Ok({
      name: parts[4],
      type: parts[3],
      isList: true,
      listType: parts[2]
    });
  }
  
  return Ok({
    name: parts[2],
    type: parts[1],
    isList: false
  });
};

const addPropertyToElement = (property: PLYProperty) => (elem: PLYElement): PLYElement => ({
  ...elem,
  properties: [...elem.properties, property],
});

const processHeaderLine = (
  state: Result<{ header: Omit<PLYHeader, 'elements'> & { elements: Record<string, PLYElement> }; currentElement: PLYElement | null }, ParseError>,
  line: string,
  lineNumber: number
): Result<{ header: Omit<PLYHeader, 'elements'> & { elements: Record<string, PLYElement> }; currentElement: PLYElement | null }, ParseError> => {
  if (!state.ok) return state;

  const { header, currentElement } = state.value;
  const trimmed = line.trim();
  
  if (trimmed === "end_header") return Ok({ header, currentElement });
  if (trimmed === "" || trimmed.startsWith("comment")) return Ok({ header, currentElement });

  if (trimmed.startsWith("format")) {
    return pipe(
      parseFormat(trimmed, lineNumber),
      result => map(result, ({ format, version }) => ({
        header: { ...header, format, version },
        currentElement
      }))
    );
  }

  if (trimmed.startsWith("element")) {
    return pipe(
      parseElement(trimmed, lineNumber),
      result => map(result, element => ({
        header: { ...header, elements: { ...header.elements, [element.name]: element } },
        currentElement: element
      }))
    );
  }

  if (trimmed.startsWith("property")) {
    if (!currentElement) return Err({ message: "Property without element", line: lineNumber });
    
    return pipe(
      parseProperty(trimmed, lineNumber),
      result => map(result, property => {
        const updatedElement = addPropertyToElement(property)(currentElement);
        return {
          header: { ...header, elements: { ...header.elements, [updatedElement.name]: updatedElement } },
          currentElement: updatedElement
        };
      })
    );
  }

  return Ok({ header, currentElement });
};

const parseHeader = (lines: readonly string[]): Result<{ header: PLYHeader; dataStartIndex: number }, ParseError> => {
  if (lines[0]?.trim() !== "ply") {
    return Err({ message: "Missing 'ply' header", line: 1 });
  }

  const endHeaderIndex = lines.findIndex(line => line.trim() === "end_header");
  if (endHeaderIndex === -1) {
    return Err({ message: "Missing end_header", line: lines.length });
  }

  const headerLines = lines.slice(1, endHeaderIndex);
  const initialState: Result<{ header: Omit<PLYHeader, 'elements'> & { elements: Record<string, PLYElement> }; currentElement: PLYElement | null }, ParseError> = 
    Ok({ 
      header: { format: "ascii" as const, version: "1.0", elements: {} }, 
      currentElement: null 
    });

  const finalState = headerLines.reduce(
    (state, line, i) => processHeaderLine(state, line, i + 2),
    initialState
  );

  return pipe(
    finalState,
    result => map(result, ({ header }) => ({
      header: header as PLYHeader,
      dataStartIndex: endHeaderIndex + 1
    }))
  );
};

const parseAsciiVertexProperties = (
  values: number[],
  properties: readonly PLYProperty[]
): Result<VertexData, ParseError> => {
  const propertyValuePairs = zipArray(properties, values);
  
  const initialData: VertexData = { position: createVec3(0, 0, 0) };
  
  const finalResult = propertyValuePairs.reduce(
    (acc: Result<VertexData, ParseError>, [prop, value]) => 
      pipe(
        acc,
        result => andThen(result, data => {
          if (isNaN(value)) {
            return Err({ message: `Invalid vertex property value for ${prop.name}`, line: -1 });
          }

          const updatePosition = (updater: (pos: Vec3) => Vec3) => ({
            ...data,
            position: updater(data.position)
          });

          const updateNormal = (updater: (normal: Vec3) => Vec3) => ({
            ...data,
            normal: data.normal ? updater(data.normal) : updater(createVec3(0, 0, 0))
          });

          const updateTexCoord = (updater: (texCoord: Vec2) => Vec2) => ({
            ...data,
            texCoord: data.texCoord ? updater(data.texCoord) : updater(createVec2(0, 0))
          });

          switch (prop.name) {
            case 'x': return Ok(updatePosition(pos => createVec3(value, pos.y, pos.z)));
            case 'y': return Ok(updatePosition(pos => createVec3(pos.x, value, pos.z)));
            case 'z': return Ok(updatePosition(pos => createVec3(pos.x, pos.y, value)));
            case 'nx': return Ok(updateNormal(normal => createVec3(value, normal.y, normal.z)));
            case 'ny': return Ok(updateNormal(normal => createVec3(normal.x, value, normal.z)));
            case 'nz': return Ok(updateNormal(normal => createVec3(normal.x, normal.y, value)));
            case 's': case 'u': case 'texture_u': 
              return Ok(updateTexCoord(tex => createVec2(value, tex.y)));
            case 't': case 'v': case 'texture_v': 
              return Ok(updateTexCoord(tex => createVec2(tex.x, value)));
            default: return Ok(data);
          }
        })
      ),
    Ok(initialData) as Result<VertexData, ParseError>
  );

  return pipe(
    finalResult,
    result => andThen(result, data => 
      data.position.x === 0 && data.position.y === 0 && data.position.z === 0
        ? Err({ message: "Missing vertex position data", line: -1 })
        : Ok(data)
    )
  );
};

const parseAsciiVertexLine = (properties: readonly PLYProperty[]) => (line: string): Result<Vertex, ParseError> => 
  pipe(
    parseAsciiVertexProperties(line.trim().split(/\s+/).map(parseFloat), properties),
    result => map(result, ({ position, normal, texCoord }) => 
      createVertex(position, normal, texCoord)
    )
  );

const parseAsciiFaceLine = (line: string): Result<Face, ParseError> => {
  const parts = line.trim().split(/\s+/).map(parseFloat);
  const vertexCount = parts[0];
  
  if (isNaN(vertexCount) || vertexCount < 3) {
    return Err({ message: "Invalid face vertex count", line: -1 });
  }
  
  const indices = parts.slice(1, 1 + vertexCount).map((n) => n | 0);
  return Ok(createFace(indices));
};

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

  const bodyLines = lines.slice(startIndex);
  const vertexLines = takeArray(vertexElem.count)(bodyLines);
  const faceLines = faceElem ? takeArray(faceElem.count)(dropArray(vertexElem.count)(bodyLines)) : [];

  return pipe(
    traverse(parseAsciiVertexLine(vertexElem.properties))(vertexLines),
    result => andThen(result, vertices =>
      faceElem
        ? pipe(
            traverse(parseAsciiFaceLine)(faceLines),
            result => map(result, faces => ({ vertices, faces }))
          )
        : Ok({ vertices, faces: [] as readonly Face[] })
    )
  );
};

const createBinaryReader = (dataView: DataView, littleEndian: boolean) => {
  let offset = 0;

  const readers = {
    'char': (): Result<number, ParseError> => {
      if (offset + 1 > dataView.byteLength) return Err({ message: "Unexpected EOF", line: -1 });
      const value = dataView.getInt8(offset);
      offset += 1;
      return Ok(value);
    },
    'uchar': (): Result<number, ParseError> => {
      if (offset + 1 > dataView.byteLength) return Err({ message: "Unexpected EOF", line: -1 });
      const value = dataView.getUint8(offset);
      offset += 1;
      return Ok(value);
    },
    'short': (): Result<number, ParseError> => {
      if (offset + 2 > dataView.byteLength) return Err({ message: "Unexpected EOF", line: -1 });
      const value = dataView.getInt16(offset, littleEndian);
      offset += 2;
      return Ok(value);
    },
    'ushort': (): Result<number, ParseError> => {
      if (offset + 2 > dataView.byteLength) return Err({ message: "Unexpected EOF", line: -1 });
      const value = dataView.getUint16(offset, littleEndian);
      offset += 2;
      return Ok(value);
    },
    'int': (): Result<number, ParseError> => {
      if (offset + 4 > dataView.byteLength) return Err({ message: "Unexpected EOF", line: -1 });
      const value = dataView.getInt32(offset, littleEndian);
      offset += 4;
      return Ok(value);
    },
    'uint': (): Result<number, ParseError> => {
      if (offset + 4 > dataView.byteLength) return Err({ message: "Unexpected EOF", line: -1 });
      const value = dataView.getUint32(offset, littleEndian);
      offset += 4;
      return Ok(value);
    },
    'float': (): Result<number, ParseError> => {
      if (offset + 4 > dataView.byteLength) return Err({ message: "Unexpected EOF", line: -1 });
      const value = dataView.getFloat32(offset, littleEndian);
      offset += 4;
      return Ok(value);
    },
    'double': (): Result<number, ParseError> => {
      if (offset + 8 > dataView.byteLength) return Err({ message: "Unexpected EOF", line: -1 });
      const value = dataView.getFloat64(offset, littleEndian);
      offset += 8;
      return Ok(value);
    }
  };

  const read = (type: string): Result<number, ParseError> => {
    const reader = readers[type as keyof typeof readers];
    if (!reader) return Err({ message: `Unsupported data type: ${type}`, line: -1 });
    return reader();
  };

  const skip = (type: string): Result<void, ParseError> => {
    const sizes: Record<string, number> = {
      'char': 1, 'uchar': 1,
      'short': 2, 'ushort': 2,
      'int': 4, 'uint': 4,
      'float': 4, 'double': 8
    };
    const size = sizes[type];
    if (!size) return Err({ message: `Unknown type size: ${type}`, line: -1 });
    
    if (offset + size > dataView.byteLength) {
      return Err({ message: "Unexpected EOF while skipping", line: -1 });
    }
    offset += size;
    return Ok(undefined);
  };

  return { read, skip, getOffset: () => offset, setOffset: (newOffset: number) => { offset = newOffset; } };
};

const parseBinaryVertex = (reader: ReturnType<typeof createBinaryReader>, properties: readonly PLYProperty[]): Result<Vertex, ParseError> => {
  const initialData: VertexData = { position: createVec3(0, 0, 0) };
  
  const finalResult = properties.reduce(
    (acc: Result<VertexData, ParseError>, prop) => 
      pipe(
        acc,
        result => andThen(result, data =>
          pipe(
            reader.read(prop.type),
            result => map(result, value => {
              const updatePosition = (updater: (pos: Vec3) => Vec3) => ({
                ...data,
                position: updater(data.position)
              });

              const updateNormal = (updater: (normal: Vec3) => Vec3) => ({
                ...data,
                normal: data.normal ? updater(data.normal) : updater(createVec3(0, 0, 0))
              });

              const updateTexCoord = (updater: (texCoord: Vec2) => Vec2) => ({
                ...data,
                texCoord: data.texCoord ? updater(data.texCoord) : updater(createVec2(0, 0))
              });

              switch (prop.name) {
                case 'x': return updatePosition(pos => createVec3(value, pos.y, pos.z));
                case 'y': return updatePosition(pos => createVec3(pos.x, value, pos.z));
                case 'z': return updatePosition(pos => createVec3(pos.x, pos.y, value));
                case 'nx': return updateNormal(normal => createVec3(value, normal.y, normal.z));
                case 'ny': return updateNormal(normal => createVec3(normal.x, value, normal.z));
                case 'nz': return updateNormal(normal => createVec3(normal.x, normal.y, value));
                case 's': case 'u': case 'texture_u': return updateTexCoord(tex => createVec2(value, tex.y));
                case 't': case 'v': case 'texture_v': return updateTexCoord(tex => createVec2(tex.x, value));
                default: return data;
              }
            })
          )
        )
      ),
    Ok(initialData) as Result<VertexData, ParseError>
  );

  return pipe(
    finalResult,
    result => andThen(result, data =>
      data.position ? Ok(createVertex(data.position, data.normal, data.texCoord)) 
      : Err({ message: "Missing vertex position data", line: -1 })
    )
  );
};

const parseBinaryFace = (reader: ReturnType<typeof createBinaryReader>, properties: readonly PLYProperty[]): Result<Face, ParseError> => {
  const initialIndices: number[] = [];
  
  const finalResult = properties.reduce(
    (acc: Result<number[], ParseError>, prop) =>
      pipe(
        acc,
        result => andThen(result, indices => {
          if (prop.isList && (prop.name === 'vertex_indices' || prop.name === 'vertex_index')) {
            return pipe(
              reader.read(prop.listType!),
              result => andThen(result, vertexCount =>
                all(Array.from({ length: vertexCount }, () => reader.read(prop.type)))
              ),
              result => map(result, newIndices => [...indices, ...newIndices])
            );
          } else {
            return pipe(
              reader.skip(prop.type),
              result => map(result, () => indices)
            );
          }
        })
      ),
    Ok(initialIndices) as Result<number[], ParseError>
  );

  return map(finalResult, indices => createFace(indices));
};

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
  const reader = createBinaryReader(dataView, littleEndian);

  return pipe(
    all(Array.from({ length: vertexElem.count }, () => parseBinaryVertex(reader, vertexElem.properties))),
    result => andThen(result, vertices =>
      faceElem
        ? pipe(
            all(Array.from({ length: faceElem.count }, () => parseBinaryFace(reader, faceElem.properties))),
            result => map(result, faces => ({ vertices, faces }))
          )
        : Ok({ vertices, faces: [] as readonly Face[] })
    )
  );
};

const calculateBoundingBox = (vertices: readonly Vertex[]): { readonly min: Vec3; readonly max: Vec3 } | undefined => {
  if (vertices.length === 0) return undefined;

  return vertices.reduce(
    (acc, vertex) => {
      const { x, y, z } = vertex.position;
      return {
        min: createVec3(Math.min(acc.min.x, x), Math.min(acc.min.y, y), Math.min(acc.min.z, z)),
        max: createVec3(Math.max(acc.max.x, x), Math.max(acc.max.y, y), Math.max(acc.max.z, z))
      };
    },
    {
      min: createVec3(Infinity, Infinity, Infinity),
      max: createVec3(-Infinity, -Infinity, -Infinity)
    }
  );
};

const createSceneFromMeshData = (vertices: readonly Vertex[], faces: readonly Face[]): Scene => {
  const boundingBox = calculateBoundingBox(vertices);
  return createScene(
    [createMesh("default", vertices, faces)],
    [],
    {
      format: "PLY",
      vertexCount: vertices.length,
      faceCount: faces.length,
      boundingBox
    }
  );
};

const parseBinaryFromArrayBuffer = (buffer: ArrayBuffer): Result<Scene, ParseError> => {
  const headerBytes = new Uint8Array(buffer, 0, Math.min(1024, buffer.byteLength));
  const headerText = new TextDecoder('ascii').decode(headerBytes);
  const headerLines = headerText.split('\n');

  return pipe(
    parseHeader(headerLines),
    result => andThen(result, ({ header }) => {
      const endHeaderIndex = headerText.indexOf('end_header');
      if (endHeaderIndex === -1) {
        return Err({ message: "Could not find end_header", line: -1 });
      }

      let binaryStart = endHeaderIndex + 'end_header'.length;
      const nextChar = headerText[binaryStart];
      if (nextChar === '\r') binaryStart++;
      if (headerText[binaryStart] === '\n') binaryStart++;

      return pipe(
        parseBinaryBodyFromArrayBuffer(buffer.slice(binaryStart), header),
        result => map(result, ({ vertices, faces }) => createSceneFromMeshData(vertices, faces))
      );
    })
  );
};

const parseASCII = (content: string): Result<Scene, ParseError> => {
  const lines = Object.freeze(content.split(/\r?\n/));
  if (lines.length === 0) {
    return Err({ message: "Empty PLY file", line: 0 });
  }

  return pipe(
    parseHeader(lines),
    result => andThen(result, ({ header, dataStartIndex }) =>
      pipe(
        parseAsciiBody(lines, header, dataStartIndex),
        result => map(result, ({ vertices, faces }) => createSceneFromMeshData(vertices, faces))
      )
    )
  );
};

/**
 * Top-level PLY parser - handles both string and ArrayBuffer inputs correctly
 */
const safeTextDecoder = {
  decode: (buffer: ArrayBuffer, byteLength: number): Result<string, ParseError> => {
    try {
      const view = new Uint8Array(buffer, 0, Math.min(byteLength, buffer.byteLength));
      return Ok(new TextDecoder('utf-8').decode(view));
    } catch (error) {
      return Err({ message: `Text decoding failed: ${error}`, line: -1 });
    }
  }
};

const safeArrayBufferDetection = (content: ArrayBuffer): Result<Scene, ParseError> => {
  const maybeHeader = safeTextDecoder.decode(content, 1024);
  if (!maybeHeader.ok) return Err(maybeHeader.error);

  const headerText = maybeHeader.value;

  // decide binary vs ascii
  if (headerText.includes('format binary_')) {
    return parseBinaryFromArrayBuffer(content);
  }

  // otherwise decode full file as text and parse ASCII
  const maybeFullText = safeTextDecoder.decode(content, content.byteLength);
  if (!maybeFullText.ok) return Err(maybeFullText.error);

  return parseASCII(maybeFullText.value);
};

export const parsePLY = (content: string | ArrayBuffer): Result<Scene, ParseError> =>
  typeof content === 'string' 
    ? parseASCII(content)
    : safeArrayBufferDetection(content);