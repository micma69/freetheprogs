/**
 * Pure STL parser using functional programming
 * Returns Result<Scene, Error> for monadic error handling
 *
 * Implemented as a functional, pure parser for ASCII STL.
 * Binary STL is detected and returns an error (not supported here).
 *
 * The parser does not assume a specific Scene shape; it builds a plain
 * JS object describing meshes/triangles and casts it to Scene so it
 * integrates easily with surrounding code. This keeps the parser pure
 * and focused on extraction of geometry.
 */

import type { Scene } from '../types/scene';
import type { Result } from '../utils/result';
import { Ok, Err } from '../utils/result';

export type ParseError = {
  readonly message: string;
  readonly line?: number;
};

type Vec3 = [number, number, number];

type Triangle = {
  readonly normal: Vec3;
  readonly vertices: [Vec3, Vec3, Vec3];
};

const trim = (s: string) => s.trim();

const isProbablyBinary = (content: string): boolean => {
  // Heuristic: if the file starts with 'solid' but contains a null byte,
  // it's likely binary. Also binary STL often has non-ASCII bytes.
  if (!content) return false;
  if (!/^solid\s/i.test(content)) return false;
  return /[\x00-\x08\x0E-\x1F]/.test(content);
};

const parseFloatStrict = (s: string): number => {
  // Use Number to parse floats and keep NaN if invalid
  return Number(s);
};

const parseTriple = (parts: string[]): Vec3 => {
  const [a = '0', b = '0', c = '0'] = parts;
  return [parseFloatStrict(a), parseFloatStrict(b), parseFloatStrict(c)];
};

const parseFacetBlock = (block: string): Result<Triangle, ParseError> => {
  // Parse normal
  const normalMatch = /facet\s+normal\s+([^\r\n]+)\r?\n/i.exec(block);
  if (!normalMatch) {
    return Err({ message: 'Missing facet normal' });
  }
  const normalParts = normalMatch[1].trim().split(/\s+/);
  if (normalParts.length < 3) {
    return Err({ message: 'Invalid facet normal' });
  }
  const normal = parseTriple(normalParts.slice(0, 3));

  // Parse vertices
  const vertexRegex = /vertex\s+([^\r\n]+)/gi;
  const vertices: Vec3[] = [];
  let vm: RegExpExecArray | null;
  while ((vm = vertexRegex.exec(block)) !== null) {
    const parts = vm[1].trim().split(/\s+/);
    if (parts.length >= 3) {
      vertices.push(parseTriple(parts.slice(0, 3)));
    }
    if (vertices.length === 3) break;
  }

  if (vertices.length !== 3) {
    return Err({ message: 'Expected 3 vertices per facet' });
  }

  return Ok({
    normal,
    vertices: [vertices[0], vertices[1], vertices[2]],
  });
};

const parseAsciiSTL = (content: string): Result<Scene, ParseError> => {
  const headerLine = content.split(/\r?\n/, 1)[0] || '';
  const name = headerLine.replace(/^solid\s+/i, '').trim() || 'unnamed';

  // Extract all facet blocks
  const blocks = content.match(/facet[\s\S]*?endfacet/gi) || [];

  if (blocks.length === 0) {
    return Err({ message: 'No facets found in ASCII STL' });
  }

  // Parse all facets in a functional style (map + sequence of Results)
  const parsed = blocks.map(parseFacetBlock);

  // If any facet parsing failed, return the first error
  const firstErr = parsed.find((r) => 'err' in r && (r as any).err !== undefined);
  if (firstErr && 'err' in firstErr) {
    return Err((firstErr as any).err as ParseError);
  }

  // Extract triangle values from Ok results
  const triangles = parsed
    .filter((r) => 'ok' in r)
    .map((r) => (r as any).ok as Triangle);

  // Build a mesh-like object. The exact Scene shape is repository-specific,
  // so we provide a sensible structure and cast to Scene.
  const sceneLike = {
    meshes: [
      {
        name,
        triangles,
        meta: {
          source: 'ascii-stl',
          triangleCount: triangles.length,
        },
      },
    ],
  } as unknown as Scene;

  return Ok(sceneLike);
};

export const parseSTL = (content: string): Result<Scene, ParseError> => {
  // Keep parser pure and declarative: detect binary and route to appropriate handler.
  if (!content || typeof content !== 'string') {
    return Err({ message: 'Empty or invalid content' });
  }

  if (isProbablyBinary(content)) {
    return Err({ message: 'Binary STL parsing is not supported by this parser' });
  }

  // Attempt ASCII parse
  return parseAsciiSTL(content);
};