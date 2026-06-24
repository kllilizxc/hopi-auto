import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, ArrowLeft, FileText, Loader2 } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { ScrollContainer } from '../components/ScrollContainer'
import { type GoalDocsSnapshot, readGoalDocs } from '../lib/api'
import { buildGoalRoute, goalScopedQueryKey } from '../lib/goalScope'
import { cn } from '../lib/utils'

export function GoalDocsPage() {
  const routeParams = useParams<{ goalKey: string; projectKey: string }>()
  const goalKey = routeParams.goalKey
  const projectKey = routeParams.projectKey
  const boardHref = buildGoalRoute(
    goalKey ? { goalKey, projectKey: projectKey ?? null } : null,
    'board',
  )

  const { data, isLoading, error } = useQuery<GoalDocsSnapshot>({
    queryKey: goalScopedQueryKey('goal-docs-page', goalKey, projectKey),
    queryFn: async () => {
      if (!goalKey) {
        throw new Error('Missing goal key')
      }

      return readGoalDocs(goalKey, projectKey)
    },
    enabled: Boolean(goalKey),
  })

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#1A1A1A]">
        <div className="flex items-center gap-2 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading docs…
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#1A1A1A] p-6">
        <div className="max-w-lg rounded-2xl border border-red-500/20 bg-red-500/10 p-5 text-red-200">
          <div className="flex items-center gap-2 font-medium">
            <AlertCircle className="w-4 h-4" />
            Failed to load goal docs
          </div>
          <div className="mt-2 text-sm text-red-200/80">
            {error instanceof Error ? error.message : 'Unknown error'}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#1A1A1A]">
      <header className="px-6 py-4 border-b border-[#333] shrink-0 flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Link
              to={boardHref}
              className="inline-flex items-center gap-2 rounded-lg border border-[#333] bg-[#202020] px-3 py-1.5 text-sm text-gray-300 transition hover:border-purple-500/30 hover:text-white"
            >
              <ArrowLeft className="w-4 h-4" />
              Board
            </Link>
            <h2 className="text-2xl font-bold text-white">Goal Docs</h2>
          </div>
          <p className="mt-2 text-sm text-gray-400">
            Goal Key:{' '}
            <code className="bg-[#2A2A2A] px-1.5 py-0.5 rounded text-purple-400">
              {data?.goalKey ?? goalKey}
            </code>
            {projectKey && (
              <>
                {' '}· Project:{' '}
                <code className="bg-[#2A2A2A] px-1.5 py-0.5 rounded text-amber-300">
                  {projectKey}
                </code>
              </>
            )}
          </p>
        </div>
      </header>

      <ScrollContainer
        axis="vertical"
        className="flex-1 min-h-0"
        viewportClassName="h-full p-6"
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <GoalDocCard
            title="goal.md"
            subtitle={data?.goal.path ?? 'Goal snapshot'}
            status={data?.goal.status}
            content={data?.goal.content}
          />
          <GoalDocCard
            title="design.md"
            subtitle={data?.design.path ?? 'Design snapshot'}
            status={data?.design.status}
            content={data?.design.content}
          />
        </div>
      </ScrollContainer>
    </div>
  )
}

function GoalDocCard({
  title,
  subtitle,
  status,
  content,
}: {
  title: string
  subtitle: string
  status?: GoalDocsSnapshot['goal']['status']
  content?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const normalizedContent = content?.trim() || 'Loading document snapshot...'
  const hasOverflow =
    normalizedContent !== 'Loading document snapshot...' &&
    (normalizedContent.split('\n').length > 6 || normalizedContent.length > 480)

  return (
    <div className="rounded-2xl border border-[#2f2f2f] bg-[#1D1D1D] p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-medium text-white">
            <FileText className="w-4 h-4 text-purple-400" />
            {title}
          </div>
          <p className="mt-1 break-all text-xs text-gray-500">{subtitle}</p>
        </div>
        {status && (
          <span
            className={cn(
              'rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase',
              status === 'curated'
                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                : 'border-yellow-500/20 bg-yellow-500/10 text-yellow-300',
            )}
          >
            {status}
          </span>
        )}
      </div>

      <pre
        className={cn(
          'm-0 whitespace-pre-wrap break-words font-mono text-xs leading-6 text-gray-400',
          !expanded && 'line-clamp-6',
        )}
      >
        {normalizedContent}
      </pre>
      {hasOverflow && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="rounded-lg border border-[#343434] bg-[#111] px-3 py-1.5 text-[11px] font-medium text-gray-300 transition hover:border-purple-500/40 hover:text-white"
          >
            {expanded ? 'Collapse doc' : 'Show full doc'}
          </button>
        </div>
      )}
    </div>
  )
}
