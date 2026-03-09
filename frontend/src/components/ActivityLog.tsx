import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, ChevronRight, Activity, Trash2, GripHorizontal } from 'lucide-react';

interface LogEntry {
  timestamp: string;
  method: string;
  endpoint: string;
  description: string;
  request_summary: string;
  response_summary: string;
  duration_ms: number;
  phase: string;
}

const PHASE_COLORS: Record<string, string> = {
  upload: '#4ECDC4',
  'genie-setup': '#FFE66D',
  query: '#FF3621',
};

const PHASE_LABELS: Record<string, string> = {
  upload: 'UPLOAD',
  'genie-setup': 'GENIE SETUP',
  query: 'QUERY',
};

const MIN_HEIGHT = 36;
const DEFAULT_HEIGHT = 220;
const MAX_HEIGHT = 600;

export default function ActivityLog() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [polling, setPolling] = useState(true);
  const [panelHeight, setPanelHeight] = useState(DEFAULT_HEIGHT);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  // Polling — always fetch full log and replace state (no append = no dupes)
  useEffect(() => {
    if (!polling) return;

    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await fetch('/api/activity-log');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setEntries(data.entries);
      } catch {
        // ignore
      }
    };

    poll();
    const interval = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [polling]);

  // Auto-scroll when entries change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [entries.length]);

  // Drag resize handlers
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startY.current = e.clientY;
    startHeight.current = panelHeight;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, [panelHeight]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = startY.current - e.clientY;
      const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT + 40, startHeight.current + delta));
      setPanelHeight(newHeight);
    };

    const onMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const clearLog = async () => {
    await fetch('/api/activity-log', { method: 'DELETE' });
    setEntries([]);
    setExpandedRows(new Set());
  };

  const toggleRow = (idx: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const effectiveHeight = expanded ? panelHeight : MIN_HEIGHT;

  return (
    <div className="activity-log-panel" style={{ height: effectiveHeight }}>
      {expanded && (
        <div className="activity-log-drag-handle" onMouseDown={onMouseDown}>
          <GripHorizontal size={14} />
        </div>
      )}

      <div className="activity-log-header" onClick={() => setExpanded(!expanded)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <Activity size={14} color="#FF3621" />
          <span>Databricks API Activity</span>
          <span className="log-count">{entries.length} calls</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <label className="poll-toggle" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={polling}
              onChange={(e) => setPolling(e.target.checked)}
            />
            Live
          </label>
          <button
            className="clear-log-btn"
            onClick={(e) => {
              e.stopPropagation();
              clearLog();
            }}
            title="Clear log"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="activity-log-body" ref={scrollRef}>
          {entries.length === 0 && (
            <div className="log-empty">No API calls yet. Upload a file to see the flow.</div>
          )}
          {entries.map((entry, idx) => (
            <div key={idx} className="log-entry" onClick={() => toggleRow(idx)}>
              <div className="log-entry-row">
                <span
                  className="log-phase"
                  style={{ background: PHASE_COLORS[entry.phase] || '#888', color: entry.phase === 'genie-setup' ? '#333' : '#fff' }}
                >
                  {PHASE_LABELS[entry.phase] || entry.phase.toUpperCase()}
                </span>
                <span className="log-method">{entry.method}</span>
                <span className="log-description">{entry.description}</span>
                <span className="log-duration">{entry.duration_ms}ms</span>
              </div>
              {expandedRows.has(idx) && (
                <div className="log-entry-details">
                  <div><strong>Endpoint:</strong> <code>{entry.endpoint}</code></div>
                  {entry.request_summary && (
                    <div><strong>Request:</strong> <code>{entry.request_summary}</code></div>
                  )}
                  {entry.response_summary && (
                    <div><strong>Response:</strong> <code>{entry.response_summary}</code></div>
                  )}
                  <div className="log-timestamp">{new Date(entry.timestamp).toLocaleTimeString()}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
