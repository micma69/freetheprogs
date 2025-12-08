[Deployed Link (not_yet Im sorry)](https://github.com/micma69/freetheprogs/blob/cha/images/comfy%20aizen.png?raw=true)

# 3D Format Parser and Converter


A web application for viewing and converting 3D file formats using functional programming principles.

## Features
- Parse and validate 3D files (OBJ, STL, PLY, GLTF Currently Supported)
- Convert between different 3D formats
- 3D viewer with different camera angle and 360 view with mouse click and hold

## Project Structure
```
project/
├── backend/          # Node.js + Express + TypeScript
├── frontend/         # React + TypeScript + WebGL
├── shared/             # Shared types and utilities
└── tests/           # Unit tests
```

## Setup

1. Install dependencies:
```bash
npm run install-all
```

2. Run development servers:
```bash
# Terminal 1 - Backend
npm run dev:backend

# Terminal 2 - Frontend
npm run dev:frontend
```

## Technologies

- **Backend**: Node.js, TypeScript, Express.js
- **Frontend**: React, TypeScript, WebGL
- **Paradigm**: Functional Programming

  ## ParserLogic
  ### GLTF
  ### OBJ PLY STL
  ### Converted Scene

## Functional programming aspects we've implemented

### **Pure Function**

The function Pure bounding box calculation located in (shared/parsers/ply.ts, lines 474-490).

```typescript 
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
```

We have a consistent deterministic with no side effects (don't modify global state, don't perform I/O, don't mutate parameters) that produces the same output with the same input making it easily testable and predicitable to work with.


### Immutability

We have an read only Scene Data type

```typescript

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
```

We make this into a read only because after we are done parsing, we would like this data to be saved as is and not interfer with the 3d viewing process (Consist of a lot of matrix and vertice transformation).  By making it read only when we can only use the data and pass it of to the 3d viewer for its viewing transformation without ever changing the original object so it can be used to convert the data type later.


### High Order Function

The code snippet below is the part of a function that would be used for validating process of a scene or mesh. That is located in `shared/validators/validators.ts (lines 21-33)`
```typescript 
export const combine = <T>(
  ...validators: ReadonlyArray<Validator<T>>
): Validator<T> => {
  return (value: T): Result<T, ValidationError> => {
    for (const validator of validators) {
      const result = validator(value);
      if (!result.ok) {
        return result;
      }
    }
    return Ok(value);
  };
};
```
Snippet 2:
```typescript
export const validateNonEmpty = <T>(
  items: readonly T[],
  itemName: string
): Result<readonly T[], ValidationError> => {
  if (items.length === 0) {
    return Err({
      message: `${itemName} array cannot be empty`,
      code: 'EMPTY_ARRAY',
    });
  }
  return Ok(items);
};
```

This code snippet is an example of a high-order function. By using `combine`with our validation process, we can take different type of validators function as input such as `validateNonEmpty` and other validators and returns a value of in this case a boolean if it passes the process.


### **Monad for Error Handling**
```typescript
const parseLines = (content: string): Result<OBJData, ParseError> => {
  const lines = content.split('\n');
  
//implementation details

  const result = parsedLines.reduce<Result<{ data: OBJData; currentMaterial?: string }, ParseError>>(
    (accResult, line) => andThen(accResult, acc => processLine(acc, line)),
    Ok(initial)
  );

  return map(result, acc => acc.data);
};
```
> The snippet is located in `shared\parsers\obj.ts` around line 235

In this project the Result Monad (where  it is written as Result<T, E> with Ok and Err) is used to handle parsing errors cleanly. Instead of writing if and return error at every step, the Result pattern lets you chain operations like flatMap or andThen, so each step only runs if the previous one succeeded. If something fails, the error automatically flows through the chain. This makes the code easier to read, keeps the logic tidy, and avoids scattering error checks everywhere.


