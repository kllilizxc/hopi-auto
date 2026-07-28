import { Brain, ChevronDown, ChevronRight } from 'lucide-react'
import { memo, useState } from 'react'
import Markdown, { type Components as MarkdownComponents, type UrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AppLink } from './ui'

const ASSISTANT_MARKDOWN_PLUGINS = [remarkGfm]

const ASSISTANT_MARKDOWN_COMPONENTS = {
  a({ children, href }) {
    if (!href || !isSafeAssistantLink(href)) return <>{children}</>
    return (
      <AppLink className="assistant-message-link" href={href} target="_blank" rel="noreferrer">
        {children}
      </AppLink>
    )
  },
} satisfies MarkdownComponents

const assistantMarkdownUrlTransform: UrlTransform = (url, key) => {
  if (key !== 'href' || !isSafeAssistantLink(url)) return ''
  return url
}

const MarkdownRenderer = memo(function MarkdownRenderer({ text }: { text: string }) {
  if (!text.trim()) return null
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

function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className={`assistant-thinking ${expanded ? 'expanded' : ''}`}>
      <button
        className="assistant-thinking__toggle"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Brain size={14} className="assistant-thinking__icon" />
        <span>Thinking Process</span>
      </button>
      {expanded && (
        <div className="assistant-thinking__content">
          <MarkdownRenderer text={content} />
        </div>
      )}
    </div>
  )
}

export const AssistantMarkdown = memo(function AssistantMarkdown({ text }: { text: string }) {
  const visibleText = text
  const chunks: Array<{ type: 'text' | 'thinking'; content: string; key: string }> = []
  const thinkingRegex = /<thinking>([\s\S]*?)(?:<\/thinking>|$)/gi
  let lastIndex = 0
  let match = thinkingRegex.exec(visibleText)

  while (match !== null) {
    if (match.index > lastIndex) {
      chunks.push({
        type: 'text',
        content: visibleText.substring(lastIndex, match.index),
        key: `text:${lastIndex}`,
      })
    }
    chunks.push({
      type: 'thinking',
      content: match[1] ?? '',
      key: `thinking:${match.index}`,
    })
    lastIndex = thinkingRegex.lastIndex
    match = thinkingRegex.exec(visibleText)
  }
  if (lastIndex < visibleText.length) {
    chunks.push({
      type: 'text',
      content: visibleText.substring(lastIndex),
      key: `text:${lastIndex}`,
    })
  }

  if (chunks.length <= 1 && chunks[0]?.type === 'text') {
    return <MarkdownRenderer text={visibleText} />
  }

  return (
    <div className="assistant-markdown-chunks">
      {chunks.map((chunk) =>
        chunk.type === 'thinking' ? (
          <ThinkingBlock key={chunk.key} content={chunk.content} />
        ) : (
          <MarkdownRenderer key={chunk.key} text={chunk.content} />
        ),
      )}
    </div>
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
