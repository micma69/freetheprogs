[Welcome guys](https://github.com/micma69/freetheprogs/blob/cha/images/comfy%20aizen.png?raw=true)

# 3D Format Parser and Converter

A web application for viewing and converting 3D file formats using functional programming principles.
Ini adalah aplikasi berbasis web, yang fungsinya buat mengubah file-file 3D ke jenis file 3D lainnya
(misal, dari .obj ke .ply)

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

## Functional programming aspects we've implemented

- **Pure Function**

**The function (located in ../shared/converters/obj.ts) below returns a string version of a numeric data**

```typescript 
const fmt = (n: number): string => {
  return Number(n).toString();
};
```

**As you see, this function will always accepts numerical information as inputs and produces strings, without any side-effects**


- **Immutability**

**The function below (located in ../shared/converters/obj.ts) pushes new elements into an array (we call it meshVertexIndices) and return the new length of that array**

```typescript 
meshVertexIndices.push(Object.freeze(perVert));
```

**As you see, this function uses Object.freeze() function, which forbids any change to the array named "perVert". So while meshVertexIndices will keep getting new perVert data, the perVert data itself is immutable**


- **High Order Function and Currying**

**The code snippet below is the part of a function that converts a non-PLY 3D file into a 3D PLY file. This code snippet however, builds a large string by combining a header string with data processed from vertices and faces**

```typescript 
header=>header.concat(mapArray(formatVertex)(result.value.vertices)).concat(mapArray(formatFace)(result.value.faces)).join("\n")
```

**This code snippet is an example of a high-order function. In the 'mapArray' part, the 'mapArray' accepts the function of 'formatVertex' as the input and the function of 'result.value.vertices' as the output.**

**This code snippet, especially in mapArray arguments, summons a function that creates another function to receive the rest of the arguments. It's clearly an implementation of currying.**


- **Monad for Error Handling**
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
In this project the Result Monad (where  it is written as Result<T, E> with Ok and Err) is used to handle parsing errors cleanly. Instead of writing if and return error at every step, the Result pattern lets you chain operations like flatMap or andThen, so each step only runs if the previous one succeeded. If something fails, the error automatically flows through the chain. This makes the code easier to read, keeps the logic tidy, and avoids scattering error checks everywhere.

```

