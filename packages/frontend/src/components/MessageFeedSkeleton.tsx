import { cn } from '../lib/utils'

export function MessageFeedSkeleton({
  density = 'comfortable',
}: {
  density?: 'comfortable' | 'compact'
}) {
  return (
    <div
      className={cn('message-feed-skeleton', `message-feed-skeleton--${density}`)}
      role="status"
      aria-label="Loading messages"
    >
      <div className="message-feed-skeleton__row assistant" aria-hidden="true">
        <span className="message-feed-skeleton__meta" />
        <span className="message-feed-skeleton__line wide" />
        <span className="message-feed-skeleton__line medium" />
      </div>
      <div className="message-feed-skeleton__row user" aria-hidden="true">
        <span className="message-feed-skeleton__line medium" />
        <span className="message-feed-skeleton__line short" />
      </div>
      <div className="message-feed-skeleton__row assistant compact" aria-hidden="true">
        <span className="message-feed-skeleton__meta" />
        <span className="message-feed-skeleton__line wide" />
      </div>
    </div>
  )
}
