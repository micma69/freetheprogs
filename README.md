# 3D Format Parser and Converter

A web application for viewing and converting 3D file formats using functional programming principles.

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
