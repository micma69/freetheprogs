/**
 * Express backend server for 3D format parser and converter
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import { parseOBJ } from '../../shared/parsers/obj'
import type { ParseError } from '../../shared/parsers/obj';
import { parsePLY } from '../../shared/parsers/ply'

const app = express();
const port = 3001;

// Middleware
app.use(cors());
app.use(express.json());

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

  const content = req.file.buffer.toString('utf-8');
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
        column: error.column,
      },
    });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
