import { Link as HeroLink, type LinkProps as HeroLinkProps } from '@heroui/react/link'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { createPath, Link as RouterLink, type LinkProps as RouterLinkProps } from 'react-router-dom'
import { cn } from '../../lib/utils'

export interface AppLinkProps extends Omit<HeroLinkProps, 'children' | 'className'> {
  children: ReactNode
  className?: string
  title?: string
}

export function AppLink({ className, ...props }: AppLinkProps) {
  return <HeroLink className={cn('app-link', className)} {...props} />
}

export interface AppRouterLinkProps
  extends Omit<RouterLinkProps, 'children' | 'className'> {
  children: ReactNode
  className?: string
}

export function AppRouterLink({
  children,
  className,
  to,
  ...routerProps
}: AppRouterLinkProps) {
  const href = typeof to === 'string' ? to : createPath(to)

  return (
    <HeroLink
      className={cn('app-link', className)}
      href={href}
      render={(domProps) => (
        <RouterLink
          {...(domProps as AnchorHTMLAttributes<HTMLAnchorElement>)}
          {...routerProps}
          to={to}
        >
          {children}
        </RouterLink>
      )}
    >
      {children}
    </HeroLink>
  )
}
