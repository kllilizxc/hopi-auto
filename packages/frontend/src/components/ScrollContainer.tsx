import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react'
import { cn } from '../lib/utils'

type ScrollAxis = 'horizontal' | 'vertical' | 'both'

interface ScrollContainerProps {
  children: ReactNode
  axis?: ScrollAxis
  className?: string
  viewportClassName?: string
  viewportRef?: Ref<HTMLDivElement>
  viewportProps?: HTMLAttributes<HTMLDivElement>
}

interface ScrollEdgeState {
  left: boolean
  right: boolean
  top: boolean
  bottom: boolean
}

const ACTIVE_SCROLLBAR_TIMEOUT_MS = 900
const EDGE_THRESHOLD_PX = 2
const MASK_FADE_PX = 18

export function ScrollContainer({
  children,
  axis = 'vertical',
  className,
  viewportClassName,
  viewportRef: forwardedViewportRef,
  viewportProps,
}: ScrollContainerProps) {
  const viewportInnerRef = useRef<HTMLDivElement | null>(null)
  const hideTimerRef = useRef<number | null>(null)
  const [isInteracting, setIsInteracting] = useState(false)
  const [edges, setEdges] = useState<ScrollEdgeState>({
    left: false,
    right: false,
    top: false,
    bottom: false,
  })

  const updateEdges = useCallback(() => {
    const viewport = viewportInnerRef.current
    if (!viewport) {
      return
    }

    const canScrollHorizontally = axis === 'horizontal' || axis === 'both'
    const canScrollVertically = axis === 'vertical' || axis === 'both'
    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
    const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)

    setEdges({
      left: canScrollHorizontally && viewport.scrollLeft > EDGE_THRESHOLD_PX,
      right:
        canScrollHorizontally &&
        viewport.scrollLeft < maxScrollLeft - EDGE_THRESHOLD_PX,
      top: canScrollVertically && viewport.scrollTop > EDGE_THRESHOLD_PX,
      bottom:
        canScrollVertically &&
        viewport.scrollTop < maxScrollTop - EDGE_THRESHOLD_PX,
    })
  }, [axis])

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  const markInteracting = useCallback(() => {
    clearHideTimer()
    setIsInteracting(true)
  }, [clearHideTimer])

  const scheduleHide = useCallback(() => {
    clearHideTimer()
    hideTimerRef.current = window.setTimeout(() => {
      setIsInteracting(false)
      hideTimerRef.current = null
    }, ACTIVE_SCROLLBAR_TIMEOUT_MS)
  }, [clearHideTimer])

  useEffect(() => {
    updateEdges()
    const viewport = viewportInnerRef.current
    if (!viewport) {
      return
    }

    const resizeObserver = new ResizeObserver(() => {
      updateEdges()
    })
    resizeObserver.observe(viewport)
    for (const child of Array.from(viewport.children)) {
      resizeObserver.observe(child)
    }

    return () => {
      resizeObserver.disconnect()
    }
  }, [children, updateEdges])

  useEffect(() => {
    return () => {
      clearHideTimer()
    }
  }, [clearHideTimer])

  const overflowClassName = useMemo(() => {
    if (axis === 'horizontal') {
      return 'overflow-x-auto overflow-y-hidden'
    }
    if (axis === 'both') {
      return 'overflow-auto'
    }
    return 'overflow-y-auto overflow-x-hidden'
  }, [axis])

  const viewportMaskStyle = useMemo(
    () => buildViewportMaskStyle(axis, edges),
    [axis, edges],
  )

  const {
    onScroll: viewportOnScroll,
    onWheel: viewportOnWheel,
    onPointerDown: viewportOnPointerDown,
    onPointerMove: viewportOnPointerMove,
    onTouchStart: viewportOnTouchStart,
    onFocus: viewportOnFocus,
    onMouseLeave: viewportOnMouseLeave,
    ...restViewportProps
  } = viewportProps ?? {}

  const setViewportRef = useCallback(
    (node: HTMLDivElement | null) => {
      viewportInnerRef.current = node
      if (!forwardedViewportRef) {
        return
      }
      if (typeof forwardedViewportRef === 'function') {
        forwardedViewportRef(node)
        return
      }
      forwardedViewportRef.current = node
    },
    [forwardedViewportRef],
  )

  return (
    <div
      className={cn('scroll-container relative min-h-0', className)}
      data-scroll-active={isInteracting ? 'true' : 'false'}
    >
      <div
        ref={setViewportRef}
        className={cn('scroll-container__viewport h-full min-h-0 min-w-0', overflowClassName, viewportClassName)}
        style={viewportMaskStyle}
        {...restViewportProps}
        onScroll={(event) => {
          viewportOnScroll?.(event)
          markInteracting()
          updateEdges()
          scheduleHide()
        }}
        onWheel={(event) => {
          viewportOnWheel?.(event)
          markInteracting()
          scheduleHide()
        }}
        onPointerDown={(event) => {
          viewportOnPointerDown?.(event)
          markInteracting()
          scheduleHide()
        }}
        onPointerMove={(event) => {
          viewportOnPointerMove?.(event)
          markInteracting()
          scheduleHide()
        }}
        onTouchStart={(event) => {
          viewportOnTouchStart?.(event)
          markInteracting()
          scheduleHide()
        }}
        onFocus={(event) => {
          viewportOnFocus?.(event)
          markInteracting()
          scheduleHide()
        }}
        onMouseLeave={(event) => {
          viewportOnMouseLeave?.(event)
          scheduleHide()
        }}
      >
        {children}
      </div>
    </div>
  )
}

function buildViewportMaskStyle(
  axis: ScrollAxis,
  edges: ScrollEdgeState,
): CSSProperties | undefined {
  if (axis === 'horizontal') {
    return buildSingleMaskStyle(buildHorizontalMask(edges.left, edges.right))
  }

  if (axis === 'vertical') {
    return buildSingleMaskStyle(buildVerticalMask(edges.top, edges.bottom))
  }

  const horizontalMask = buildHorizontalMask(edges.left, edges.right)
  const verticalMask = buildVerticalMask(edges.top, edges.bottom)

  return {
    WebkitMaskImage: `${horizontalMask}, ${verticalMask}`,
    maskImage: `${horizontalMask}, ${verticalMask}`,
    WebkitMaskRepeat: 'no-repeat, no-repeat',
    maskRepeat: 'no-repeat, no-repeat',
    WebkitMaskSize: '100% 100%, 100% 100%',
    maskSize: '100% 100%, 100% 100%',
    WebkitMaskComposite: 'source-in',
    maskComposite: 'intersect',
  }
}

function buildSingleMaskStyle(maskImage: string): CSSProperties {
  return {
    WebkitMaskImage: maskImage,
    maskImage,
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskSize: '100% 100%',
    maskSize: '100% 100%',
  }
}

function buildHorizontalMask(left: boolean, right: boolean): string {
  const leftStart = left ? 'transparent 0px' : 'black 0px'
  const leftEnd = `black ${MASK_FADE_PX}px`
  const rightStart = `black calc(100% - ${MASK_FADE_PX}px)`
  const rightEnd = right ? 'transparent 100%' : 'black 100%'

  return `linear-gradient(to right, ${leftStart}, ${leftEnd}, ${rightStart}, ${rightEnd})`
}

function buildVerticalMask(top: boolean, bottom: boolean): string {
  const topStart = top ? 'transparent 0px' : 'black 0px'
  const topEnd = `black ${MASK_FADE_PX}px`
  const bottomStart = `black calc(100% - ${MASK_FADE_PX}px)`
  const bottomEnd = bottom ? 'transparent 100%' : 'black 100%'

  return `linear-gradient(to bottom, ${topStart}, ${topEnd}, ${bottomStart}, ${bottomEnd})`
}
