import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface SqlBlockProps {
  sql: string;
}

export default function SqlBlock({ sql }: SqlBlockProps) {
  const [open, setOpen] = useState(false);

  if (!sql) return null;

  return (
    <div className="sql-block">
      <button className="sql-toggle" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        SQL Query
      </button>
      {open && <pre className="sql-code">{sql}</pre>}
    </div>
  );
}
