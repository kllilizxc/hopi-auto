import { Outlet, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, TerminalSquare } from 'lucide-react';
import { cn } from '../lib/utils';

export function Layout() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-[#1A1A1A] text-gray-200 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-[#141414] border-r border-[#333] flex flex-col">
        <div className="p-4 border-b border-[#333]">
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <LayoutDashboard className="w-5 h-5 text-purple-500" />
            HOPI Agent
          </h1>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <Link
            to="/board/tutorial"
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-md transition-colors",
              location.pathname.startsWith('/board')
                ? "bg-purple-500/10 text-purple-400"
                : "hover:bg-[#2A2A2A] text-gray-400 hover:text-gray-200"
            )}
          >
            <LayoutDashboard className="w-4 h-4" />
            Kanban Board
          </Link>
          <Link
            to="/session/example"
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-md transition-colors",
              location.pathname.startsWith('/session')
                ? "bg-purple-500/10 text-purple-400"
                : "hover:bg-[#2A2A2A] text-gray-400 hover:text-gray-200"
            )}
          >
            <TerminalSquare className="w-4 h-4" />
            Active Sessions
          </Link>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
