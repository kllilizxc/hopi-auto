import { memo } from 'react'
import Markdown, {
  type Components as MarkdownComponents,
  type UrlTransform,
} from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AppLink } from './ui'

const ASSISTANT_MARKDOWN_PLUGINS = [remarkGfm]

const ASSISTANT_MARKDOWN_COMPONENTS = {
  a({ children, href }) {
    if (!href || !isSafeAssistantLink(href)) return <>{children}</>
    return (
      <AppLink
        className="assistant-message-link"
        href={href}
        target="_blank"
        rel="noreferrer"
      >
        {children}
      </AppLink>
    )
  },
} satisfies MarkdownComponents

const assistantMarkdownUrlTransform: UrlTransform = (url, key) => {
  if (key !== 'href' || !isSafeAssistantLink(url)) return ''
  return url
}

export const AssistantMarkdown = memo(function AssistantMarkdown({ text }: { text: string }) {
  return (
    <Markdown
      components={ASSISTANT_MARKDOWN_COMPONENTS}
      disallowedElements={['img']}
      remarkPlugins={ASSISTANT_MARKDOWN_PLUGINS}
      skipHtml
      unwrapDisallowed
      urlTransform={assistantMarkdownUrlTransform}
    >
      {text}
    </Markdown>
  )
})

function isSafeAssistantLink(href: string) {
  if (href.startsWith('/api/') || href.startsWith('/projects/')) return true
  try {
    const protocol = new URL(href).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
