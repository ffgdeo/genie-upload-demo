import { useState, useRef, useCallback } from 'react';
import { Upload, Loader2 } from 'lucide-react';
import { uploadFile } from '../api';

interface FileUploadProps {
  onUploadComplete: (data: {
    session_id: string;
    table_name: string;
    columns: { name: string; type: string }[];
    row_count: number;
    file_name: string;
  }) => void;
}

const ACCEPTED = ['.csv', '.xlsx', '.xls'];

export default function FileUpload({ onUploadComplete }: FileUploadProps) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      if (!ACCEPTED.includes(ext)) {
        setError('Please upload a CSV or Excel file (.csv, .xlsx, .xls)');
        return;
      }
      setError(null);
      setUploading(true);
      try {
        const result = await uploadFile(file);
        onUploadComplete(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setUploading(false);
      }
    },
    [onUploadComplete]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div className="upload-screen">
      <h1>Genie Upload</h1>
      <p className="subtitle">Upload a dataset and ask questions with AI</p>

      <div
        className={`dropzone${dragOver ? ' drag-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <div className="icon">
          <Upload size={48} />
        </div>
        <p>
          Drag & drop your file here, or{' '}
          <span className="browse">browse</span>
        </p>
        <p>Supports CSV, XLSX, XLS</p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={onFileChange}
          style={{ display: 'none' }}
        />
      </div>

      {uploading && (
        <div className="upload-progress">
          <Loader2 size={20} className="spinner" />
          <span>Uploading...</span>
        </div>
      )}

      {error && <div className="upload-error">{error}</div>}
    </div>
  );
}
