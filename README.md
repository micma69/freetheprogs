[Welcome guys](https://github.com/micma69/freetheprogs/blob/cha/images/comfy%20aizen.png?raw=true)

# 3D Format Parser and Converter

A web application for viewing and converting 3D file formats using functional programming principles.
Ini adalah aplikasi berbasis web, yang fungsinya buat mengubah file-file 3D ke jenis file 3D lainnya
(misal, dari .obj ke .ply)

## Features
- Parse and validate 3D files (OBJ, STL, PLY, GLTF)
- Convert between different 3D formats (WIP)
- 3D viewer with 14-angle camera option (X+, X-, Y+, Y-, Z+, Z-, + diagonals) (TODO)

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


- **Function Composition / Sequence**

**The function below converts a non-PLY 3D file into a 3D PLY file.**

```typescript 
export const convertToPLY = (scene: Scene): Result<string, ConvertError> =>
  pipe(
    scene.meshes,
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
```

**As you see, this function (convertToPLY) is composed from smaller and simpler functions chained together to create a single, complex data transformation pipeline. Which is clearly a function composition. However, semantically speaking, since every process steps in this function are executed sequentially, and the result from the previous step becomes the input for the next step.**

**In this function, there are at least three steps of data transformation : First, validate the meshes. Second, extract the vertices and faces. Third, format it into a PLY string.**


- **Other functional programming principles we've use :**

```Typescript
///TBA
```

