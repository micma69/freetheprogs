import { useState, useCallback } from 'react';
import type { Scene } from '../types/scene';

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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleFileSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        setSelectedFile(file);
      }
    },
    []
  );

  const handleUpload = useCallback(async () => {
    if (!selectedFile) {
      onError('Please select a file first');
      return;
    }

    const fileExtension = selectedFile.name.split('.').pop()?.toLowerCase();

    if (fileExtension !== 'obj' && fileExtension !== 'ply') {
      onError('Only OBJ and PLY files are supported in this version');
      return;
    }

    onLoading(true);
    setSelectedFile(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const endpoint =
      fileExtension === 'obj'
        ? 'http://localhost:3001/api/parse/obj'
        : 'http://localhost:3001/api/parse/ply';

      const response = await fetch(endpoint, {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        onParsed(result.data);
      } else {
        onError(
          result.error?.message || 'Failed to parse file'
        );
      }
    } catch (err) {
      onError(
        err instanceof Error ? err.message : 'Network error occurred'
      );
    } finally {
      onLoading(false);
      // Reset file input
      const fileInput = document.getElementById('file-input') as HTMLInputElement;
      if (fileInput) {
        fileInput.value = '';
      }
    }
  }, [selectedFile, onParsed, onError, onLoading]);

  return (
    <div className="file-upload">
      <h2>Upload 3D File</h2>
      <div className="upload-controls">
        <label htmlFor="file-input" className="file-label">
          Choose File
        </label>
        <input
          id="file-input"
          type="file"
          accept=".obj,.ply"
          onChange={handleFileSelect}
          className="file-input"
        />
        {selectedFile && (
          <div className="file-info">
            Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(2)} KB)
          </div>
        )}
        <button
          onClick={handleUpload}
          disabled={!selectedFile}
          className="upload-button"
        >
          Parse File
        </button>
      </div>
    </div>
  );
};

export default FileUpload;
