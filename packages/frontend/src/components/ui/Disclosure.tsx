import { Disclosure, type DisclosureProps } from '@heroui/react/disclosure'
import { useState, type ReactNode } from 'react'
import { cn } from '../../lib/utils'

export interface AppDisclosureProps
  extends Omit<DisclosureProps, 'children' | 'className' | 'onExpandedChange'> {
  bodyClassName?: string
  children: ReactNode
  className?: string
  contentClassName?: string
  headingClassName?: string
  lazy?: boolean
  onExpandedChange?: (expanded: boolean) => void
  summary: ReactNode
  triggerClassName?: string
}

export function AppDisclosure({
  bodyClassName,
  children,
  className,
  contentClassName,
  headingClassName,
  isExpanded,
  defaultExpanded,
  lazy = true,
  onExpandedChange,
  summary,
  triggerClassName,
  ...props
}: AppDisclosureProps) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded ?? false)
  const expanded = isExpanded ?? internalExpanded

  return (
    <Disclosure
      className={cn('app-disclosure', className)}
      defaultExpanded={isExpanded === undefined ? defaultExpanded : undefined}
      isExpanded={isExpanded}
      onExpandedChange={(nextExpanded) => {
        if (isExpanded === undefined) setInternalExpanded(nextExpanded)
        onExpandedChange?.(nextExpanded)
      }}
      {...props}
    >
      <Disclosure.Heading className={cn('app-disclosure__heading', headingClassName)}>
        <Disclosure.Trigger className={cn('app-disclosure__trigger', triggerClassName)}>
          {summary}
        </Disclosure.Trigger>
      </Disclosure.Heading>
      <Disclosure.Content className={cn('app-disclosure__content', contentClassName)}>
        <Disclosure.Body className={cn('app-disclosure__body', bodyClassName)}>
          {!lazy || expanded ? children : null}
        </Disclosure.Body>
      </Disclosure.Content>
    </Disclosure>
  )
}
