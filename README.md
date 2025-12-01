[Welcome guys](https://github.com/micma69/freetheprogs/blob/cha/images/comfy%20aizen.png?raw=true)

# 3D Format Parser and Converter

A web application for viewing and converting 3D file formats using functional programming principles.
This is a web-based app, that converts 3D files (for example .gltf, .obj, or ply files) into other kind of 3D files (for example, .ply into .obj).

So this app only accepted 3D files and all results will be always 3D files too. 

There are four 3D kinds of files that we can accept and process. These are :
- GLTF files
- PLY files
- OBJ files
- STL files

As a matter of common sense, in our app, you can't convert a 3D file into the similar 3D format (for example, you can't convert a PLY file into another PLY file). 

Anyway, we wish you can enjoy and use our app at its fullest potential! Thank you for using our app!

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

**Pure function is a function where the output is entirely depends on the output, so the output will always same if the input is also the same, and without side effects. It processes only the inserted data, and it leaves the global state alone.**

**Example (located in ../shared/converters/stl.ts) :**
```typescript 
const faceToFacetLines = (vertices: readonly Vertex[], face: Face): readonly string[] => {
  if (face.indices.length !== 3) {
    return [];
  }

  const [v0, v1, v2] = face.indices.map(idx => vertices[idx].position);
  const normal = calculateFaceNormal(v0, v1, v2);
  
  return [
    `facet normal ${normal.x} ${normal.y} ${normal.z}`,
    "  outer loop",
    `    vertex ${v0.x} ${v0.y} ${v0.z}`,
    `    vertex ${v1.x} ${v1.y} ${v1.z}`,
    `    vertex ${v2.x} ${v2.y} ${v2.z}`,
    "  endloop",
    "endfacet"
  ];
};
```

**As you see, the output of function faceToFacetLines WILL ALWAYS depends on the input inserted within this function, without any side-effects. Definitely a textbook example of pure function implementation, right?**


- **Immutability**

**It means that the data isn't change after it created. For example, rather than change an array's elements, we'd rather create a newer one by copy the ones we originally want to change.**

**The function below (located in ../shared/converters/obj.ts) pushes new elements into an array (we call it meshVertexIndices) and return the new length of that array**

```typescript 
meshVertexIndices.push(Object.freeze(perVert));
```

**As you see, this function uses Object.freeze() function, which forbids any change to the array named "perVert". So while meshVertexIndices will keep getting new perVert data, the perVert data itself is immutable**


- **High Order Function**

**in a nutshell : A function that accepts other function(s) as the arguments / parameters and return a function as the output**

**The code snippet below is the part of a function that converts a non-PLY 3D file into a 3D PLY file. This code snippet however, builds a large string by combining a header string with data processed from vertices and faces**

```typescript 
header=>header.concat(mapArray(formatVertex)(result.value.vertices)).concat(mapArray(formatFace)(result.value.faces)).join("\n")
```

**This code snippet is an example of a high-order function. In the 'mapArray' part, the 'mapArray' accepts the function of 'formatVertex' as the input and the function of 'result.value.vertices' as the output.**

**This code snippet, especially in mapArray arguments, summons a function that creates another function to receive the rest of the arguments. It's clearly an implementation of currying.**


- **Function Composition and Sequence**

**In a nutshell, combine several smaller functions into ONE BIGGER PROCESS.**

**The function below converts a non-PLY 3D file into a 3D PLY file. It's the main function of the PLY converter (..shared/converters/ply.ts)**

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


**We hope you will enjoy our app! Thank you and have a nice day!**

**Best regards, Team FreeTheProgs!**

