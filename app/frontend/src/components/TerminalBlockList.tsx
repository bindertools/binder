import { useState, type ReactNode } from 'react'
import { ansiToLines, ansiSegmentStyle } from '../lib/ansi'
import type { CommandBlock } from '../lib/terminalBlocks'

interface Props {
  blocks: CommandBlock[]
  inputRow?: ReactNode
}

const MAX_LINES = 25

export default function TerminalBlockList({ blocks, inputRow }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="term-blocks">
      {blocks.map(block => {
        const lines = ansiToLines(block.outputRaw)
        // Drop a single trailing empty line (the \r\n emitted before the next prompt).
        while (lines.length && lines[lines.length - 1].length === 0) lines.pop()

        const isExpanded = expanded.has(block.id)
        const visibleLines = isExpanded ? lines : lines.slice(0, MAX_LINES)
        const hiddenCount = lines.length - visibleLines.length

        return (
          <div key={block.id} className="term-block">
            <div className="term-block-header">
              <span className={`term-dot term-dot--${block.status}`} />
              {block.branch && <span className="term-branch-tag">({block.branch})</span>}
              <span className="term-cwd">{block.cwd}</span>
              <span className="term-arrow">{'❯'}</span>
              <span className="term-command">{block.command}</span>
              {block.ts && <span className="term-ts">{block.ts}</span>}
            </div>

            {visibleLines.length > 0 && (
              <div className="term-output">
                {visibleLines.map((segs, idx) => (
                  <div className="term-output-line" key={idx}>
                    <span className="term-output-glyph">{idx === 0 ? '└' : ''}</span>
                    <span className="term-output-text">
                      {segs.map((seg, si) => (
                        <span key={si} style={ansiSegmentStyle(seg)}>{seg.text}</span>
                      ))}
                    </span>
                  </div>
                ))}

                {hiddenCount > 0 && (
                  <div
                    className="term-output-line term-output-more"
                    onClick={() => toggleExpanded(block.id)}
                  >
                    <span className="term-output-glyph" />
                    <span className="term-output-text">{`… +${hiddenCount} lines (click to expand)`}</span>
                  </div>
                )}

                {isExpanded && lines.length > MAX_LINES && (
                  <div
                    className="term-output-line term-output-more"
                    onClick={() => toggleExpanded(block.id)}
                  >
                    <span className="term-output-glyph" />
                    <span className="term-output-text">(click to collapse)</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
      {inputRow}
    </div>
  )
}
