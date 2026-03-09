import { FileSpreadsheet, Table, Upload } from 'lucide-react';

interface SidebarProps {
  fileName: string;
  tableName: string;
  columns: { name: string; type: string }[];
  rowCount: number;
  onNewUpload: () => void;
}

export default function Sidebar({
  fileName,
  tableName,
  columns,
  rowCount,
  onNewUpload,
}: SidebarProps) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>
          <FileSpreadsheet size={18} />
          Genie Upload
        </h2>
      </div>

      <div className="sidebar-section">
        <h3>File</h3>
        <div className="value">{fileName}</div>
      </div>

      <div className="sidebar-section">
        <h3>Table</h3>
        <div className="value">{tableName}</div>
      </div>

      <div className="sidebar-section">
        <h3>Rows</h3>
        <div className="value">{rowCount.toLocaleString()}</div>
      </div>

      <div className="sidebar-section" style={{ flex: 1, overflowY: 'auto' }}>
        <h3>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <Table size={12} />
            Columns ({columns.length})
          </span>
        </h3>
        <ul className="columns-list">
          {columns.map((col) => (
            <li key={col.name}>
              <span>{col.name}</span>
              <span className="col-type">{col.type}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="sidebar-footer">
        <button className="new-upload-btn" onClick={onNewUpload}>
          <Upload size={16} />
          New Upload
        </button>
      </div>
    </div>
  );
}
