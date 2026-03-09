import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, BarChart3 } from 'lucide-react';
import ChatMessage, { type Message } from './ChatMessage';
import { askGenie } from '../api';

interface ChatInterfaceProps {
  spaceId: string;
}

let msgCounter = 0;

export default function ChatInterface({ spaceId }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const question = input.trim();
    if (!question || loading) return;

    const userMsgId = `msg-${++msgCounter}`;
    const genieMsgId = `msg-${++msgCounter}`;

    setInput('');
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', content: question },
      { id: genieMsgId, role: 'genie', content: '', loading: true },
    ]);
    setLoading(true);

    try {
      const result = await askGenie(spaceId, question, conversationId);
      setConversationId(result.conversation_id);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === genieMsgId
            ? {
                ...m,
                loading: false,
                content: result.text_response || '',
                sql: result.sql,
                columns: result.columns,
                data: result.data,
                rowCount: result.row_count,
              }
            : m
        )
      );
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === genieMsgId
            ? {
                ...m,
                loading: false,
                error: err instanceof Error ? err.message : 'Something went wrong',
              }
            : m
        )
      );
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="chat-main">
      <div className="chat-header">
        <BarChart3 size={18} color="#FF3621" />
        Ask Genie
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <BarChart3 size={40} color="#ddd" />
            <p>Ask a question about your data</p>
            <p className="hint">
              Try something like "What are the top 10 rows?" or "Show total by
              category"
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        <form className="chat-input-form" onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            className="chat-input"
            type="text"
            placeholder="Ask a question about your data..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
          />
          <button
            className="chat-send-btn"
            type="submit"
            disabled={loading || !input.trim()}
          >
            <Send size={18} />
          </button>
        </form>
      </div>
    </div>
  );
}
