import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertCircle, MessageSquare } from 'lucide-react';
import { cn } from '../lib/utils';
import { AssistantPanel } from '../components/AssistantPanel';

// Shared types that match our backend validation schemas
export type TaskStatus = 'candidate' | 'planned' | 'in_progress' | 'in_review' | 'merging' | 'blocked' | 'done';

export interface TaskItem {
  ref: string;
  status: TaskStatus;
  title: string;
  body: string;
  dependencyTaskList: string[];
  blockers?: Array<{ kind: string; summary: string }>;
}

export interface TodoBoard {
  goal: { goalKey: string; title: string };
  items: TaskItem[];
}

const STATUS_COLUMNS: { id: TaskStatus; label: string; color: string }[] = [
  { id: 'planned', label: 'Planned', color: 'border-blue-500/30 bg-blue-500/5 text-blue-400' },
  { id: 'in_progress', label: 'In Progress', color: 'border-yellow-500/30 bg-yellow-500/5 text-yellow-400' },
  { id: 'in_review', label: 'In Review', color: 'border-purple-500/30 bg-purple-500/5 text-purple-400' },
  { id: 'merging', label: 'Merging', color: 'border-orange-500/30 bg-orange-500/5 text-orange-400' },
  { id: 'done', label: 'Done', color: 'border-green-500/30 bg-green-500/5 text-green-400' },
];

export function BoardView() {
  const { goalKey } = useParams<{ goalKey: string }>();
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);

  // In a real app, this fetches from the Express API provided by hopi-agent-orchestrator.
  // For the e2e test, we will mock the fetch slightly until the backend API is wired up to serve it.
  const { data: board, isLoading, error, refetch } = useQuery<TodoBoard>({
    queryKey: ['board', goalKey],
    queryFn: async () => {
      const res = await fetch(`http://localhost:3000/api/goals/${goalKey}/board`);
      if (!res.ok) throw new Error('Failed to fetch board');
      return res.json();
    },
    // Fallback data for UI testing before backend API is running
    initialData: {
      goal: { goalKey: goalKey || 'tutorial', title: 'Tutorial Goal' },
      items: [
        { ref: 'task-1', title: 'Plan authentication feature', status: 'done', body: 'Acceptance Criteria: ...', dependencyTaskList: [] },
        { ref: 'task-2', title: 'Implement JWT service', status: 'blocked', body: 'Acceptance Criteria: Implement JWT sign/verify.', dependencyTaskList: ['task-1'] },
        { ref: 'task-3', title: 'Add auth middleware', status: 'planned', body: 'Acceptance Criteria: ...', dependencyTaskList: ['task-2'] },
      ]
    }
  });

  // Listen for SSE triggers from the Reconciler
  useEffect(() => {
    const evtSource = new EventSource('http://localhost:3000/api/events');
    evtSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'board_changed' && data.goalKey === goalKey) {
        refetch(); // Trigger REST refetch per design
      }
    };
    return () => evtSource.close();
  }, [goalKey, refetch]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-red-400 gap-4">
        <AlertCircle className="w-12 h-12" />
        <p className="text-lg">Failed to load board: {(error as Error).message}</p>
      </div>
    );
  }

  const itemsByStatus = (board?.items || []).reduce((acc, item) => {
    // If blocked, we project it onto its owning workflow lane per the design doc
    // (We'll simplify here by just dropping it in the lane that matches its status, but add a blocked badge)
    const lane = item.status === 'blocked' ? 'in_progress' : item.status; // simplified fallback projecting to in_progress for demo

    if (!acc[lane]) acc[lane] = [];
    acc[lane].push(item);
    return acc;
  }, {} as Record<string, TaskItem[]>);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#1A1A1A] relative">
      <header className="px-6 py-4 border-b border-[#333] shrink-0 flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-white">{board?.goal.title}</h2>
          <p className="text-sm text-gray-400 mt-1">Goal Key: <code className="bg-[#2A2A2A] px-1.5 py-0.5 rounded text-purple-400">{board?.goal.goalKey}</code></p>
        </div>
        <button
          onClick={() => setIsAssistantOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors font-medium shadow-lg shadow-purple-900/20"
        >
          <MessageSquare className="w-4 h-4" />
          Goal Assistant
        </button>
      </header>

      <div className="flex-1 overflow-x-auto overflow-y-hidden p-6">
        <div className="flex gap-6 h-full min-w-max pb-4">
          {STATUS_COLUMNS.map((col) => (
            <div key={col.id} className="w-80 flex flex-col shrink-0">
              <div className="flex items-center justify-between mb-4">
                <h3 className={cn("text-sm font-semibold px-3 py-1 border rounded-full uppercase tracking-wider", col.color)}>
                  {col.label}
                </h3>
                <span className="text-xs text-gray-500 font-mono bg-[#2A2A2A] px-2 py-0.5 rounded-full">
                  {itemsByStatus[col.id]?.length || 0}
                </span>
              </div>

              <div className="flex-1 flex flex-col gap-3 overflow-y-auto pr-2 pb-2">
                {itemsByStatus[col.id]?.map((task) => (
                  <TaskCard key={task.ref} task={task} onClick={() => setIsAssistantOpen(true)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <AssistantPanel
        goalKey={board?.goal.goalKey || ''}
        isOpen={isAssistantOpen}
        onClose={() => setIsAssistantOpen(false)}
      />
    </div>
  );
}

function TaskCard({ task, onClick }: { task: TaskItem, onClick: () => void }) {
  const isBlocked = task.status === 'blocked' || task.blockers?.length;

  return (
    <div
      onClick={onClick}
      className={cn(
        "p-4 rounded-xl border transition-all cursor-pointer group shadow-sm",
        isBlocked ? "bg-[#2a1616] border-red-900/50 hover:border-red-500/50" : "bg-[#222] border-[#333] hover:border-purple-500/50 hover:bg-[#252525]"
      )}
    >
      <div className="flex justify-between items-start mb-2 gap-2">
        <span className="text-xs font-mono text-gray-500 bg-[#1A1A1A] px-1.5 py-0.5 rounded">
          {task.ref}
        </span>
        {isBlocked && (
          <span className="text-[10px] font-bold text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full uppercase shrink-0 flex items-center gap-1 animate-pulse">
            <AlertCircle className="w-3 h-3" />
            Intervention Needed
          </span>
        )}
      </div>

      <h4 className="text-sm font-medium text-gray-200 mb-3 leading-snug group-hover:text-purple-300 transition-colors">
        {task.title}
      </h4>

      {task.dependencyTaskList.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-auto">
          {task.dependencyTaskList.map(dep => (
            <span key={dep} className="text-[10px] font-mono text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded border border-blue-400/20">
              depends: {dep}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
