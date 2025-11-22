import { useState, useCallback } from 'react';

interface Scene {
  meshes: any[];
  materials: any[];
  metadata: any;
}

export interface FileUploadProps {
  onParsed: (scene: Scene) => void;
  onError: (error: string) => void;
  onLoading: (loading: boolean) => void;
}

const FileUpload: React.FC<FileUploadProps> = ({
  onParsed,
  onError,
  onLoading,
}) => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileType, setFileType] = useState<string>('');

  const handleFileSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      
      if (files.length === 0) return;

      // Check if there's a GLTF file in the selection
      const gltfFile = files.find(f => f.name.toLowerCase().endsWith('.gltf'));
      const binFile = files.find(f => f.name.toLowerCase().endsWith('.bin'));
      
      let primaryFile: File;
      let extension: string | undefined;
      let filesToSet: File[] = [];

      if (gltfFile) {
        // GLTF workflow
        primaryFile = gltfFile;
        extension = 'gltf';
        filesToSet = binFile ? [gltfFile, binFile] : [gltfFile];
      } else {
        // Single file workflow (OBJ, PLY, GLB)
        primaryFile = files[0];
        extension = primaryFile.name.split('.').pop()?.toLowerCase();
        filesToSet = [primaryFile];
      }

      if (!extension || !['obj', 'ply', 'gltf'].includes(extension)) {
        onError('Only OBJ, PLY, GLTF files are supported');
        event.target.value = '';
        return;
      }

      setFileType(extension);
      setSelectedFiles(filesToSet);
    },
    [onError]
  );

  const handleUpload = useCallback(async () => {
    if (selectedFiles.length === 0) {
      onError('Please select a file first');
      return;
    }

    onLoading(true);

    try {
      const formData = new FormData();
      formData.append('file', selectedFiles[0]);
      
      if (selectedFiles.length > 1) {
        for (let i = 1; i < selectedFiles.length; i++) {
          formData.append('additionalFiles', selectedFiles[i]);
        }
      }

      let endpoint: string;
      if (fileType === 'obj') {
        endpoint = 'http://localhost:3001/api/parse/obj';
      } else if (fileType === 'ply') {
        endpoint = 'http://localhost:3001/api/parse/ply';
      } else if (fileType === 'gltf' || fileType === 'glb') {
        endpoint = 'http://localhost:3001/api/parse/gltf';
      } else {
        throw new Error(`Unsupported file format: ${fileType}`);
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        onParsed(result.data);
      } else {
        onError(result.error?.message || 'Failed to parse file');
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Network error occurred');
    } finally {
      onLoading(false);
      setSelectedFiles([]);
      setFileType('');
      
      const fileInput = document.getElementById('file-input') as HTMLInputElement;
      if (fileInput) {
        fileInput.value = '';
      }
    }
  }, [selectedFiles, fileType, onParsed, onError, onLoading]);

  const getTotalSize = () => {
    return selectedFiles.reduce((sum, file) => sum + file.size, 0);
  };

  return (
    <div style={{
      padding: '20px',
      backgroundColor: '#f5f5f5',
      borderRadius: '8px',
      maxWidth: '500px',
      margin: '0 auto'
    }}>
      <h2 style={{ marginTop: 0, color: '#333' }}>Upload 3D File</h2>
      
      <div style={{ 
        display: 'flex', 
        gap: '10px', 
        marginBottom: '15px',
        alignItems: 'center'
      }}>
        <label
          htmlFor="file-input"
          style={{
            display: 'inline-block',
            padding: '10px 24px',
            backgroundColor: '#007bff',
            color: 'white',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '500',
            whiteSpace: 'nowrap'
          }}
        >
          Choose File(s)
        </label>
        <input
          id="file-input"
          type="file"
          accept=".obj,.ply,.gltf,.glb,.bin"
          onChange={handleFileSelect}
          multiple
          style={{ display: 'none' }}
        />
        
        <button
          onClick={handleUpload}
          disabled={selectedFiles.length === 0}
          style={{
            padding: '10px 24px',
            backgroundColor: selectedFiles.length === 0 ? '#ccc' : '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: selectedFiles.length === 0 ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            fontWeight: '500',
            whiteSpace: 'nowrap'
          }}
        >
          Parse File{selectedFiles.length > 1 ? 's' : ''}
        </button>
      </div>

      {selectedFiles.length > 0 && (
        <div style={{
          padding: '12px',
          backgroundColor: 'white',
          borderRadius: '4px',
          marginBottom: '15px',
          fontSize: '14px',
          color: '#555'
        }}>
          <div style={{ fontWeight: '600', marginBottom: '8px' }}>
            Selected file(s):
          </div>
          {selectedFiles.map((file, index) => (
            <div key={index} style={{ marginBottom: '4px' }}>
              • {file.name} ({(file.size / 1024).toFixed(2)} KB)
            </div>
          ))}
          <div style={{ marginTop: '8px', fontWeight: '500', color: '#333' }}>
            Total: {(getTotalSize() / 1024).toFixed(2)} KB
          </div>
          
          {fileType === 'gltf' && selectedFiles.length === 1 && (
            <div style={{
              marginTop: '10px',
              padding: '8px',
              backgroundColor: '#fff3cd',
              borderRadius: '4px',
              fontSize: '13px',
              color: '#856404'
            }}>
               Warning: If your GLTF uses an external .bin file, please select both files together
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FileUpload;