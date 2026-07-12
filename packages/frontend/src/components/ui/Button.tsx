import {
  Button as HeroButton,
  type ButtonProps as HeroButtonProps,
} from '@heroui/react/button'
import {
  ButtonGroup as HeroButtonGroup,
  type ButtonGroupProps as HeroButtonGroupProps,
} from '@heroui/react/button-group'
import {
  CloseButton as HeroCloseButton,
  type CloseButtonProps as HeroCloseButtonProps,
} from '@heroui/react/close-button'
import { cn } from '../../lib/utils'

export interface AppButtonProps extends Omit<HeroButtonProps, 'className' | 'isDisabled'> {
  className?: string
  disabled?: boolean
  isDisabled?: boolean
  title?: string
}

export function AppButton({ className, disabled, isDisabled, ...props }: AppButtonProps) {
  return (
    <HeroButton
      className={cn('app-button', className)}
      isDisabled={disabled ?? isDisabled}
      {...props}
    />
  )
}

export interface IconButtonProps extends Omit<AppButtonProps, 'isIconOnly'> {}

export function IconButton({ className, variant = 'ghost', ...props }: IconButtonProps) {
  return (
    <AppButton
      className={cn('icon-button', className)}
      isIconOnly
      variant={variant}
      {...props}
    />
  )
}

export interface AppCloseButtonProps extends Omit<HeroCloseButtonProps, 'className'> {
  className?: string
}

export function AppCloseButton({ className, ...props }: AppCloseButtonProps) {
  return <HeroCloseButton className={cn('app-close-button', className)} {...props} />
}

export interface AppButtonGroupProps extends Omit<HeroButtonGroupProps, 'className'> {
  className?: string
}

export function AppButtonGroup({ className, ...props }: AppButtonGroupProps) {
  return <HeroButtonGroup className={cn('app-button-group', className)} {...props} />
}
