import { CirclePlay, Square } from 'lucide-react'
import type { PreviewSession, PreviewSurface } from '../lib/api'
import { cn } from '../lib/utils'
import {
  AppButton,
  AppButtonGroup,
  AppSpinner,
  IconButton,
  SelectField,
} from './ui'

interface ProjectPreviewControlProps {
  ariaLabel: string
  className?: string
  error?: string | null
  onStart: () => void
  onStop: () => void
  startLabel?: string
  startPending: boolean
  status?: PreviewSession['status']
  stopPending: boolean
  surfaces?: readonly PreviewSurface[]
}

export function ProjectPreviewControl({
  ariaLabel,
  className,
  error,
  onStart,
  onStop,
  startLabel = 'Preview',
  startPending,
  status = 'stopped',
  stopPending,
  surfaces = [],
}: ProjectPreviewControlProps) {
  const running = status === 'running'

  return (
    <AppButtonGroup
      aria-label={`${ariaLabel} controls`}
      className={cn('preview-compact-control', className)}
    >
      {running ? (
        <SelectField
          aria-label={`${ariaLabel}: choose a surface`}
          className="preview-surface-select"
          onValueChange={(surfaceId) => {
            const surface = surfaces.find((candidate) => candidate.id === surfaceId)
            if (surface) window.open(surface.url, '_blank', 'noopener,noreferrer')
          }}
          options={surfaces.map((surface) => ({
            value: surface.id,
            textValue: surface.label,
            label: surface.label,
            description: surface.url,
          }))}
          placeholder={`Preview · ${surfaces.length}`}
          triggerClassName="preview-compact-open"
          value={null}
        />
      ) : (
        <AppButton
          className="secondary-button preview-start-button"
          disabled={startPending || status === 'starting'}
          onClick={onStart}
          title={error ?? `Start ${ariaLabel}`}
          type="button"
        >
          {startPending || status === 'starting' ? <AppSpinner size="sm" /> : <CirclePlay />}
          {startLabel}
        </AppButton>
      )}
      {running ? (
        <IconButton
          aria-label={`Stop ${ariaLabel}`}
          className="icon-button preview-stop-button"
          disabled={stopPending}
          onClick={onStop}
          title={`Stop ${ariaLabel}`}
          type="button"
        >
          {stopPending ? <AppSpinner size="sm" /> : <Square />}
        </IconButton>
      ) : null}
    </AppButtonGroup>
  )
}
