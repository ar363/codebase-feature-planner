'use client'

import { useState } from 'react'

interface RawEvent {
  type: string
  data: any
}

interface Step {
  id: string
  type: 'system' | 'reasoning' | 'tool' | 'error'
  title: string
  content?: string
  toolName?: string
  toolArgs?: any
  toolResult?: string
  isActive?: boolean
}

interface ChainOfThoughtProps {
  events: RawEvent[]
  planning: boolean
}

export default function ChainOfThought({ events, planning }: ChainOfThoughtProps) {
  const [expandedResults, setExpandedResults] = useState<Record<string, boolean>>({})

  // Process raw events into structured timeline steps
  const steps: Step[] = []
  let activeReasoning = ''

  events.forEach((ev, idx) => {
    if (ev.type === 'chunk') {
      activeReasoning += ev.data
    } else {
      // Flush previous reasoning block if any
      if (activeReasoning) {
        steps.push({
          id: `reasoning-${idx}`,
          type: 'reasoning',
          title: 'Agent Reasoning',
          content: activeReasoning,
        })
        activeReasoning = ''
      }

      if (ev.type === 'thought') {
        steps.push({
          id: `thought-${idx}`,
          type: 'system',
          title: ev.data,
        })
      } else if (ev.type === 'tool_call') {
        steps.push({
          id: `tool-${idx}`,
          type: 'tool',
          title: `Running Tool: ${ev.data.name}`,
          toolName: ev.data.name,
          toolArgs: ev.data.arguments,
          isActive: true, // will be set to false if a result comes in
        })
      } else if (ev.type === 'tool_result') {
        // Find the last tool step that matches this tool name and doesn't have a result yet
        const lastToolStep = [...steps]
          .reverse()
          .find((s) => s.type === 'tool' && s.toolName === ev.data.name && !s.toolResult)

        if (lastToolStep) {
          lastToolStep.toolResult = ev.data.result
          lastToolStep.isActive = false
        } else {
          steps.push({
            id: `tool-result-${idx}`,
            type: 'tool',
            title: `Tool Output: ${ev.data.name}`,
            toolName: ev.data.name,
            toolResult: ev.data.result,
          })
        }
      } else if (ev.type === 'error') {
        steps.push({
          id: `error-${idx}`,
          type: 'error',
          title: 'Error Encountered',
          content: ev.data,
        })
      }
    }
  })

  // Flush any final reasoning
  if (activeReasoning) {
    steps.push({
      id: 'reasoning-final',
      type: 'reasoning',
      title: 'Agent Reasoning',
      content: activeReasoning,
    })
  }

  // If we are planning, the last step is active
  if (planning && steps.length > 0) {
    steps[steps.length - 1].isActive = true
  }

  const toggleExpand = (id: string) => {
    setExpandedResults((prev) => ({
      ...prev,
      [id]: !prev[id],
    }))
  }

  if (events.length === 0 && !planning) return null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-neutral-850 pb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Agent Execution Logs
        </h3>
        {planning && (
          <div className="flex items-center gap-2 text-xs text-indigo-400">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
            </span>
            <span>Agent thinking...</span>
          </div>
        )}
      </div>

      <div className="relative pl-6 border-l border-neutral-800/80 space-y-5 ml-2 py-2">
        {steps.map((step) => {
          const isExpanded = !!expandedResults[step.id]

          return (
            <div key={step.id} className="relative group">
              {/* Timeline Icon */}
              <div
                className={`absolute -left-[31px] top-1.5 flex h-6 w-6 items-center justify-center rounded-full border bg-neutral-950 transition-all duration-300 ${
                  step.isActive
                    ? 'border-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)] scale-110'
                    : step.type === 'error'
                    ? 'border-red-800 text-red-500'
                    : step.type === 'tool'
                    ? 'border-amber-700 text-amber-500'
                    : step.type === 'reasoning'
                    ? 'border-blue-700 text-blue-400'
                    : 'border-neutral-850 text-neutral-500'
                }`}
              >
                {step.isActive ? (
                  <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : step.type === 'error' ? (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                ) : step.type === 'tool' ? (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                  </svg>
                ) : step.type === 'reasoning' ? (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1 0-3.12 3 3 0 0 1 0-4.88 2.5 2.5 0 0 1 0-3.12A2.5 2.5 0 0 1 9.5 2z" />
                    <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 0-3.12 3 3 0 0 0 0-4.88 2.5 2.5 0 0 0 0-3.12A2.5 2.5 0 0 0 14.5 2z" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                )}
              </div>

              {/* Step Card Content */}
              <div className="bg-neutral-900/60 hover:bg-neutral-900 border border-neutral-800/80 rounded-lg p-3 transition-colors duration-200">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h4
                      className={`text-xs font-semibold ${
                        step.type === 'error'
                          ? 'text-red-400'
                          : step.type === 'tool'
                          ? 'text-amber-300'
                          : step.type === 'reasoning'
                          ? 'text-blue-350'
                          : 'text-neutral-300'
                      }`}
                    >
                      {step.title}
                    </h4>

                    {/* Tool Arguments */}
                    {step.toolArgs && (
                      <div className="mt-1 flex flex-wrap gap-1 items-center">
                        <span className="text-[9px] uppercase font-bold text-neutral-500">Params:</span>
                        {Object.entries(step.toolArgs).map(([key, val]) => (
                          <code key={key} className="text-[10px] bg-neutral-950 text-neutral-400 border border-neutral-850 rounded px-1 py-0.5 font-mono truncate max-w-[200px]" title={`${key}: ${JSON.stringify(val)}`}>
                            {key}: <span className="text-amber-400/90">{JSON.stringify(val)}</span>
                          </code>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Actions (e.g. toggle expand for tool result) */}
                  {step.type === 'tool' && step.toolResult && (
                    <button
                      onClick={() => toggleExpand(step.id)}
                      className="flex items-center gap-1 text-[10px] text-neutral-400 hover:text-neutral-200 bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 rounded px-2 py-0.5 transition-all"
                    >
                      <span>{isExpanded ? 'Hide' : 'Show Output'}</span>
                      <svg
                        className={`w-2.5 h-2.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Step Body (Content or Tool Results) */}
                {step.content && (
                  <div className="mt-2 text-xs text-neutral-300 leading-relaxed font-sans whitespace-pre-wrap">
                    {step.content}
                  </div>
                )}

                {/* Expandable Tool Result console window */}
                {step.type === 'tool' && isExpanded && step.toolResult && (
                  <div className="mt-2.5 border border-neutral-800 rounded overflow-hidden bg-neutral-950">
                    {/* Console Header */}
                    <div className="flex items-center justify-between px-2.5 py-1 border-b border-neutral-800 bg-neutral-900/80">
                      <span className="text-[9px] font-mono font-bold text-neutral-400 flex items-center gap-1">
                        <span className="w-1 h-1 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
                        CONSOLE: {step.toolName}
                      </span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(step.toolResult || '')
                        }}
                        className="text-[9px] text-neutral-500 hover:text-neutral-300 transition-colors font-mono"
                      >
                        COPY
                      </button>
                    </div>
                    {/* Console Body */}
                    <pre className="p-2.5 text-[10px] text-neutral-300 font-mono overflow-x-auto max-h-60 overflow-y-auto whitespace-pre leading-relaxed select-text">
                      {step.toolResult}
                    </pre>
                  </div>
                )}

                {/* Tool is running status placeholder */}
                {step.type === 'tool' && step.isActive && (
                  <div className="mt-1.5 text-[10px] italic text-neutral-500 flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-amber-500 inline-block animate-ping"></span>
                    Executing tool commands and gathering output...
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
