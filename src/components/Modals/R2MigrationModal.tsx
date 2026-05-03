// src/components/Modals/R2MigrationModal.tsx
const WORKER_URL = "https://shrill-thunder-6fdf.rehnab-rk.workers.dev"

import React, { useState, useEffect } from "react"
import {
  Database, ArrowLeft, CheckCircle, CloudUpload, Eye,
  Package, FlaskConical, ListOrdered, Layers, AlertCircle,
  Square, CheckSquare, ChevronDown, ChevronUp,
} from "lucide-react"
import ModalShell from "../UI/ModalShell"
import { supabase } from "../../supabase"

// ── Types ─────────────────────────────────────────────────────────────────────
type MigrationType = "modules" | "tests" | "step_orders" | "test_steps" | "reader"
type Stage = "selecttype" | "selectrevisions" | "uploading" | "done" | "reader" | "error"

interface TestRevision {
  id:              string
  revision:        string
  tests_serial_no: number
  step_order:      string[] | null
  status:          string
}

interface ProgressItem {
  label:  string
  status: "pending" | "running" | "done" | "error"
  count?: number
  error?: string
}

// ── R2 helpers ────────────────────────────────────────────────────────────────
async function getToken() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error("Not logged in")
  return session.access_token
}

async function r2Write(token: string, key: string, data: unknown) {
  const res = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "write", key, data }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Worker ${res.status}`)
  }
}

async function r2Read(token: string, key: string) {
  const res = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "read", key }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Worker ${res.status}`)
  }
  return res.json()
}

// ── Sub-components ────────────────────────────────────────────────────────────
function ProgressRow({ item }: { item: ProgressItem }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 text-sm">
      {item.status === "pending" && <div className="w-4 h-4 rounded-full border-2 border-(--border-color) shrink-0" />}
      {item.status === "running" && <div className="w-4 h-4 border-2 border-c-brand border-t-transparent rounded-full animate-spin shrink-0" />}
      {item.status === "done"    && <CheckCircle size={16} className="text-green-400 shrink-0" />}
      {item.status === "error"   && <AlertCircle size={16} className="text-red-400 shrink-0" />}
      <span className={
        item.status === "running" ? "text-c-brand font-medium flex-1" :
        item.status === "done"    ? "text-t-primary flex-1" :
        item.status === "error"   ? "text-red-400 flex-1" :
        "text-t-muted flex-1"
      }>
        {item.label}
        {item.error && <span className="ml-1 text-xs">— {item.error}</span>}
      </span>
      {item.status === "done" && item.count !== undefined && (
        <span className="text-xs text-t-muted">{item.count} rows</span>
      )}
    </div>
  )
}

const TYPE_META = [
  { id: "modules"     as MigrationType, label: "Modules",     icon: <Package size={18} />,      desc: "Upload all modules → modules/all.json" },
  { id: "tests"       as MigrationType, label: "Tests",       icon: <FlaskConical size={18} />,  desc: "Upload all tests → tests/all.json" },
  { id: "step_orders" as MigrationType, label: "Step Orders", icon: <ListOrdered size={18} />,   desc: "Upload step_order per revision → step_orders/{id}.json" },
  { id: "test_steps"  as MigrationType, label: "Test Steps",  icon: <Layers size={18} />,        desc: "Upload test_steps per revision → test_steps/{id}.json" },
  { id: "reader"      as MigrationType, label: "Read from R2",icon: <Eye size={18} />,           desc: "Fetch any R2 key and inspect its JSON" },
]

// ── Component ─────────────────────────────────────────────────────────────────
interface Props { onClose: () => void; onBack: () => void }

const R2MigrationModal: React.FC<Props> = ({ onClose, onBack }) => {
  const [stage,       setStage]       = useState<Stage>("selecttype")
  const [migrType,    setMigrType]    = useState<MigrationType | null>(null)
  const [revisions,   setRevisions]   = useState<TestRevision[]>([])
  const [selected,    setSelected]    = useState<Set<string>>(new Set())
  const [revLoading,  setRevLoading]  = useState(false)
  const [progress,    setProgress]    = useState<ProgressItem[]>([])
  const [summary,     setSummary]     = useState<{ label: string; count: number }[]>([])
  const [error,       setError]       = useState<string | null>(null)
  const [readerKey,   setReaderKey]   = useState("")
  const [readerData,  setReaderData]  = useState<unknown>(null)
  const [readerLoading, setReaderLoading] = useState(false)
  const [readerError, setReaderError] = useState<string | null>(null)
  const [showFull,    setShowFull]    = useState(false)

  const subtitle: Record<Stage, string> = {
    selecttype:       "Choose type",
    selectrevisions:  "Select revisions",
    uploading:        "Uploading…",
    done:             "Done",
    reader:           "R2 Reader",
    error:            "Something went wrong",
  }

  // ── Load revisions when needed ───────────────────────────────────────────────
  useEffect(() => {
    if (stage !== "selectrevisions") return
    setRevLoading(true)
    supabase
      .from("test_revisions")
      .select("id, revision, tests_serial_no, step_order, status")
      .order("tests_serial_no")
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else {
          setRevisions((data ?? []) as TestRevision[])
          // Default: select all
          setSelected(new Set((data ?? []).map((r: any) => r.id)))
        }
        setRevLoading(false)
      })
  }, [stage])

  const patch = (label: string, changes: Partial<ProgressItem>) =>
    setProgress(prev => prev.map(p => p.label === label ? { ...p, ...changes } : p))

  // ── Type select ──────────────────────────────────────────────────────────────
  const handleTypeSelect = (t: MigrationType) => {
    setMigrType(t)
    setError(null)
    if (t === "reader") { setStage("reader"); return }
    if (t === "step_orders" || t === "test_steps") { setStage("selectrevisions"); return }
    // modules / tests → go straight to upload
    handleDirectUpload(t)
  }

  // ── Direct upload (modules / tests) ─────────────────────────────────────────
  const handleDirectUpload = async (t: MigrationType) => {
    setStage("uploading")
    setProgress([{ label: t === "modules" ? "Modules" : "Tests", status: "running" }])
    const done: { label: string; count: number }[] = []
    try {
      const token = await getToken()
      if (t === "modules") {
        const { data, error: e } = await supabase.from("modules").select("*")
        if (e) throw new Error(e.message)
        await r2Write(token, "modules/all.json", data)
        patch("Modules", { status: "done", count: data?.length ?? 0 })
        done.push({ label: "Modules", count: data?.length ?? 0 })
      } else {
        const { data, error: e } = await supabase.from("tests").select("*")
        if (e) throw new Error(e.message)
        await r2Write(token, "tests/all.json", data)
        patch("Tests", { status: "done", count: data?.length ?? 0 })
        done.push({ label: "Tests", count: data?.length ?? 0 })
      }
      setSummary(done)
      setStage("done")
    } catch (e: any) {
      setError(e.message)
      setStage("error")
    }
  }

  // ── Revision upload (step_orders / test_steps) ───────────────────────────────
  const handleRevisionUpload = async () => {
    const chosenRevs = revisions.filter(r => selected.has(r.id))
    if (!chosenRevs.length) return

    setStage("uploading")
    const label = migrType === "step_orders" ? "Step Orders" : "Test Steps"
    setProgress(chosenRevs.map(r => ({
      label: `${label} — rev ${r.revision || r.id.slice(0, 8)}`,
      status: "pending" as const,
    })))

    const done: { label: string; count: number }[] = []
    let token: string
    try { token = await getToken() } catch (e: any) { setError(e.message); setStage("error"); return }

    for (const rev of chosenRevs) {
      const rowLabel = `${label} — rev ${rev.revision || rev.id.slice(0, 8)}`
      patch(rowLabel, { status: "running" })
      try {
        if (migrType === "step_orders") {
          // Use step_order from test_revisions directly
          // Fallback: fetch ordered step IDs from test_steps
          let order: string[] = []
          if (rev.step_order && rev.step_order.length > 0) {
            order = rev.step_order
          } else {
            const { data: steps, error: se } = await supabase
              .from("test_steps")
              .select("id")
              .eq("tests_serial_no", rev.tests_serial_no)
              .order("serial_no")
            if (se) throw new Error(se.message)
            order = (steps ?? []).map((s: any) => s.id)
          }
          await r2Write(token, `step_orders/${rev.id}.json`, order)
          patch(rowLabel, { status: "done", count: order.length })
          done.push({ label: rowLabel, count: order.length })
        } else {
          // test_steps — fetch all steps for this revision's tests_serial_no
          const { data: steps, error: se } = await supabase
            .from("test_steps")
            .select("*")
            .eq("tests_serial_no", rev.tests_serial_no)
            .order("serial_no")
          if (se) throw new Error(se.message)
          await r2Write(token, `test_steps/${rev.id}.json`, steps)
          patch(rowLabel, { status: "done", count: steps?.length ?? 0 })
          done.push({ label: rowLabel, count: steps?.length ?? 0 })
        }
      } catch (e: any) {
        patch(rowLabel, { status: "error", error: e.message })
      }
    }
    setSummary(done)
    setStage("done")
  }

  // ── R2 Reader ────────────────────────────────────────────────────────────────
  const handleRead = async () => {
    if (!readerKey.trim()) return
    setReaderLoading(true)
    setReaderError(null)
    setReaderData(null)
    try {
      const token = await getToken()
      const data = await r2Read(token, readerKey.trim())
      setReaderData(data)
    } catch (e: any) {
      setReaderError(e.message)
    } finally {
      setReaderLoading(false)
    }
  }

  const handleBack = () => {
    if (stage === "selecttype")      return onBack()
    if (stage === "selectrevisions") { setStage("selecttype"); setSelected(new Set()); setRevisions([]) }
    if (stage === "done")            { setStage("selecttype"); setSummary([]) }
    if (stage === "error")           { setStage("selecttype"); setError(null) }
    if (stage === "reader")          { setStage("selecttype"); setReaderData(null); setReaderKey("") }
  }

  const allSelected   = revisions.length > 0 && selected.size === revisions.length
  const toggleAll     = () => setSelected(allSelected ? new Set() : new Set(revisions.map(r => r.id)))
  const toggleOne     = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const totalRows = summary.reduce((a, s) => a + s.count, 0)

  const previewJson = readerData
    ? JSON.stringify(readerData, null, 2)
    : ""
  const previewLines = previewJson.split("\n")
  const isLong = previewLines.length > 30

  return (
    <ModalShell
      title="R2 Migration"
      icon={<Database size={16} />}
      subtitle={subtitle[stage]}
      onClose={onClose}
    >
      {/* Back */}
      {stage !== "uploading" && (
        <button onClick={handleBack}
          className="-mt-2 self-start flex items-center gap-1 text-xs text-t-muted hover:text-t-primary transition-colors">
          <ArrowLeft size={13} /> Back
        </button>
      )}

      {/* ── Select type ── */}
      {stage === "selecttype" && (
        <div className="flex flex-col gap-2">
          {TYPE_META.map(m => (
            <button key={m.id} onClick={() => handleTypeSelect(m.id)}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-(--border-color)
                bg-bg-card hover:bg-bg-base text-left transition-all">
              <span className="text-t-muted shrink-0">{m.icon}</span>
              <div>
                <p className="text-sm font-semibold text-t-primary">{m.label}</p>
                <p className="text-xs text-t-muted">{m.desc}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ── Select revisions ── */}
      {stage === "selectrevisions" && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-t-muted">
            {migrType === "step_orders"
              ? "Select revisions to upload their step_order array"
              : "Select revisions to upload their test_steps"}
          </p>

          {revLoading ? (
            <div className="flex items-center justify-center py-6">
              <div className="w-6 h-6 border-2 border-c-brand border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Select all */}
              <button onClick={toggleAll}
                className="flex items-center gap-2 text-xs text-t-muted hover:text-t-primary transition-colors px-1">
                {allSelected
                  ? <CheckSquare size={14} className="text-c-brand" />
                  : <Square size={14} />}
                {allSelected ? "Deselect all" : "Select all"} ({revisions.length})
              </button>

              {/* List */}
              <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                {revisions.map(r => (
                  <button key={r.id} onClick={() => toggleOne(r.id)}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-left text-sm transition-all
                      ${selected.has(r.id)
                        ? "border-c-brand/40 bg-c-brand-bg text-t-primary"
                        : "border-(--border-color) bg-bg-card text-t-muted hover:bg-bg-base"}`}>
                    {selected.has(r.id)
                      ? <CheckSquare size={14} className="text-c-brand shrink-0" />
                      : <Square size={14} className="shrink-0" />}
                    <span className="flex-1 truncate font-mono text-xs">{r.id}</span>
                    <span className="text-xs text-t-muted shrink-0">
                      {r.revision || `sno:${r.tests_serial_no}`}
                    </span>
                    {migrType === "step_orders" && (
                      <span className={`text-xs shrink-0 ${r.step_order?.length ? "text-green-400" : "text-yellow-400"}`}>
                        {r.step_order?.length ? `${r.step_order.length} steps` : "fallback"}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <button
                onClick={handleRevisionUpload}
                disabled={selected.size === 0}
                className="btn-primary text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                <CloudUpload size={14} />
                Upload {selected.size} revision{selected.size !== 1 ? "s" : ""}
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Uploading ── */}
      {stage === "uploading" && (
        <div className="rounded-xl border border-(--border-color) bg-bg-card divide-y divide-(--border-color) overflow-hidden max-h-80 overflow-y-auto">
          {progress.map(p => <ProgressRow key={p.label} item={p} />)}
        </div>
      )}

      {/* ── Done ── */}
      {stage === "done" && (
        <div className="flex flex-col items-center gap-3 py-2">
          <CheckCircle size={32} className="text-green-400" />
          <p className="text-sm font-semibold text-t-primary">Upload complete</p>
          <div className="rounded-xl border border-(--border-color) bg-bg-card w-full divide-y divide-(--border-color) overflow-hidden text-xs max-h-64 overflow-y-auto">
            {summary.map(s => (
              <div key={s.label} className="flex items-center justify-between px-3 py-2">
                <span className="text-t-primary truncate flex-1">{s.label}</span>
                <span className="text-t-muted shrink-0 ml-2">{s.count} rows</span>
              </div>
            ))}
            <div className="flex items-center justify-between px-3 py-2 bg-bg-base sticky bottom-0">
              <span className="text-t-primary font-semibold">Total</span>
              <span className="text-c-brand font-semibold">{totalRows} rows</span>
            </div>
          </div>
          <div className="flex gap-2 w-full">
            <button onClick={() => { setStage("selecttype"); setSummary([]) }}
              className="flex-1 btn-ghost text-sm">Migrate more</button>
            <button onClick={onClose} className="flex-1 btn-primary text-sm">Close</button>
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {stage === "error" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2 px-3 py-3 rounded-xl bg-red-500/10 border border-red-500/20">
            <AlertCircle size={14} className="text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs text-red-400 break-all">{error}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={onBack} className="flex-1 btn-ghost text-sm">Back</button>
            <button onClick={() => { setStage("selecttype"); setError(null) }}
              className="flex-1 btn-primary text-sm">Retry</button>
          </div>
        </div>
      )}

      {/* ── R2 Reader ── */}
      {stage === "reader" && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-t-muted">Enter the R2 key to fetch and inspect its contents</p>

          {/* Quick key suggestions */}
          <div className="flex flex-wrap gap-1.5">
            {[
              "modules/all.json",
              "tests/all.json",
            ].map(k => (
              <button key={k} onClick={() => setReaderKey(k)}
                className="text-xs px-2 py-1 rounded-lg border border-(--border-color) bg-bg-card hover:bg-bg-base text-t-muted hover:text-t-primary transition-colors font-mono">
                {k}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              value={readerKey}
              onChange={e => setReaderKey(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleRead()}
              placeholder="e.g. step_orders/abc-123.json"
              className="input text-sm font-mono flex-1"
            />
            <button onClick={handleRead} disabled={!readerKey.trim() || readerLoading}
              className="btn-primary text-sm px-4 disabled:opacity-50 shrink-0">
              {readerLoading
                ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : "Fetch"}
            </button>
          </div>

          {readerError && (
            <p className="text-xs text-red-400 px-1">{readerError}</p>
          )}

          {readerData !== null && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-t-muted">
                  {Array.isArray(readerData) ? `${(readerData as unknown[]).length} items` : "object"}
                </span>
                {isLong && (
                  <button onClick={() => setShowFull(p => !p)}
                    className="flex items-center gap-1 text-xs text-c-brand hover:underline">
                    {showFull ? <><ChevronUp size={12} /> Collapse</> : <><ChevronDown size={12} /> Expand all</>}
                  </button>
                )}
              </div>
              <pre className={`text-xs bg-bg-card border border-(--border-color) rounded-xl p-3
                overflow-auto font-mono text-t-primary
                ${showFull ? "max-h-[60vh]" : "max-h-48"}`}>
                {isLong && !showFull
                  ? previewLines.slice(0, 30).join("\n") + "\n\n…"
                  : previewJson}
              </pre>
            </div>
          )}
        </div>
      )}
    </ModalShell>
  )
}

export default R2MigrationModal