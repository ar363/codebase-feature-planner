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

  // History state
  const [history, setHistory] = useState<{ workspaces: string[]; plans: any[] }>({ workspaces: [], plans: [] })
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  
  // Custom manual workspace input state
  const [newWorkspacePath, setNewWorkspacePath] = useState('')
  const [showAddWorkspaceInput, setShowAddWorkspaceInput] = useState(false)

  const abortRef = useRef<AbortController | null>(null)

  // Fetch past workspaces and plans
  async function fetchHistory() {
    try {
      const res = await fetch(`${API}/history`)
      if (res.ok) {
        const data = await res.json()
        setHistory(data)
      }
    } catch (e) {
      console.error("Failed to load history", e)
    }
  }

  useEffect(() => {
    fetchHistory()
  }, [])

  // Shorten C:\Users\<username> to ~ for display
  function tildePath(p: string) {
    if (!p) return p
    return p.replace(/^[A-Za-z]:[/\\][Uu]sers[/\\][^/\\]+/, '~')
             .replace(/^\/(?:home|Users)\/[^/]+/, '~')
  }

  // Derive the home folder from an absolute path
  function getHomeFromPath(p: string): string | null {
    const m = p.match(/^([A-Za-z]:[/\\][Uu]sers[/\\][^/\\]+)/)
    if (m) return m[1]
    const m2 = p.match(/^(\/(?:home|Users)\/[^/]+)/)
    if (m2) return m2[1]
    return null
  }

  async function openBrowser() {
    setBrowseError('')
    setShowBrowser(true)
    // Open at current workspace, else try to derive home from it, else fallback
    const startPath = codebasePath
      || (history.workspaces.length > 0 ? getHomeFromPath(history.workspaces[0]) ?? 'C:\\' : 'C:\\')
    setBrowsePath(startPath)
    await loadDir(startPath)
  }

  const eventsEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events])

  // Abort in-flight plan request on unmount
  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  async function handlePlan() {
    if (!feature || !codebasePath) return

    // Cancel any in-flight plan request
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setPlanning(true)
    setPlan('')
    setEvents([])
    setSelectedPlanId(null)
    try {
      const res = await fetch(`${API}/plan/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature_request: feature, codebase_path: codebasePath }),
        signal: controller.signal,
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
      // Reload history to capture newly completed plan
      fetchHistory()
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        // Request was cancelled by user, ignore
      } else {
        setPlan('Error: could not reach backend')
      }
    }
    setPlanning(false)
  }

  async function handleSelectPlan(planId: string) {
    try {
      const res = await fetch(`${API}/history/plan/${planId}`)
      if (res.ok) {
        const data = await res.json()
        setSelectedPlanId(planId)
        setCodebasePath(data.codebase_path)
        setFeature(data.feature_request)
        setPlan(data.plan)
        setEvents(data.events)
        setIngestResult('')
      }
    } catch (e) {
      console.error("Failed to load plan details", e)
    }
  }

  async function handleDeletePlan(e: React.MouseEvent, planId: string) {
    e.stopPropagation()
    if (!confirm("Are you sure you want to delete this plan log?")) return
    try {
      const res = await fetch(`${API}/history/plan/${planId}`, { method: 'DELETE' })
      if (res.ok) {
        if (selectedPlanId === planId) {
          setSelectedPlanId(null)
          setPlan('')
          setEvents([])
          setFeature('')
        }
        fetchHistory()
      }
    } catch (e) {
      console.error("Failed to delete plan", e)
    }
  }

  async function handleDeleteWorkspace(e: React.MouseEvent, path: string) {
    e.stopPropagation()
    if (!confirm(`Are you sure you want to remove workspace "${path}" from history?`)) return
    try {
      const res = await fetch(`${API}/history/workspace?path=${encodeURIComponent(path)}`, { method: 'DELETE' })
      if (res.ok) {
        if (codebasePath === path) {
          setCodebasePath('')
        }
        fetchHistory()
      }
    } catch (e) {
      console.error("Failed to delete workspace", e)
    }
  }

  async function handleAddWorkspace(e: React.FormEvent) {
    e.preventDefault()
    if (!newWorkspacePath.trim()) return
    try {
      const res = await fetch(`${API}/history/workspace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newWorkspacePath }),
      })
      if (res.ok) {
        setCodebasePath(newWorkspacePath)
        setNewWorkspacePath('')
        setShowAddWorkspaceInput(false)
        fetchHistory()
      }
    } catch (e) {
      console.error("Failed to add workspace", e)
    }
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
    // Register workspace in backend history
    fetch(`${API}/history/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: browsePath }),
    }).then(() => fetchHistory())
  }

  function getFolderBasename(path: string) {
    if (!path) return ''
    const parts = path.split(/[/\\]/)
    return parts[parts.length - 1] || path
  }

  function formatDate(isoString: string) {
    try {
      const date = new Date(isoString)
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch {
      return isoString
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#07080c] text-slate-100 font-sans bg-[radial-gradient(ellipse_at_top,_rgba(99,102,241,0.05),_transparent_60%)]">
      
      {/* SIDEBAR */}
      <aside className="w-80 border-r border-slate-800/40 bg-[#0b0c11] flex flex-col justify-between flex-shrink-0 z-30 select-none">
        
        {/* Sidebar Header */}
        <div className="p-5 border-b border-slate-800/40">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <h1 className="text-sm font-semibold tracking-tight text-white font-display">
              Feature Planner
            </h1>
          </div>
        </div>

        {/* Sidebar Navigation Areas */}
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-7">
          
          {/* Workspaces Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-[10px] uppercase font-bold tracking-wider text-slate-500 flex items-center gap-1.5">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z" />
                </svg>
                Workspaces
              </h2>
              <button 
                onClick={() => setShowAddWorkspaceInput(!showAddWorkspaceInput)}
                className="text-[10px] text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-0.5"
              >
                <span>+ Add</span>
              </button>
            </div>

            {showAddWorkspaceInput && (
              <form onSubmit={handleAddWorkspace} className="space-y-1.5 px-1 animate-fade-in">
                <input
                  type="text"
                  placeholder="Absolute folder path..."
                  className="w-full bg-[#07080c] border border-slate-800 rounded-md px-2.5 py-1 text-[11px] outline-none text-slate-300 placeholder-slate-600 focus:border-indigo-500/80 transition-colors"
                  value={newWorkspacePath}
                  onChange={(e) => setNewWorkspacePath(e.target.value)}
                />
                <div className="flex justify-end gap-1.5">
                  <button 
                    type="button" 
                    onClick={() => setShowAddWorkspaceInput(false)}
                    className="text-[9px] text-slate-500 hover:text-slate-300 px-1.5 py-0.5"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    className="text-[9px] bg-indigo-600 hover:bg-indigo-500 text-white rounded px-2 py-0.5 font-medium"
                  >
                    Add Folder
                  </button>
                </div>
              </form>
            )}

            <div className="space-y-1">
              {history.workspaces.length === 0 ? (
                <div className="text-[11px] italic text-slate-600 px-2 py-1">
                  No registered workspaces
                </div>
              ) : (
                history.workspaces.map((wsPath) => {
                  const isActive = codebasePath === wsPath
                  return (
                    <div
                      key={wsPath}
                      onClick={() => {
                        setCodebasePath(wsPath)
                        setIngestResult('')
                      }}
                      className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer transition-all duration-150 ${
                        isActive
                          ? 'bg-indigo-950/40 border border-indigo-500/20 text-indigo-200'
                          : 'hover:bg-slate-900/50 border border-transparent text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="min-w-0 flex-1 flex items-center gap-2">
                        <span className={`text-[11px] ${isActive ? 'text-indigo-400' : 'text-slate-600'}`}>📁</span>
                        <span className="text-xs truncate font-medium font-mono" title={wsPath}>
                          {getFolderBasename(wsPath)}
                        </span>
                      </div>
                      <button
                        onClick={(e) => handleDeleteWorkspace(e, wsPath)}
                        className="opacity-0 group-hover:opacity-100 hover:text-red-400 p-0.5 rounded transition-all duration-100"
                        title="Remove workspace"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* History Section */}
          <div className="space-y-3">
            <h2 className="text-[10px] uppercase font-bold tracking-wider text-slate-500 flex items-center gap-1.5 px-1">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              Planning History
            </h2>

            <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1">
              {history.plans.length === 0 ? (
                <div className="text-[11px] italic text-slate-600 px-2 py-1">
                  No plans generated yet
                </div>
              ) : (
                history.plans.map((p) => {
                  const isSelected = selectedPlanId === p.id
                  return (
                    <div
                      key={p.id}
                      onClick={() => handleSelectPlan(p.id)}
                      className={`group flex flex-col gap-1 px-3 py-2 rounded-lg cursor-pointer border transition-all duration-200 ${
                        isSelected
                          ? 'bg-gradient-to-r from-purple-950/20 to-indigo-950/20 border-indigo-500/30 text-slate-200 shadow-md shadow-indigo-500/5'
                          : 'hover:bg-slate-900/40 border-transparent text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="text-[11px] font-semibold text-slate-300 truncate flex-1">
                          {p.feature_request}
                        </span>
                        <button
                          onClick={(e) => handleDeletePlan(e, p.id)}
                          className="opacity-0 group-hover:opacity-100 hover:text-red-400 p-0.5 rounded transition-all duration-100 flex-shrink-0"
                          title="Delete plan log"
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                      <div className="flex items-center justify-between text-[9px] text-slate-500 font-mono">
                        <span className="truncate max-w-[130px]">{getFolderBasename(p.codebase_path)}</span>
                        <span>{formatDate(p.timestamp)}</span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

        </div>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-slate-800/40 bg-[#090a0e] flex items-center justify-between text-[11px] text-slate-500">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            Agent Engine Ready
          </span>
          <span className="font-mono">Local dev</span>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col overflow-hidden">
        
        {/* Top Navbar */}
        <header className="h-16 border-b border-slate-800/40 bg-[#0a0c10]/80 backdrop-blur-md sticky top-0 z-40 px-8 flex items-center justify-between flex-shrink-0">
          {/* Breadcrumb Workspace Path */}
          <div className="flex items-center gap-1.5 text-xs text-slate-400 min-w-0">
            <span className="text-slate-500 flex items-center">
              <svg className="w-3.5 h-3.5 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </span>
            
            {!codebasePath ? (
              <span className="text-slate-500 italic font-mono">Select or add a codebase path to start</span>
            ) : (
              <span className="font-mono text-xs text-indigo-300 truncate" title={codebasePath}>
                {tildePath(codebasePath)}
              </span>
            )}
            
            {codebasePath && (
              <button 
                onClick={openBrowser}
                className="text-[10px] text-indigo-400 hover:text-indigo-300 ml-2 font-medium bg-slate-900 border border-slate-800 hover:border-slate-700 px-1.5 py-0.5 rounded transition-all active:scale-95 flex-shrink-0"
              >
                Browse
              </button>
            )}
          </div>

          {/* Codebase Ingest Status and Action */}
          {codebasePath && (
            <div className="flex items-center gap-4 flex-shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Index Status:</span>
                {ingestResult ? (
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                    ingestResult.startsWith('Error') 
                      ? 'bg-red-950/40 text-red-400 border-red-900/30' 
                      : 'bg-emerald-950/40 text-emerald-300 border-emerald-900/30'
                  }`}>
                    {ingestResult.startsWith('Error') ? 'Error' : 'Indexed'}
                  </span>
                ) : (
                  <span className="text-[10px] font-semibold bg-slate-950 text-slate-400 border border-slate-800 rounded-full px-2 py-0.5">
                    Ready
                  </span>
                )}
              </div>

              <button
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
                disabled={ingesting}
                className="bg-slate-900 border border-slate-800 text-slate-350 hover:bg-slate-800/80 hover:text-white px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40 transition-all flex items-center gap-1.5 active:scale-95 shadow-sm"
              >
                {ingesting ? (
                  <>
                    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Indexing...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                    </svg>
                    <span>Index Codebase</span>
                  </>
                )}
              </button>
            </div>
          )}
        </header>

        {/* Scrollable Main Area */}
        <main className="flex-1 overflow-y-auto px-8 py-8">
          
          <div className="max-w-5xl mx-auto space-y-6">
            
            {/* Setup view if no codebase path selected */}
            {!codebasePath ? (
              <div className="bg-slate-900/20 border border-slate-800/60 rounded-2xl p-8 text-center space-y-4 max-w-lg mx-auto mt-16 shadow-xl">
                <div className="w-12 h-12 rounded-full bg-indigo-950/50 border border-indigo-900/50 flex items-center justify-center mx-auto text-indigo-400">
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-white">Select a Workspace Directory</h3>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                    Choose one of your past workspace folders from the sidebar, or select a new codebase directory to index and plan features.
                  </p>
                </div>
                <button
                  onClick={openBrowser}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold px-4 py-2 transition-all shadow-lg shadow-indigo-600/10 active:scale-95"
                >
                  Browse Filesystem
                </button>
              </div>
            ) : (
              <>
                {/* Prompt Section */}
                <div className="bg-gradient-to-br from-[#12141c] to-[#0e1017] border border-slate-800/60 rounded-xl p-5 space-y-4 shadow-lg shadow-black/10 relative overflow-hidden">
                  
                  <div className="flex items-center gap-2 pb-1 text-slate-200">
                    <svg className="w-4 h-4 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 font-display">
                      Design Plan Builder
                    </h3>
                  </div>

                  <div className="space-y-2">
                    <textarea
                      className="w-full h-24 bg-[#08090d] border border-slate-800/80 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-indigo-500/50 focus:border-indigo-500/80 resize-none font-sans leading-relaxed text-slate-250 placeholder-slate-600 transition-colors"
                      placeholder="Explain what feature you want to add or build. The agent will retrieve codebase contexts and generate a step-by-step design..."
                      value={feature}
                      onChange={(e) => setFeature(e.target.value)}
                    />
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-slate-500 font-mono" title={codebasePath}>{tildePath(codebasePath)}</span>
                    <button
                      className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-lg text-xs font-semibold disabled:opacity-40 transition-all flex items-center gap-2 active:scale-95"
                      onClick={handlePlan}
                      disabled={!feature || planning}
                    >
                      {planning ? (
                        <>
                          <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          <span>Generating Plan...</span>
                        </>
                      ) : (
                        <span>Generate Implementation Plan</span>
                      )}
                    </button>
                  </div>
                </div>

                {/* Chain of thought timeline component */}
                <ChainOfThought events={events} planning={planning} />

                {/* Final Plan Markdown */}
                {plan && (
                  <div className="bg-[#0b0d13] border border-slate-800/80 rounded-xl p-6 space-y-4 shadow-xl">
                    <div className="flex items-center justify-between border-b border-slate-800/40 pb-3">
                      <div className="flex items-center gap-2">
                        <svg className="w-4.5 h-4.5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 font-display">
                          Implementation Plan
                        </h3>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          className="text-[10px] font-semibold text-slate-405 hover:text-slate-200 bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 transition-all"
                          onClick={() => {
                            setSelectedPlanId(null)
                            setPlan('')
                            setEvents([])
                            setFeature('')
                          }}
                        >
                          Clear Plan
                        </button>
                        <button
                          className="text-[10px] font-semibold text-indigo-300 hover:text-white bg-indigo-950/40 hover:bg-indigo-900/60 border border-indigo-900/50 rounded px-2.5 py-1.5 transition-all"
                          onClick={handleCopy}
                        >
                          {copied ? 'Copied!' : 'Copy Plan'}
                        </button>
                      </div>
                    </div>
                    
                    {/* Styled ReactMarkdown */}
                    <div className="select-text text-sm leading-relaxed text-slate-300 space-y-4 prose prose-invert font-sans max-w-none">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          h1: ({node, ...props}) => <h1 className="text-base font-semibold mt-6 mb-3 text-white border-b border-slate-800/60 pb-1.5 font-display" {...props} />,
                          h2: ({node, ...props}) => <h2 className="text-sm font-semibold mt-5 mb-2.5 text-white border-b border-slate-850 pb-1 font-display" {...props} />,
                          h3: ({node, ...props}) => <h3 className="text-xs font-semibold mt-4 mb-2 text-indigo-400 uppercase tracking-wider font-display" {...props} />,
                          p: ({node, ...props}) => <p className="mb-3 text-slate-300 leading-relaxed font-sans" {...props} />,
                          ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-3.5 space-y-1.5 text-slate-300 font-sans" {...props} />,
                          ol: ({node, ...props}) => <ol className="list-decimal pl-5 mb-3.5 space-y-1.5 text-slate-300 font-sans" {...props} />,
                          li: ({node, ...props}) => <li className="mb-0.5 font-sans" {...props} />,
                          code: ({node, className, children, ...props}) => {
                            const match = /language-(\w+)/.exec(className || '')
                            return match ? (
                              <code className={className} {...props}>
                                {children}
                              </code>
                            ) : (
                              <code className="bg-[#050609] text-indigo-300 border border-slate-800/80 rounded px-1.5 py-0.5 font-mono text-[11px]" {...props}>
                                {children}
                              </code>
                            )
                          },
                          pre: ({node, children, ...props}) => (
                            <pre className="bg-[#050609] border border-slate-800/80 rounded-lg p-4 my-3.5 overflow-x-auto font-mono text-[11px] text-slate-300 leading-relaxed" {...props}>
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
              </>
            )}

          </div>
        </main>
      </div>

      {/* Directory Browser Modal */}
      {showBrowser && (
        <div className="fixed inset-0 bg-black/75 flex items-start justify-center pt-24 z-50 animate-fade-in backdrop-blur-sm">
          <div className="bg-[#0f111a] border border-slate-800/80 rounded-2xl w-full max-w-lg p-5 shadow-2xl relative">
            <div className="flex items-center justify-between mb-4 border-b border-slate-800/60 pb-3">
              <div className="flex items-center gap-2">
                <button 
                  className="text-slate-400 hover:text-white text-xs bg-slate-900 border border-slate-800 hover:border-slate-700 px-2.5 py-1 rounded transition-colors" 
                  onClick={goUp}
                >
                  ↑ Up One Level
                </button>
                <span className="text-[11px] text-indigo-400 font-mono truncate max-w-[280px] bg-slate-950 px-2 py-1 rounded border border-slate-900" title={browsePath}>
                  {tildePath(browsePath)}
                </span>
              </div>
              <button 
                className="text-slate-500 hover:text-slate-300 transition-colors text-xs p-1"
                onClick={() => setShowBrowser(false)}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            
            <div className="max-h-72 overflow-y-auto space-y-0.5 mb-5 pr-1 border border-slate-800/40 rounded-xl p-2 bg-[#08090f]">
              {browseLoading && (
                <div className="text-xs text-slate-500 p-4 text-center flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Reading directory...</span>
                </div>
              )}
              {browseError && <p className="text-xs text-red-400 p-4 text-center font-medium">{browseError}</p>}
              {!browseLoading && !browseError && browseEntries.length === 0 && (
                <p className="text-xs text-slate-500 italic p-6 text-center">(empty directory)</p>
              )}
              {browseEntries.map((entry) => (
                <div
                  key={entry.path}
                  className="flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer hover:bg-slate-900/80 text-xs text-slate-300 transition-colors"
                  onClick={() => navigateDir(entry.path)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[13px] flex-shrink-0">📁</span>
                    <span className="font-mono truncate">{entry.name}/</span>
                  </div>
                  <span className="text-[10px] text-slate-600 bg-slate-900 border border-slate-800/60 px-1.5 py-0.5 rounded font-mono">DIR</span>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2.5 border-t border-slate-800/60 pt-4">
              <button 
                className="px-4 py-2 text-xs text-slate-400 hover:text-white transition-colors" 
                onClick={() => setShowBrowser(false)}
              >
                Cancel
              </button>
              <button 
                className="px-4 py-2 text-xs bg-indigo-650 hover:bg-indigo-650/90 text-white rounded-lg font-semibold transition-colors shadow-md shadow-indigo-650/15" 
                onClick={selectDir}
              >
                Select Folder
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
