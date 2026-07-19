import {
  Tabs as HeroTabs,
  type TabListProps as HeroTabListProps,
  type TabPanelProps as HeroTabPanelProps,
  type TabProps as HeroTabProps,
  type TabsProps as HeroTabsProps,
} from '@heroui/react/tabs'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export interface AppTabsProps extends Omit<HeroTabsProps, 'className'> {
  className?: string
}

function AppTabsRoot({ className, ...props }: AppTabsProps) {
  return <HeroTabs className={cn('app-tabs', className)} {...props} />
}

export interface AppTabListProps extends Omit<HeroTabListProps, 'className'> {
  className?: string
}

function AppTabList({ className, ...props }: AppTabListProps) {
  return <HeroTabs.List className={cn('app-tabs__list', className)} {...props} />
}

export interface AppTabProps extends Omit<HeroTabProps, 'children' | 'className'> {
  children: ReactNode
  className?: string
}

function AppTab({ children, className, ...props }: AppTabProps) {
  return (
    <HeroTabs.Tab className={cn('app-tabs__tab', className)} {...props}>
      <HeroTabs.Indicator className="app-tabs__indicator" />
      <span className="app-tabs__label">{children}</span>
    </HeroTabs.Tab>
  )
}

export interface AppTabPanelProps extends Omit<HeroTabPanelProps, 'className'> {
  className?: string
}

function AppTabPanel({ className, ...props }: AppTabPanelProps) {
  return <HeroTabs.Panel className={cn('app-tabs__panel', className)} {...props} />
}

export const AppTabs = Object.assign(AppTabsRoot, {
  List: AppTabList,
  Panel: AppTabPanel,
  Tab: AppTab,
})
