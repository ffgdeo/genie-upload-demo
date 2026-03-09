import { useState } from 'react';
import FileUpload from './components/FileUpload';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import ActivityLog from './components/ActivityLog';
import { createGenieSpace } from './api';
import { Loader2 } from 'lucide-react';
import './styles/App.css';

type AppState = 'upload' | 'configuring' | 'chat';

interface SessionInfo {
  session_id: string;
  table_name: string;
  columns: { name: string; type: string }[];
  row_count: number;
  file_name: string;
}

export default function App() {
  const [state, setState] = useState<AppState>('upload');
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [spaceId, setSpaceId] = useState<string>('');
  const [configError, setConfigError] = useState<string | null>(null);

  const handleUploadComplete = async (data: SessionInfo) => {
    setSession(data);
    setState('configuring');
    setConfigError(null);

    try {
      const space = await createGenieSpace(data.table_name, data.table_name);
      setSpaceId(space.space_id);
      setState('chat');
    } catch (err) {
      setConfigError(
        err instanceof Error ? err.message : 'Failed to create Genie Space'
      );
      setState('configuring');
    }
  };

  const handleNewUpload = () => {
    setState('upload');
    setSession(null);
    setSpaceId('');
    setConfigError(null);
  };

  return (
    <div className="app">
      {state === 'upload' && (
        <FileUpload onUploadComplete={handleUploadComplete} />
      )}

      {state === 'configuring' && (
        <div className="configuring-screen">
          {!configError ? (
            <>
              <Loader2 size={48} className="spinner" />
              <h2>Creating Genie Space...</h2>
              <p>Setting up your data for natural language queries</p>
            </>
          ) : (
            <>
              <h2>Configuration Error</h2>
              <p style={{ color: '#ff6b6b' }}>{configError}</p>
              <button
                className="new-upload-btn"
                style={{ width: 'auto', padding: '0.6rem 1.5rem' }}
                onClick={handleNewUpload}
              >
                Try Again
              </button>
            </>
          )}
        </div>
      )}

      {state === 'chat' && (
        <div className="chat-layout">
          {session && (
            <Sidebar
              fileName={session.file_name}
              tableName={session.table_name}
              columns={session.columns}
              rowCount={session.row_count}
              onNewUpload={handleNewUpload}
            />
          )}
          <ChatInterface spaceId={spaceId} />
        </div>
      )}

      {/* Activity log always docked at bottom of viewport */}
      <ActivityLog />
    </div>
  );
}
