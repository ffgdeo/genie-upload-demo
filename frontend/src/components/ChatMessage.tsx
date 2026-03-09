import { Loader2 } from 'lucide-react';
import SqlBlock from './SqlBlock';
import DataTable from './DataTable';
import AutoChart from './AutoChart';

export interface Message {
  id: string;
  role: 'user' | 'genie';
  content: string;
  sql?: string;
  columns?: string[];
  data?: Record<string, unknown>[];
  rowCount?: number;
  loading?: boolean;
  error?: string;
}

interface ChatMessageProps {
  message: Message;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  if (message.role === 'user') {
    return (
      <div className="message message-user">
        <div className="message-bubble">{message.content}</div>
      </div>
    );
  }

  return (
    <div className="message message-genie">
      <div className="message-bubble">
        {message.loading && (
          <div className="message-loading">
            <Loader2 size={16} className="spinner" />
            Thinking...
          </div>
        )}

        {message.error && (
          <div className="message-error">{message.error}</div>
        )}

        {message.content && (
          <div className="message-text">{message.content}</div>
        )}

        {message.sql && <SqlBlock sql={message.sql} />}

        {message.columns && message.data && (
          <DataTable
            columns={message.columns}
            data={message.data}
            rowCount={message.rowCount ?? message.data.length}
          />
        )}

        {message.columns && message.data && message.data.length > 0 && (
          <AutoChart columns={message.columns} data={message.data} />
        )}
      </div>
    </div>
  );
}
