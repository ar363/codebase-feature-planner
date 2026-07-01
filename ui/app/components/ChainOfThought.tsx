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
          title: 'Agent reasoning analysis',
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
          title: `Invoked action: ${ev.data.name}`,
          toolName: ev.data.name,
          toolArgs: ev.data.arguments,
          isActive: true, // will be set to false if a result comes in
        })
      } else if (ev.type === 'tool_result') {
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
            title: `Action response: ${ev.data.name}`,
            toolName: ev.data.name,
            toolResult: ev.data.result,
          })
        }
      } else if (ev.type === 'error') {
        steps.push({
          id: `error-${idx}`,
          type: 'error',
          title: 'Error encountered',
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
      title: 'Agent reasoning analysis',
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
    <div className="bg-[#0b0c13]/60 border border-slate-800/40 rounded-xl p-5 space-y-4 shadow-md">
      <div className="flex items-center justify-between border-b border-slate-800/40 pb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 font-display flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
          Agent Execution Logs
        </h3>
        {planning && (
          <div className="flex items-center gap-2 text-xs text-indigo-400 font-medium">
            <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span>Reasoning...</span>
          </div>
        )}
      </div>

      <div className="relative pl-6 border-l border-slate-800/60 space-y-5 ml-2.5 py-1">
        {steps.map((step) => {
          const isExpanded = !!expandedResults[step.id]

          return (
            <div key={step.id} className="relative group">
              {/* Timeline Icon */}
              <div
                className={`absolute -left-[35px] top-1.5 flex h-6 w-6 items-center justify-center rounded-full border bg-[#07080c] transition-all duration-300 ${
                  step.isActive
                    ? 'border-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.4)] scale-105'
                    : step.type === 'error'
                    ? 'border-red-900 text-red-400 bg-red-950/20'
                    : step.type === 'tool'
                    ? 'border-amber-700/80 text-amber-500 bg-amber-950/10'
                    : step.type === 'reasoning'
                    ? 'border-blue-800/80 text-blue-400 bg-blue-950/10'
                    : 'border-slate-800 text-slate-500'
                }`}
              >
                {step.isActive ? (
                  <svg className="animate-spin h-3 w-3 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : step.type === 'error' ? (
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                ) : step.type === 'tool' ? (
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                  </svg>
                ) : step.type === 'reasoning' ? (
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                    <line x1="12" y1="22.08" x2="12" y2="12" />
                  </svg>
                ) : (
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                )}
              </div>

              {/* Step Card Content */}
              <div className="bg-[#0f111a]/40 hover:bg-[#0f111a]/85 border border-slate-800/40 rounded-lg p-3.5 transition-colors duration-200 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h4
                      className={`text-xs font-semibold font-display tracking-wide ${
                        step.type === 'error'
                          ? 'text-red-400'
                          : step.type === 'tool'
                          ? 'text-amber-300'
                          : step.type === 'reasoning'
                          ? 'text-blue-300'
                          : 'text-slate-300'
                      }`}
                    >
                      {step.title}
                    </h4>

                    {/* Tool Arguments */}
                    {step.toolArgs && (
                      <div className="mt-1.5 flex flex-wrap gap-1 items-center">
                        <span className="text-[9px] uppercase font-bold text-slate-500 tracking-wider">Params:</span>
                        {Object.entries(step.toolArgs).map(([key, val]) => (
                          <code key={key} className="text-[10px] bg-[#07080c] text-slate-400 border border-slate-800/60 rounded px-1.5 py-0.5 font-mono truncate max-w-[200px]" title={`${key}: ${JSON.stringify(val)}`}>
                            {key}: <span className="text-amber-450">{JSON.stringify(val)}</span>
                          </code>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Actions (e.g. toggle expand for tool result) */}
                  {step.type === 'tool' && step.toolResult && (
                    <button
                      onClick={() => toggleExpand(step.id)}
                      className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-white bg-slate-900 border border-slate-800 rounded px-2.5 py-1 transition-all"
                    >
                      <span>{isExpanded ? 'Hide Output' : 'View Output'}</span>
                      <svg
                        className={`w-3 h-3 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
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
                  <div className="mt-2 text-xs text-slate-350 leading-relaxed font-sans whitespace-pre-wrap">
                    {step.content}
                  </div>
                )}

                {/* Expandable Tool Result console window */}
                {step.type === 'tool' && isExpanded && step.toolResult && (
                  <div className="mt-2.5 border border-slate-800/60 rounded-lg overflow-hidden bg-[#050609] shadow-inner">
                    {/* Console Header */}
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800/60 bg-[#08090d]">
                      <span className="text-[9px] font-mono font-bold text-slate-450 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
                        TERMINAL: {step.toolName}
                      </span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(step.toolResult || '')
                        }}
                        className="text-[9px] text-indigo-400 hover:text-indigo-300 transition-colors font-mono"
                      >
                        COPY OUTPUT
                      </button>
                    </div>
                    {/* Console Body */}
                    <pre className="p-3 text-[10px] text-slate-300 font-mono overflow-x-auto max-h-60 overflow-y-auto whitespace-pre leading-relaxed select-text">
                      {step.toolResult}
                    </pre>
                  </div>
                )}

                {/* Tool is running status placeholder */}
                {step.type === 'tool' && step.isActive && (
                  <div className="mt-1.5 text-[10px] italic text-slate-500 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block animate-ping"></span>
                    Executing workspace command and harvesting response...
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
