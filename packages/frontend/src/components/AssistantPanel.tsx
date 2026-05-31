import { useState } from 'react';
import { MessageSquare, X, Send, Bot, User, AlertTriangle } from 'lucide-react';
import { cn } from '../lib/utils';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'intervention';
  content: string;
  taskRef?: string;
  timestamp: string;
}

interface AssistantPanelProps {
  goalKey: string;
  isOpen: boolean;
  onClose: () => void;
}

export function AssistantPanel({ goalKey, isOpen, onClose }: AssistantPanelProps) {
  const [input, setInput] = useState('');

  // Mock messages - in reality fetched from the backend's session history for the Goal
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: `Hello! I'm your CTO Assistant for the \`${goalKey}\` goal. How can I help you today?`,
      timestamp: new Date().toISOString()
    },
    {
      id: '2',
      role: 'intervention',
      content: 'Generator crashed repeatedly. The attempt budget is exhausted. Manual review required.',
      taskRef: 'task-auth-01',
      timestamp: new Date().toISOString()
    }
  ]);

  const handleSend = () => {
    if (!input.trim()) return;

    // Add user message
    const newMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, newMsg]);
    setInput('');

    // Mock assistant response (In reality, this goes to the backend hopi-hub or agent-orchestrator)
    setTimeout(() => {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: `I've received your instruction: "${input}". I will update the kanban board accordingly.`,
        timestamp: new Date().toISOString()
      }]);
    }, 1000);
  };

  return (
    <div
      className={cn(
        "fixed inset-y-0 right-0 w-96 bg-[#1A1A1A] border-l border-[#333] shadow-2xl transform transition-transform duration-300 ease-in-out z-50 flex flex-col",
        isOpen ? "translate-x-0" : "translate-x-full"
      )}
    >
      <header className="px-4 py-3 border-b border-[#333] flex items-center justify-between bg-[#141414]">
        <div className="flex items-center gap-2 text-white font-medium">
          <MessageSquare className="w-4 h-4 text-purple-400" />
          Goal Assistant
        </div>
        <button onClick={onClose} className="p-1 hover:bg-[#333] rounded text-gray-400 hover:text-white transition-colors">
          <X className="w-5 h-5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className={cn("flex gap-3", msg.role === 'user' ? "flex-row-reverse" : "")}>

            {/* Avatar */}
            <div className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
              msg.role === 'assistant' ? "bg-purple-500/20 text-purple-400" :
              msg.role === 'user' ? "bg-blue-500/20 text-blue-400" :
              "bg-red-500/20 text-red-400"
            )}>
              {msg.role === 'user' ? <User className="w-4 h-4" /> :
               msg.role === 'intervention' ? <AlertTriangle className="w-4 h-4" /> :
               <Bot className="w-4 h-4" />}
            </div>

            {/* Message Bubble */}
            <div className={cn(
              "max-w-[80%] rounded-2xl px-4 py-2 text-sm",
              msg.role === 'user' ? "bg-blue-600 text-white rounded-tr-sm" :
              msg.role === 'intervention' ? "bg-red-500/10 border border-red-500/20 text-red-200 rounded-tl-sm" :
              "bg-[#2A2A2A] text-gray-200 rounded-tl-sm"
            )}>
              {msg.role === 'intervention' && (
                <div className="text-xs font-bold text-red-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                  Intervention Needed
                </div>
              )}
              {msg.taskRef && (
                <div className="mb-2">
                  <span className="text-xs font-mono bg-black/30 px-1.5 py-0.5 rounded text-gray-300">
                    {msg.taskRef}
                  </span>
                </div>
              )}
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-[#333] bg-[#141414]">
        <div className="relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask assistant to plan or fix tasks..."
            className="w-full bg-[#222] border border-[#444] rounded-lg pl-4 pr-10 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-purple-400 hover:text-purple-300 disabled:opacity-50 disabled:hover:text-purple-400 transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
