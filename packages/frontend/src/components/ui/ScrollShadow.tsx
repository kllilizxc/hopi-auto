import {
  ScrollShadow,
  type ScrollShadowProps as HeroScrollShadowProps,
} from '@heroui/react/scroll-shadow'
import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { cn } from '../../lib/utils'

export type AppScrollShadowOrientation = HeroScrollShadowProps['orientation'] | 'auto'

export interface AppScrollShadowProps
  extends Omit<HeroScrollShadowProps, 'className' | 'orientation' | 'ref'> {
  className?: string
  orientation?: AppScrollShadowOrientation
}

export const AppScrollShadow = forwardRef<HTMLDivElement, AppScrollShadowProps>(
  function AppScrollShadow(
    { className, orientation = 'vertical', size = 22, style, ...props },
    forwardedRef,
  ) {
    const elementRef = useRef<HTMLDivElement | null>(null)
    const [automaticOrientation, setAutomaticOrientation] = useState<
      HeroScrollShadowProps['orientation']
    >('vertical')
    const resolvedOrientation =
      orientation === 'auto' ? automaticOrientation : orientation
    const setRef = useCallback(
      (element: HTMLDivElement | null) => {
        elementRef.current = element
        if (typeof forwardedRef === 'function') forwardedRef(element)
        else if (forwardedRef) forwardedRef.current = element
      },
      [forwardedRef],
    )

    useLayoutEffect(() => {
      const element = elementRef.current
      if (!element) return

      let animationFrame = 0
      const refresh = () => {
        animationFrame = 0
        if (orientation === 'auto') {
          const verticalOverflow = element.scrollHeight - element.clientHeight > 1
          const horizontalOverflow = element.scrollWidth - element.clientWidth > 1
          setAutomaticOrientation(
            horizontalOverflow && !verticalOverflow ? 'horizontal' : 'vertical',
          )
        }

        // HeroUI owns visibility detection and mask-image state. A native scroll
        // notification lets it re-check when asynchronous children change the
        // scroll extent without resizing the viewport itself.
        element.dispatchEvent(new Event('scroll'))
      }
      const scheduleRefresh = () => {
        if (!animationFrame) animationFrame = requestAnimationFrame(refresh)
      }

      scheduleRefresh()
      element.addEventListener('load', scheduleRefresh, true)
      const mutationObserver = element.hasAttribute('data-virtuoso-scroller')
        ? null
        : new MutationObserver(scheduleRefresh)
      mutationObserver?.observe(element, {
        childList: true,
        characterData: true,
        subtree: true,
      })
      const resizeObserver = new ResizeObserver(scheduleRefresh)
      resizeObserver.observe(element)

      return () => {
        if (animationFrame) cancelAnimationFrame(animationFrame)
        mutationObserver?.disconnect()
        resizeObserver.disconnect()
        element.removeEventListener('load', scheduleRefresh, true)
      }
    }, [orientation])

    return (
      <ScrollShadow
        ref={setRef}
        className={cn('app-scroll-shadow', className)}
        orientation={resolvedOrientation}
        size={size}
        style={{ '--scroll-shadow-size': `${size}px`, ...style } as CSSProperties}
        {...props}
      />
    )
  },
)
