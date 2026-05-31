import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Terminal, Play, Pause, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';

interface LogEntry {
  event: string;
  timestamp: string;
  payload?: string;
  role?: string;
  exitCode?: number;
}

export function SessionView() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isTailing, setIsTailing] = useState(true);
  const endOfLogsRef = useRef<HTMLDivElement>(null);

  // Simulated JSONL tailing since backend API is pending
  useEffect(() => {
    // In reality, this connects to the backend API that tails ~/.hopi/projects/<hash>/sessions/<id>.jsonl
    const evtSource = new EventSource(`http://localhost:3000/api/sessions/${sessionId}/stream`);

    evtSource.onmessage = (event) => {
      try {
        const newLog = JSON.parse(event.data);
        setLogs(prev => [...prev, newLog]);
      } catch (e) {
        // ignore
      }
    };

    // Mock initial data for UI preview
    setLogs([
      { event: 'session_start', timestamp: new Date().toISOString(), role: 'generator' },
      { event: 'worktree_ready', timestamp: new Date().toISOString(), payload: '.hopi/worktrees/task-2' },
      { event: 'agent_spawning', timestamp: new Date().toISOString() },
      { event: 'stdout', timestamp: new Date().toISOString(), payload: 'Analyzing task dependencies...' },
      { event: 'stdout', timestamp: new Date().toISOString(), payload: 'Writing JWT service implementation...' },
    ]);

    return () => evtSource.close();
  }, [sessionId]);

  useEffect(() => {
    if (isTailing && endOfLogsRef.current) {
      endOfLogsRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isTailing]);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#1A1A1A]">
      <header className="px-6 py-4 border-b border-[#333] shrink-0 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Terminal className="w-5 h-5 text-green-400" />
            Session Logs
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            ID: <code className="bg-[#2A2A2A] px-1.5 py-0.5 rounded text-green-400">{sessionId}</code>
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setIsTailing(!isTailing)}
            className="flex items-center gap-2 px-3 py-1.5 rounded bg-[#2A2A2A] hover:bg-[#333] text-sm text-gray-300 transition-colors"
          >
            {isTailing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {isTailing ? 'Pause Auto-scroll' : 'Resume Auto-scroll'}
          </button>
          <button
            onClick={() => setLogs([])}
            className="flex items-center gap-2 px-3 py-1.5 rounded bg-[#2A2A2A] hover:bg-[#333] text-sm text-gray-300 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Clear
          </button>
        </div>
      </header>

      <div className="flex-1 p-6 overflow-y-auto bg-[#0F0F0F] font-mono text-sm">
        {logs.map((log, i) => (
          <div key={i} className="mb-2 flex gap-4 group hover:bg-[#1A1A1A] px-2 py-1 rounded -mx-2 transition-colors">
            <span className="text-gray-600 shrink-0 select-none">
              {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            <div className="flex-1 break-words">
              {log.event === 'session_start' && (
                <span className="text-blue-400 font-bold">[{log.event}] Role: {log.role}</span>
              )}
              {log.event === 'worktree_ready' && (
                <span className="text-purple-400">[{log.event}] {log.payload}</span>
              )}
              {log.event === 'agent_spawning' && (
                <span className="text-yellow-400">[{log.event}] Spawning Claude Code process...</span>
              )}
              {log.event === 'session_end' && (
                <span className={cn("font-bold", log.exitCode === 0 ? "text-green-400" : "text-red-400")}>
                  [{log.event}] Exited with code {log.exitCode}
                </span>
              )}
              {log.event === 'stdout' && (
                <span className="text-gray-300 whitespace-pre-wrap">{log.payload}</span>
              )}
              {log.event === 'stderr' && (
                <span className="text-red-400 whitespace-pre-wrap">{log.payload}</span>
              )}
            </div>
          </div>
        ))}
        <div ref={endOfLogsRef} />
      </div>
    </div>
  );
}
