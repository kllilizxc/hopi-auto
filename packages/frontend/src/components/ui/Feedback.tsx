import { Alert, type AlertProps } from '@heroui/react/alert'
import { Badge, type BadgeProps } from '@heroui/react/badge'
import { Chip, type ChipProps } from '@heroui/react/chip'
import { Spinner, type SpinnerProps } from '@heroui/react/spinner'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export interface AppBreathingIndicatorProps {
  className?: string
}

export function AppBreathingIndicator({ className }: AppBreathingIndicatorProps) {
  return <span aria-hidden="true" className={cn('app-breathing-indicator', className)} />
}

export interface AppSpinnerProps extends Omit<SpinnerProps, 'className'> {
  className?: string
}

export function AppSpinner({ className, ...props }: AppSpinnerProps) {
  return <Spinner aria-label="Loading" className={cn('app-spinner', className)} {...props} />
}

export interface WorkingIndicatorProps {
  className?: string
  label?: ReactNode
}

export function WorkingIndicator({ className, label }: WorkingIndicatorProps) {
  const accessibleLabel = typeof label === 'string' ? label : 'Working'

  return (
    <span className={cn('working-indicator', className)}>
      <AppSpinner
        aria-hidden={label !== undefined || undefined}
        aria-label={label === undefined ? accessibleLabel : undefined}
        className="working-indicator__spinner"
        size="sm"
      />
      {label !== undefined ? <span className="working-indicator__label">{label}</span> : null}
    </span>
  )
}

export interface AppAlertProps extends Omit<AlertProps, 'children' | 'className'> {
  children: ReactNode
  className?: string
}

export function AppAlert({ children, className, status = 'danger', ...props }: AppAlertProps) {
  return (
    <Alert className={cn('app-alert', className)} status={status} {...props}>
      {children}
    </Alert>
  )
}

export interface StatusChipProps extends Omit<ChipProps, 'children' | 'className'> {
  children: ReactNode
  className?: string
}

export function StatusChip({ children, className, ...props }: StatusChipProps) {
  return (
    <Chip className={cn('app-status-chip', className)} {...props}>
      <Chip.Label>{children}</Chip.Label>
    </Chip>
  )
}

export interface CountBadgeProps extends Omit<BadgeProps, 'children' | 'className'> {
  children: ReactNode
  className?: string
}

export function CountBadge({ children, className, size = 'sm', ...props }: CountBadgeProps) {
  return (
    <Badge className={cn('app-count-badge', className)} size={size} {...props}>
      <Badge.Label>{children}</Badge.Label>
    </Badge>
  )
}
