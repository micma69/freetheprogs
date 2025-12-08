import { useState } from 'react';
import FileUpload from './components/FileUpload';
import Viewer3D from './components/3DViewer';
import type { Scene } from '../src/types/scene';

function App() {
  const [scene, setScene] = useState<Scene | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleFileParsed = (parsedScene: Scene) => {
    setScene(parsedScene);
    setError(null);
  };

  const handleError = (errorMessage: string) => {
    setError(errorMessage);
    setScene(null);
  };

  const handleLoading = (isLoading: boolean) => {
    setLoading(isLoading);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>3D Format Parser & Converter</h1>
      </header>

      <main className="app-main">
        <div className="upload-section">
          <FileUpload
            onParsed={handleFileParsed}
            onError={handleError}
            onLoading={handleLoading}
          />
        </div>

        {error && (
          <div className="error-message">
            <strong>Error:</strong> {error}
          </div>
        )}

        {loading && (
          <div className="loading-message">
            Parsing file...
          </div>
        )}

        {scene && (
          <div className="viewer-section">
            <Viewer3D scene={scene} />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
