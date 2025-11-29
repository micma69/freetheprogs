/**
 * Express backend server for 3D format parser and converter
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import type { ParseError } from '../../shared/parsers/obj';
import { parseOBJ } from '../../shared/parsers/obj'
import { parsePLY } from '../../shared/parsers/ply';
import { parseSTL } from '../../shared/parsers/stl'
import { parseGLTF } from '../../shared/parsers/gltf';
import { convertToPLY } from '../../shared/converters/ply';
import { toOBJ } from '../../shared/converters/obj';
import { toGLTF } from '../../shared/converters/gltf';
import { toSTL } from '../../shared/converters/stl';


const app = express();
const port = 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// Health check endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', message: '3D Parser API is running' });
});

// Parse OBJ file endpoint
app.post('/api/parse/obj', upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const content = req.file.buffer.toString('utf-8');
  const result = parseOBJ(content);

  if (result.ok) {
    res.json({
      success: true,
      data: result.value,
    });
  } else {
    const error = result.error as ParseError;
    res.status(400).json({
      success: false,
      error: {
        message: error.message,
        line: error.line,
        column: error.column,
      },
    });
  }
});

// Parse PLY file endpoint
app.post('/api/parse/ply', upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const buffer = req.file.buffer;
    
    const content = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    );
    
    const result = parsePLY(content);

    if (result.ok) {
      res.json({
        success: true,
        data: result.value,
      });
    } else {
      const error = result.error as ParseError;
      res.status(400).json({
        success: false,
        error: {
          message: error.message,
          line: error.line,
        },
      });
    }
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { message: err instanceof Error ? err.message : 'Unknown error' },
    });
  }
});

// Parse GLTF file endpoint
app.post('/api/parse/gltf', upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'additionalFiles', maxCount: 1 }
]), async (req, res) => {
  try {
    if (!req.files || typeof req.files === 'object' && !('file' in req.files)) {
      return res.status(400).json({ error: 'No GLTF file uploaded' });
    }
    
    const gltfFile = (req.files as { [fieldname: string]: Express.Multer.File[] })['file'][0];
    const additionalFiles = (req.files as { [fieldname: string]: Express.Multer.File[] })['additionalFiles'] || [];
    
    const gltfContent = gltfFile.buffer.toString('utf-8');
    
    // Create map of external buffers
    const externalBuffers = new Map<string, ArrayBuffer>();
    for (const file of additionalFiles) {
      externalBuffers.set(file.originalname, file.buffer.buffer as ArrayBuffer);
    }
    
    console.log("Before Parsing")
    const result = parseGLTF(gltfContent, externalBuffers); //REcursion inside of parser not uploaded.tsx T_T
    console.log('Parse complete:',result.ok);

    if (result.ok) {
      console.log('Attempting JSON serialization...');
      return res.json({ success: true, data: result.value });
    } else {
      return res.json({ success: false, error: result.error });
    }
  } catch (error) {
    return res.status(500).json({ success: false, error: { message: error instanceof Error ? error.message : 'Unknown error' } });
  }
});

// Parse STL file endpoint
app.post('/api/parse/stl', upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const buffer = req.file.buffer;
    const content = new TextDecoder().decode(buffer);

    const result = parseSTL(content);

    if (result.ok) {
      res.json({
        success: true,
        data: result.value,
      });
    } else {
      const error = result.error as ParseError;
      res.status(400).json({
        success: false,
        error: {
          message: error.message,
          line: error.line,
        },
      });
    }
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { message: err instanceof Error ? err.message : 'Unknown error' },
    });
  }
});

// Convert to OBJ endpoint
app.post("/api/convert/obj", (req, res) => {
  const result = toOBJ(req.body);

  if (!result.ok) {
    return res.status(400).json({ success: false, error: result.error });
  }

  const obj = result.value;

  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", 'attachment; filename="converted.obj"');
  return res.send(obj);
});


// Convert to PLY endpoint
app.post("/api/convert/ply", (req, res) => {
  const result = convertToPLY(req.body);

  if (!result.ok) {
    return res.status(400).json({ success: false, error: result.error });
  }

  const ply = result.value;

  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", "attachment; filename=\"converted.ply\"");
  return res.send(ply);
});

// Convert to glTF endpoint
app.post("/api/convert/gltf", (req, res) => {
  const result = toGLTF(req.body);

  if (!result.ok) {
    return res.status(400).json({ success: false, error: result.error });
  }

  const gltf = result.value;

  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", 'attachment; filename="converted.gltf"');
  return res.send(gltf);
});

// Convert to STL endpoint
app.post("/api/convert/stl", (req, res) => {
  const result = toSTL(req.body);

  if (!result.ok) {
    return res.status(400).json({ success: false, error: result.error });
  }

  const stl = result.value;

  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", 'attachment; filename="converted.stl"');
  return res.send(stl);
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});