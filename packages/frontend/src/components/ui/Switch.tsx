import { Switch, type SwitchProps } from '@heroui/react/switch'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export interface AppSwitchProps extends Omit<SwitchProps, 'children' | 'className'> {
  children: ReactNode
  className?: string
}

export function AppSwitch({ children, className, ...props }: AppSwitchProps) {
  return (
    <Switch className={cn('app-switch', className)} {...props}>
      <Switch.Content className="app-switch__content">
        {children}
        <Switch.Control className="app-switch__control">
          <Switch.Thumb className="app-switch__thumb" />
        </Switch.Control>
      </Switch.Content>
    </Switch>
  )
}
