'use client'

import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import ChainOfThought from './components/ChainOfThought'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8420'

export default function Home() {
  const [codebasePath, setCodebasePath] = useState('')
  const [ingesting, setIngesting] = useState(false)
  const [ingestResult, setIngestResult] = useState('')

  const [feature, setFeature] = useState('')
  const [planning, setPlanning] = useState(false)
  const [plan, setPlan] = useState('')
  const [copied, setCopied] = useState(false)
  const [events, setEvents] = useState<any[]>([])

  const [showBrowser, setShowBrowser] = useState(false)
  const [browsePath, setBrowsePath] = useState('')
  const [browseEntries, setBrowseEntries] = useState<{ name: string; is_dir: boolean; path: string }[]>([])
  const [browseLoading, setBrowseLoading] = useState(false)
  const [browseError, setBrowseError] = useState('')

  async function openBrowser() {
    setBrowseError('')
    setShowBrowser(true)
    const startPath = codebasePath || 'C:\\'
    setBrowsePath(startPath)
    await loadDir(startPath)
  }

  const eventsEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events])

  async function handlePlan() {
    setPlanning(true)
    setPlan('')
    setEvents([])
    try {
      const res = await fetch(`${API}/plan/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature_request: feature, codebase_path: codebasePath }),
      })
      if (!res.ok) {
        setPlan(`Error: ${res.status}`)
        setPlanning(false)
        return
      }
      const reader = res.body?.getReader()
      if (!reader) return
      const decoder = new TextDecoder()
      let buffer = ''
      let fullPlan = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        let eventType = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) eventType = line.slice(7).trim()
          else if (line.startsWith('data: ')) {
            const data = line.slice(6).trim()
            if (eventType === 'plan_chunk') {
              fullPlan += JSON.parse(data)
              setPlan(fullPlan)
            } else if (eventType === 'thought') {
              setEvents(prev => [...prev, { type: 'thought', data: JSON.parse(data) }])
            } else if (eventType === 'chunk') {
              setEvents(prev => [...prev, { type: 'chunk', data: JSON.parse(data) }])
            } else if (eventType === 'tool_call') {
              setEvents(prev => [...prev, { type: 'tool_call', data: JSON.parse(data) }])
            } else if (eventType === 'tool_result') {
              setEvents(prev => [...prev, { type: 'tool_result', data: JSON.parse(data) }])
            } else if (eventType === 'error') {
              setEvents(prev => [...prev, { type: 'error', data: JSON.parse(data) }])
            } else if (eventType === 'done') {
              const parsed = JSON.parse(data)
              if (typeof parsed === 'string' && parsed.trim() !== '') {
                setPlan(parsed)
              }
            }
            eventType = ''
          }
        }
      }
    } catch {
      setPlan('Error: could not reach backend')
    }
    setPlanning(false)
  }

  function handleCopy() {
    navigator.clipboard.writeText(plan)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function loadDir(dirPath: string) {
    setBrowseLoading(true)
    setBrowseError('')
    try {
      const res = await fetch(`${API}/browse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dirPath }),
      })
      const data = await res.json()
      if (res.ok) {
        setBrowseEntries(data.entries)
      } else {
        setBrowseError(data.detail || 'Error loading directory')
      }
    } catch {
      setBrowseError('Could not reach backend')
    }
    setBrowseLoading(false)
  }

  function navigateDir(entryPath: string) {
    setBrowsePath(entryPath)
    loadDir(entryPath)
  }

  function goUp() {
    const parent = browsePath.replace(/[/\\]$/, '').split(/[/\\]/).slice(0, -1).join('\\') || browsePath
    if (parent && parent !== browsePath) {
      setBrowsePath(parent)
      loadDir(parent)
    }
  }

  function selectDir() {
    setCodebasePath(browsePath)
    setShowBrowser(false)
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <header className="border-b border-neutral-800 pb-5 mb-8 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
              Codebase Feature Planner
            </span>
            <span className="text-[10px] uppercase tracking-wider font-extrabold px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-400 border border-indigo-900/60">
              v1.0.0
            </span>
          </div>
          <p className="text-xs text-neutral-500 mt-1">
            Leverage AI RAG agents to build precise implementation plans for your codebase.
          </p>
        </div>
      </header>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left Column: Workspace Configuration & Indexing */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-neutral-900/50 border border-neutral-800 rounded-xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center gap-2 border-b border-neutral-800 pb-2">
              <svg className="w-4 h-4 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
                Workspace Setup
              </h3>
            </div>
            
            <div className="space-y-2">
              <label className="text-[10px] uppercase font-bold text-neutral-500 tracking-wider">Codebase Directory</label>
              <div className="flex gap-1.5">
                <input
                  className="flex-1 min-w-0 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs outline-none focus:border-neutral-700 font-mono text-neutral-300 placeholder-neutral-600 transition-colors duration-150"
                  placeholder="e.g. C:\Users\me\project"
                  value={codebasePath}
                  onChange={(e) => setCodebasePath(e.target.value)}
                />
                <button
                  className="bg-neutral-800 text-neutral-300 hover:bg-neutral-700 border border-neutral-700/60 px-3 py-2 rounded-lg text-xs font-medium transition-colors duration-150 active:scale-95"
                  onClick={openBrowser}
                >
                  Browse
                </button>
              </div>
            </div>

            <div className="border-t border-neutral-800/80 pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold text-neutral-500 tracking-wider">Index Status</span>
                {ingestResult ? (
                  <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded border uppercase tracking-wider ${
                    ingestResult.startsWith('Error') 
                      ? 'bg-red-950/60 text-red-400 border-red-900/50' 
                      : 'bg-emerald-950/60 text-emerald-400 border-emerald-900/50'
                  }`}>
                    {ingestResult.startsWith('Error') ? 'Error' : 'Ready'}
                  </span>
                ) : (
                  <span className="text-[9px] font-extrabold bg-neutral-950 text-neutral-500 border border-neutral-800 rounded px-2 py-0.5 uppercase tracking-wider">
                    Unindexed
                  </span>
                )}
              </div>

              <button
                className="w-full bg-neutral-200 text-neutral-900 py-2 rounded-lg text-xs font-semibold hover:bg-neutral-300 disabled:opacity-40 transition-all flex items-center justify-center gap-1.5 active:scale-98"
                onClick={() => {
                  setIngesting(true)
                  setIngestResult('')
                  fetch(`${API}/ingest`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: codebasePath }),
                  }).then(r => r.json()).then(data => {
                    setIngestResult(data.status === 'ok' ? `Indexed ${data.chunks_indexed} chunks` : `Error: ${data.detail}`)
                  }).catch(() => setIngestResult('Error: could not reach backend'))
                  .finally(() => setIngesting(false))
                }}
                disabled={!codebasePath || ingesting}
              >
                {ingesting ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Ingesting...</span>
                  </>
                ) : (
                  <span>Index Codebase</span>
                )}
              </button>

              {ingestResult && (
                <p className={`text-xs px-2.5 py-2 rounded-lg border font-mono ${
                  ingestResult.startsWith('Error') 
                    ? 'bg-red-950/20 text-red-400 border-red-900/30' 
                    : 'bg-emerald-950/20 text-emerald-400 border-emerald-900/30'
                } mt-2`}>
                  {ingestResult}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Planner, Timeline & Implementation Output */}
        <div className="lg:col-span-8 space-y-6">
          {/* Prompt Section */}
          <div className="bg-neutral-900/50 border border-neutral-800 rounded-xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center gap-2 border-b border-neutral-800 pb-2">
              <svg className="w-4 h-4 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
                Design Plan Builder
              </h3>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] uppercase font-bold text-neutral-500 tracking-wider">Describe Feature</label>
              <textarea
                className="w-full h-28 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs outline-none focus:border-neutral-700 resize-none font-sans leading-relaxed text-neutral-250 placeholder-neutral-600 transition-colors"
                placeholder="Explain what feature you want to add or build. The agent will retrieve codebase contexts and generate a step-by-step design..."
                value={feature}
                onChange={(e) => setFeature(e.target.value)}
              />
            </div>

            <button
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-lg text-xs font-semibold disabled:opacity-40 transition-all flex items-center gap-2 active:scale-98 shadow-md"
              onClick={handlePlan}
              disabled={!feature || !codebasePath || planning}
            >
              {planning ? (
                <>
                  <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Generating Implementation Plan...</span>
                </>
              ) : (
                <span>Generate Implementation Plan</span>
              )}
            </button>
          </div>

          {/* Chain of thought timeline component */}
          <ChainOfThought events={events} planning={planning} />

          {/* Final Plan Markdown */}
          {plan && (
            <div className="bg-neutral-900/50 border border-neutral-800 rounded-xl p-5 space-y-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-350">
                    Implementation Plan
                  </h3>
                </div>
                <button
                  className="text-[10px] font-semibold text-indigo-400 hover:text-indigo-300 bg-indigo-950/60 hover:bg-indigo-900/80 border border-indigo-900/60 rounded px-2.5 py-1.5 transition-all"
                  onClick={handleCopy}
                >
                  {copied ? 'Copied!' : 'Copy Plan'}
                </button>
              </div>
              
              {/* Styled ReactMarkdown */}
              <div className="select-text text-xs leading-relaxed text-neutral-300 space-y-4">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({node, ...props}) => <h1 className="text-sm font-bold mt-5 mb-2 text-white border-b border-neutral-800 pb-1" {...props} />,
                    h2: ({node, ...props}) => <h2 className="text-xs font-bold mt-4 mb-2 text-white border-b border-neutral-850 pb-0.5" {...props} />,
                    h3: ({node, ...props}) => <h3 className="text-[11px] font-semibold mt-3.5 mb-1 text-white uppercase tracking-wider text-neutral-400" {...props} />,
                    p: ({node, ...props}) => <p className="mb-2.5 text-neutral-300 leading-relaxed font-sans" {...props} />,
                    ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-2.5 space-y-1 text-neutral-300 font-sans" {...props} />,
                    ol: ({node, ...props}) => <ol className="list-decimal pl-5 mb-2.5 space-y-1 text-neutral-300 font-sans" {...props} />,
                    li: ({node, ...props}) => <li className="mb-0.5" {...props} />,
                    code: ({node, className, children, ...props}) => {
                      const match = /language-(\w+)/.exec(className || '')
                      return match ? (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      ) : (
                        <code className="bg-neutral-950 text-indigo-405 border border-neutral-850 rounded px-1.5 py-0.5 font-mono text-[10px]" {...props}>
                          {children}
                        </code>
                      )
                    },
                    pre: ({node, children, ...props}) => (
                      <pre className="bg-neutral-950 border border-neutral-800 rounded-lg p-3 my-2.5 overflow-x-auto font-mono text-[10px] text-neutral-300" {...props}>
                        {children}
                      </pre>
                    ),
                    a: ({node, ...props}) => <a className="text-indigo-400 hover:underline" {...props} />,
                  }}
                >
                  {plan}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Directory Browser Modal */}
      {showBrowser && (
        <div className="fixed inset-0 bg-black/60 flex items-start justify-center pt-24 z-50 animate-fade-in">
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl w-full max-w-md p-4 shadow-2xl">
            <div className="flex items-center gap-2 mb-3 border-b border-neutral-800 pb-2">
              <button className="text-neutral-400 hover:text-neutral-200 text-xs bg-neutral-800 px-2 py-0.5 rounded" onClick={goUp}>↑ Up</button>
              <span className="text-xs text-neutral-400 truncate flex-1 font-mono">{browsePath}</span>
              <button className="text-neutral-500 hover:text-neutral-300 text-xs" onClick={() => setShowBrowser(false)}>✕</button>
            </div>
            
            <div className="max-h-60 overflow-y-auto space-y-0.5 mb-4 pr-1">
              {browseLoading && <p className="text-xs text-neutral-500">Loading directory...</p>}
              {browseError && <p className="text-xs text-red-400">{browseError}</p>}
              {!browseLoading && !browseError && browseEntries.length === 0 && (
                <p className="text-xs text-neutral-500 italic p-2">(empty directory)</p>
              )}
              {browseEntries.map((entry) => (
                <div
                  key={entry.path}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-neutral-850 text-xs text-neutral-350 transition-colors"
                  onClick={() => navigateDir(entry.path)}
                >
                  <span className="text-neutral-500 text-[10px]">📁</span>
                  <span className="font-mono">{entry.name}/</span>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 border-t border-neutral-850 pt-3">
              <button className="px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200 transition-colors" onClick={() => setShowBrowser(false)}>Cancel</button>
              <button className="px-4 py-1.5 text-xs bg-neutral-250 text-neutral-900 rounded-lg font-semibold hover:bg-neutral-300 transition-colors" onClick={selectDir}>Select Folder</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
