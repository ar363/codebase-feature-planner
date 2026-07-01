'use client'

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8420'

export default function Home() {
  const [path, setPath] = useState('')
  const [ingesting, setIngesting] = useState(false)
  const [ingestResult, setIngestResult] = useState('')

  const [feature, setFeature] = useState('')
  const [codebasePath, setCodebasePath] = useState('')
  const [planning, setPlanning] = useState(false)
  const [plan, setPlan] = useState('')
  const [copied, setCopied] = useState(false)

  async function handleIngest() {
    setIngesting(true)
    setIngestResult('')
    try {
      const res = await fetch(`${API}/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      })
      const data = await res.json()
      if (res.ok) {
        setIngestResult(`Indexed ${data.chunks_indexed} chunks`)
      } else {
        setIngestResult(`Error: ${data.detail || 'unknown'}`)
      }
    } catch {
      setIngestResult('Error: could not reach backend')
    }
    setIngesting(false)
  }

  async function handlePlan() {
    setPlanning(true)
    setPlan('')
    try {
      const res = await fetch(`${API}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature_request: feature, codebase_path: codebasePath }),
      })
      const data = await res.json()
      if (res.ok) {
        setPlan(data.plan)
      } else {
        setPlan(`Error: ${data.detail || 'unknown'}`)
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

  return (
    <main className="max-w-3xl mx-auto space-y-12">
      <div>
        <h1 className="text-xl font-bold mb-1">codebase-feature-planner</h1>
        <p className="text-sm text-neutral-500">
          Index a codebase, describe a feature, get a file-by-file implementation plan.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Index Codebase</h2>
        <div className="flex gap-2">
          <input
            className="flex-1 bg-neutral-900 border border-neutral-800 rounded px-3 py-2 text-sm outline-none focus:border-neutral-600"
            placeholder="Path to codebase (e.g. C:\Users\me\project)"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
          <button
            className="bg-neutral-200 text-neutral-900 px-4 py-2 rounded text-sm font-medium hover:bg-neutral-300 disabled:opacity-40"
            onClick={handleIngest}
            disabled={!path || ingesting}
          >
            {ingesting ? 'Indexing...' : 'Index'}
          </button>
        </div>
        {ingestResult && (
          <p className="text-sm text-neutral-400">{ingestResult}</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Generate Plan</h2>
        <div className="space-y-2">
          <input
            className="w-full bg-neutral-900 border border-neutral-800 rounded px-3 py-2 text-sm outline-none focus:border-neutral-600"
            placeholder="Codebase path (or reuse the same one)"
            value={codebasePath}
            onChange={(e) => setCodebasePath(e.target.value)}
          />
          <textarea
            className="w-full h-32 bg-neutral-900 border border-neutral-800 rounded px-3 py-2 text-sm outline-none focus:border-neutral-600 resize-none"
            placeholder="Describe the feature you want to add..."
            value={feature}
            onChange={(e) => setFeature(e.target.value)}
          />
          <button
            className="bg-neutral-200 text-neutral-900 px-4 py-2 rounded text-sm font-medium hover:bg-neutral-300 disabled:opacity-40"
            onClick={handlePlan}
            disabled={!feature || !codebasePath || planning}
          >
            {planning ? 'Generating...' : 'Generate Plan'}
          </button>
        </div>

        {plan && (
          <div className="relative bg-neutral-900 border border-neutral-800 rounded p-4 mt-4">
            <button
              className="absolute top-3 right-3 text-xs text-neutral-500 hover:text-neutral-300"
              onClick={handleCopy}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{plan}</ReactMarkdown>
            </div>
          </div>
        )}
      </section>
    </main>
  )
}
