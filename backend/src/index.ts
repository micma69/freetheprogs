/**
 * Express backend server for 3D format parser and converter
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';  
import multer from 'multer';
import { parseOBJ } from '../../shared/parsers/obj';
import type { ParseError as OBJParseError } from '../../shared/parsers/obj';
import { parsePLY } from '../../shared/parsers/ply';
import type { PLYParseError } from '../../shared/parsers/ply';
import { parseGLTF } from '../../shared/parsers/gltf';
import type { GLTFParseError } from '../../shared/parsers/gltf';

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit (GLTF files can be large)
  },
  fileFilter: (_req, file, cb) => {
    // Accept common 3D file extensions
    const allowedExtensions = ['.obj', '.ply', '.gltf', '.glb'];
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
    
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Allowed: ${allowedExtensions.join(', ')}`));
    }
  },
});

// Error handling middleware
const handleMulterError = (
  err: any,
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ 
        error: 'File too large. Maximum size is 50MB' 
      });
    }
    return res.status(400).json({ error: err.message });
  } else if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
};

// Health check endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    message: '3D Parser API is running',
    supportedFormats: ['obj', 'ply', 'gltf'],
    version: '1.0.0'
  });
});

// Parse OBJ file endpoint
app.post(
  '/api/parse/obj', 
  upload.single('file'), 
  handleMulterError,
  (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
      const content = req.file.buffer.toString('utf-8');
      const result = parseOBJ(content);

      if (result.ok) {
        return res.json({
          success: true,
          format: 'OBJ',
          filename: req.file.originalname,
          data: result.value,
        });
      } else {
        const error = result.error as OBJParseError;
        return res.status(400).json({
          success: false,
          format: 'OBJ',
          error: {
            message: error.message,
            line: error.line,
            column: error.column,
          },
        });
      }
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: {
          message: err instanceof Error ? err.message : 'Unknown error occurred',
        },
      });
    }
  }
);

// Parse PLY file endpoint
app.post(
  '/api/parse/ply', 
  upload.single('file'), 
  handleMulterError,
  (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
      const content = req.file.buffer.toString('utf-8');
      const result = parsePLY(content);

      if (result.ok) {
        return res.json({
          success: true,
          format: 'PLY',
          filename: req.file.originalname,
          data: result.value,
        });
      } else {
        const error = result.error as PLYParseError;
        return res.status(400).json({
          success: false,
          format: 'PLY',
          error: {
            message: error.message,
            line: error.line,
            column: error.column,
          },
        });
      }
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: {
          message: err instanceof Error ? err.message : 'Unknown error occurred',
        },
      });
    }
  }
);

// Parse GLTF file endpoint
app.post(
  '/api/parse/gltf', 
  upload.single('file'), 
  handleMulterError,
  (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
      const content = req.file.buffer.toString('utf-8');
      const result = parseGLTF(content);

      if (result.ok) {
        return res.json({
          success: true,
          format: 'GLTF',
          filename: req.file.originalname,
          data: result.value,
        });
      } else {
        const error = result.error as GLTFParseError;
        return res.status(400).json({
          success: false,
          format: 'GLTF',
          error: {
            message: error.message,
            path: error.path,
          },
        });
      }
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: {
          message: err instanceof Error ? err.message : 'Unknown error occurred',
        },
      });
    }
  }
);

// Generic parse endpoint that detects format
app.post(
  '/api/parse', 
  upload.single('file'), 
  handleMulterError,
  (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const ext = req.file.originalname.toLowerCase().slice(req.file.originalname.lastIndexOf('.'));
    
    try {
      const content = req.file.buffer.toString('utf-8');
      let result;
      let format;

      switch (ext) {
        case '.obj':
          result = parseOBJ(content);
          format = 'OBJ';
          break;
        case '.ply':
          result = parsePLY(content);
          format = 'PLY';
          break;
        case '.gltf':
        case '.glb':
          result = parseGLTF(content);
          format = 'GLTF';
          break;
        default:
          return res.status(400).json({ 
            error: `Unsupported file format: ${ext}` 
          });
      }

      if (result.ok) {
        return res.json({
          success: true,
          format,
          filename: req.file.originalname,
          data: result.value,
        });
      } else {
        return res.status(400).json({
          success: false,
          format,
          error: result.error,
        });
      }
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: {
          message: err instanceof Error ? err.message : 'Unknown error occurred',
        },
      });
    }
  }
);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

export default app;