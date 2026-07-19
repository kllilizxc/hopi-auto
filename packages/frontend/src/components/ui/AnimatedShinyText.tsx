import type { ComponentPropsWithoutRef, CSSProperties } from 'react'
import { cn } from '../../lib/utils'

export interface AnimatedShinyTextProps extends ComponentPropsWithoutRef<'span'> {
  shimmerWidth?: number
}

// Source-vendored from Magic UI's MIT-licensed Animated Shiny Text registry primitive.
export function AnimatedShinyText({
  children,
  className,
  shimmerWidth = 100,
  style,
  ...props
}: AnimatedShinyTextProps) {
  return (
    <span
      className={cn('animated-shiny-text', className)}
      style={
        {
          '--shiny-width': `${shimmerWidth}px`,
          ...style,
        } as CSSProperties
      }
      {...props}
    >
      {children}
    </span>
  )
}
