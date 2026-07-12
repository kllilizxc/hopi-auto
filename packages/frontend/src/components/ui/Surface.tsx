import { Card, type CardProps } from '@heroui/react/card'
import { Surface, type SurfaceProps } from '@heroui/react/surface'
import { cn } from '../../lib/utils'

export interface AppSurfaceProps extends Omit<SurfaceProps, 'className'> {
  className?: string
}

export function AppSurface({ className, ...props }: AppSurfaceProps) {
  return <Surface className={cn('app-surface', className)} {...props} />
}

export interface AppCardProps extends Omit<CardProps, 'className'> {
  className?: string
}

export function AppCard({ className, ...props }: AppCardProps) {
  return <Card className={cn('app-card', className)} {...props} />
}
