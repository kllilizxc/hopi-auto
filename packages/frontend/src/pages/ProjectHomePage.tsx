import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderOpen, Link2, Loader2, Plus, Settings2, TerminalSquare, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createProject,
  readProjects,
  type CodingAgentTransport,
  type CodingReasoningEffort,
  type ProjectCodingDefaults,
  type ProjectRecord,
  updateProjectSettings,
} from '../lib/api'
import { cn } from '../lib/utils'
import { ScrollContainer } from '../components/ScrollContainer'

interface CodingDefaultsDraft {
  transport: CodingAgentTransport
  model: string
  reasoningEffort: CodingReasoningEffort
}

const DEFAULT_CODING_DEFAULTS_DRAFT: CodingDefaultsDraft = {
  transport: 'codex',
  model: 'gpt-5.4',
  reasoningEffort: 'xhigh',
}

const CODING_AGENT_OPTIONS: Array<{
  label: string
  value: CodingAgentTransport
}> = [
  { label: 'Codex', value: 'codex' },
  { label: 'Claude', value: 'claude' },
  { label: 'OpenCode', value: 'opencode' },
]

const CODING_REASONING_OPTIONS: Array<{
  label: string
  value: CodingReasoningEffort
}> = [
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'xHigh', value: 'xhigh' },
]

export function ProjectHomePage() {
  const [draft, setDraft] = useState({
    rootDir: '.',
    nameOverride: null as string | null,
    codingDefaults: DEFAULT_CODING_DEFAULTS_DRAFT,
  })
  const [editingProject, setEditingProject] = useState<ProjectRecord | null>(null)
  const [settingsDraft, setSettingsDraft] = useState<CodingDefaultsDraft>(
    DEFAULT_CODING_DEFAULTS_DRAFT,
  )
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: readProjects,
  })

  const createProjectMutation = useMutation({
    mutationFn: createProject,
    onSuccess: async () => {
      setDraft((current) => ({
        ...current,
        nameOverride: null,
      }))
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })

  const updateProjectSettingsMutation = useMutation({
    mutationFn: ({
      projectKey,
      codingDefaults,
    }: {
      projectKey: string
      codingDefaults: ProjectCodingDefaults
    }) => updateProjectSettings(projectKey, { codingDefaults }),
    onSuccess: async () => {
      setEditingProject(null)
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })

  const projects = projectsQuery.data?.projects ?? []
  const derivedDisplayName = useMemo(() => deriveDisplayNameFromPath(draft.rootDir), [draft.rootDir])
  const resolvedDisplayName = draft.nameOverride ?? derivedDisplayName
  const generatedProjectKey = useMemo(
    () => deriveProjectKey(resolvedDisplayName || derivedDisplayName),
    [derivedDisplayName, resolvedDisplayName],
  )
  const sortedProjects = useMemo(
    () =>
      [...projects].sort((left, right) => {
        return Date.parse(right.createdAt) - Date.parse(left.createdAt)
      }),
    [projects],
  )

  return (
    <>
      <ScrollContainer axis="vertical" className="flex-1 bg-[#1A1A1A]" viewportClassName="h-full">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8">
          <section className="grid gap-6 lg:grid-cols-[1.3fr_0.9fr]">
            <div className="rounded-2xl border border-[#333] bg-[#141414] p-6">
              <div className="flex items-center gap-3 text-white">
                <FolderOpen className="h-5 w-5 text-amber-300" />
                <h1 className="text-2xl font-semibold">Projects</h1>
              </div>
              <p className="mt-2 text-sm text-gray-400">
                Link a local workspace, then create goals inside it.
              </p>

              <div className="mt-6 grid gap-4">
                {sortedProjects.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[#333] bg-[#111] px-4 py-10 text-center text-sm text-gray-500">
                    No linked projects yet.
                  </div>
                ) : (
                  sortedProjects.map((project) => (
                    <ProjectCard
                      key={project.projectKey}
                      project={project}
                      onEditSettings={() => {
                        setEditingProject(project)
                        setSettingsDraft(projectCodingDefaultsToDraft(project.codingDefaults))
                      }}
                      onOpenNewGoal={() =>
                        navigate(`/projects/${encodeURIComponent(project.projectKey)}/goals/new`)
                      }
                      onOpenLastGoal={() =>
                        project.lastOpenedGoalKey
                          ? navigate(
                              `/projects/${encodeURIComponent(project.projectKey)}/board/${encodeURIComponent(project.lastOpenedGoalKey)}`,
                            )
                          : undefined
                      }
                    />
                  ))
                )}
              </div>
            </div>

            <section className="rounded-2xl border border-[#333] bg-[#141414] p-6">
              <div className="flex items-center gap-3 text-white">
                <Link2 className="h-5 w-5 text-emerald-300" />
                <h2 className="text-xl font-semibold">Link Local Project</h2>
              </div>
              <div className="mt-5 grid gap-4">
                <Field
                  label="Local path"
                  value={draft.rootDir}
                  onChange={(value) => setDraft((current) => ({ ...current, rootDir: value }))}
                  placeholder="."
                />
                <Field
                  label="Display name"
                  value={resolvedDisplayName}
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      nameOverride:
                        !value.trim() || value.trim() === deriveDisplayNameFromPath(current.rootDir)
                          ? null
                          : value,
                    }))
                  }
                  placeholder="Workspace A"
                />
                <ReadonlyField
                  label="Project key"
                  value={generatedProjectKey}
                  placeholder="generated automatically"
                />
                <CodingDefaultsFields
                  draft={draft.codingDefaults}
                  onChange={(codingDefaults) => setDraft((current) => ({ ...current, codingDefaults }))}
                />
              </div>

              {(createProjectMutation.error || projectsQuery.error) && (
                <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {String(
                    (createProjectMutation.error as Error | null)?.message ??
                      (projectsQuery.error as Error | null)?.message,
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={() =>
                  createProjectMutation.mutate({
                    rootDir: draft.rootDir.trim(),
                    name: resolvedDisplayName.trim() || undefined,
                    codingDefaults: draftToProjectCodingDefaults(draft.codingDefaults),
                  })
                }
                disabled={createProjectMutation.isPending || !draft.rootDir.trim()}
                className="mt-6 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-60"
              >
                {createProjectMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Link Project
              </button>
            </section>
          </section>
        </div>
      </ScrollContainer>

      <ProjectSettingsModal
        draft={settingsDraft}
        error={updateProjectSettingsMutation.error as Error | null}
        isOpen={Boolean(editingProject)}
        isSaving={updateProjectSettingsMutation.isPending}
        project={editingProject}
        onChange={setSettingsDraft}
        onClose={() => {
          if (!updateProjectSettingsMutation.isPending) {
            setEditingProject(null)
          }
        }}
        onSave={() => {
          if (!editingProject) {
            return
          }
          updateProjectSettingsMutation.mutate({
            projectKey: editingProject.projectKey,
            codingDefaults: draftToProjectCodingDefaults(settingsDraft),
          })
        }}
      />
    </>
  )
}

function ProjectCard({
  project,
  onEditSettings,
  onOpenNewGoal,
  onOpenLastGoal,
}: {
  project: ProjectRecord
  onEditSettings: () => void
  onOpenNewGoal: () => void
  onOpenLastGoal: () => void
}) {
  return (
    <div className="rounded-xl border border-[#333] bg-[#111] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-white">{project.name}</span>
            <span className="rounded-full border border-[#333] bg-[#1A1A1A] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-300">
              {project.projectKey}
            </span>
          </div>
          <p className="mt-2 truncate text-sm text-gray-400">{project.rootDir}</p>
          <p className="mt-2 text-xs text-gray-500">
            Defaults: <span className="text-gray-300">{formatCodingDefaultsSummary(project.codingDefaults)}</span>
          </p>
          {project.lastOpenedGoalKey && (
            <p className="mt-2 text-xs text-gray-500">
              Last goal: <span className="text-gray-300">{project.lastOpenedGoalKey}</span>
            </p>
          )}
        </div>
        <TerminalSquare className="h-5 w-5 shrink-0 text-gray-500" />
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onOpenNewGoal}
          className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-black transition-colors hover:bg-amber-400"
        >
          New Goal
        </button>
        <button
          type="button"
          onClick={onOpenLastGoal}
          disabled={!project.lastOpenedGoalKey}
          className={cn(
            'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            project.lastOpenedGoalKey
              ? 'bg-[#252525] text-gray-200 hover:bg-[#2f2f2f]'
              : 'cursor-not-allowed bg-[#1f1f1f] text-gray-500',
          )}
        >
          Open Last Goal
        </button>
        <button
          type="button"
          onClick={onEditSettings}
          className="inline-flex items-center gap-2 rounded-lg border border-[#333] bg-[#181818] px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-[#454545] hover:text-white"
        >
          <Settings2 className="h-4 w-4" />
          Settings
        </button>
      </div>
    </div>
  )
}

function ProjectSettingsModal({
  project,
  isOpen,
  isSaving,
  draft,
  error,
  onChange,
  onClose,
  onSave,
}: {
  project: ProjectRecord | null
  isOpen: boolean
  isSaving: boolean
  draft: CodingDefaultsDraft
  error: Error | null
  onChange: (draft: CodingDefaultsDraft) => void
  onClose: () => void
  onSave: () => void
}) {
  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSaving) {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isSaving, onClose])

  if (!isOpen || !project) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6">
      <div className="absolute inset-0" aria-hidden="true" onClick={() => !isSaving && onClose()} />

      <div className="relative z-10 flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#343434] bg-[#111] shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-[#2d2d2d] px-6 py-5">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
              Project Settings
            </p>
            <h3 className="mt-2 text-xl font-semibold text-white">{project.name}</h3>
            <p className="mt-2 text-sm text-gray-400">{project.rootDir}</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#343434] bg-[#181818] text-gray-300 transition hover:border-[#4a4a4a] hover:text-white disabled:opacity-60"
            aria-label="Close project settings"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid gap-4 px-6 py-5">
          <CodingDefaultsFields draft={draft} onChange={onChange} />

          {error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error.message}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[#2d2d2d] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg border border-[#333] bg-[#181818] px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-[#454545] hover:text-white disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-60"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save Settings
          </button>
        </div>
      </div>
    </div>
  )
}

function CodingDefaultsFields({
  draft,
  onChange,
}: {
  draft: CodingDefaultsDraft
  onChange: (draft: CodingDefaultsDraft) => void
}) {
  return (
    <div className="grid gap-4 rounded-xl border border-[#2b2b2b] bg-[#101010] p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-white">Coding Defaults</h3>
          <p className="mt-1 text-xs text-gray-500">
            Applies to Goal Assistant plus planner, generator, reviewer, and merger unless an explicit override exists.
          </p>
        </div>
      </div>

      <SelectField
        label="Default coding agent"
        value={draft.transport}
        onChange={(value) =>
          onChange({
            ...draft,
            transport: value as CodingAgentTransport,
            model:
              value === 'codex' && !draft.model.trim()
                ? DEFAULT_CODING_DEFAULTS_DRAFT.model
                : draft.model,
          })
        }
        options={CODING_AGENT_OPTIONS}
      />

      <Field
        label="Model"
        value={draft.model}
        onChange={(value) => onChange({ ...draft, model: value })}
        placeholder={
          draft.transport === 'codex'
            ? 'gpt-5.4'
            : 'Leave blank to use the selected tool default'
        }
      />

      {draft.transport === 'codex' ? (
        <SelectField
          label="Thinking depth"
          value={draft.reasoningEffort}
          onChange={(value) =>
            onChange({
              ...draft,
              reasoningEffort: value as CodingReasoningEffort,
            })
          }
          options={CODING_REASONING_OPTIONS}
        />
      ) : null}
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <label className="grid gap-2 text-sm text-gray-300">
      <span>{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="rounded-lg border border-[#333] bg-[#111] px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-amber-400"
      />
    </label>
  )
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ label: string; value: string }>
}) {
  return (
    <label className="grid gap-2 text-sm text-gray-300">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-[#333] bg-[#111] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-amber-400"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function ReadonlyField({
  label,
  value,
  placeholder,
}: {
  label: string
  value: string
  placeholder: string
}) {
  return (
    <label className="grid gap-2 text-sm text-gray-300">
      <span>{label}</span>
      <div className="rounded-lg border border-[#333] bg-[#111] px-3 py-2 text-sm text-gray-400">
        {value || placeholder}
      </div>
    </label>
  )
}

function projectCodingDefaultsToDraft(codingDefaults: ProjectCodingDefaults): CodingDefaultsDraft {
  return {
    transport: codingDefaults.transport,
    model:
      codingDefaults.transport === 'codex'
        ? codingDefaults.model ?? DEFAULT_CODING_DEFAULTS_DRAFT.model
        : codingDefaults.model ?? '',
    reasoningEffort:
      codingDefaults.transport === 'codex'
        ? codingDefaults.reasoningEffort ?? DEFAULT_CODING_DEFAULTS_DRAFT.reasoningEffort
        : DEFAULT_CODING_DEFAULTS_DRAFT.reasoningEffort,
  }
}

function draftToProjectCodingDefaults(draft: CodingDefaultsDraft): ProjectCodingDefaults {
  const model = draft.model.trim()

  if (draft.transport === 'codex') {
    return {
      transport: 'codex',
      model: model || DEFAULT_CODING_DEFAULTS_DRAFT.model,
      reasoningEffort: draft.reasoningEffort,
    }
  }

  return {
    transport: draft.transport,
    ...(model ? { model } : {}),
  }
}

function formatCodingDefaultsSummary(codingDefaults: ProjectCodingDefaults) {
  if (codingDefaults.transport === 'codex') {
    return `${codingDefaults.transport} · ${codingDefaults.model ?? 'gpt-5.4'} · ${formatReasoningEffort(codingDefaults.reasoningEffort ?? 'xhigh')}`
  }

  return `${codingDefaults.transport} · ${codingDefaults.model?.trim() || 'tool default'}`
}

function formatReasoningEffort(value: CodingReasoningEffort) {
  return value === 'xhigh' ? 'xHigh' : value
}

function deriveDisplayNameFromPath(rootDir: string) {
  const trimmed = rootDir.trim()
  if (!trimmed || trimmed === '.') {
    return 'Current Project'
  }

  const normalized = trimmed.replace(/[\\/]+$/, '')
  if (!normalized || normalized === '.' || normalized === '..') {
    return 'Linked Project'
  }

  const segments = normalized.split(/[\\/]/).filter(Boolean)
  return segments.at(-1) || 'Linked Project'
}

function deriveProjectKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
