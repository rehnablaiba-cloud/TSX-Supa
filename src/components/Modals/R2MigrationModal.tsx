// src/components/Modals/R2MigrationModal.tsx
const WORKER_URL = "https://shrill-thunder-6fdf.rehnab-rk.workers.dev"

import React, { useState, useEffect, useCallback } from "react"
import {
  Database, ArrowLeft, CheckCircle, CloudUpload, Eye,
  Package, FlaskConical, ListOrdered, Layers, AlertCircle,
  Square, CheckSquare, ChevronDown, ChevronUp, GitBranch,
  Trash2, RefreshCw, CheckSquare2, MinusSquare,
} from "lucide-react"
import ModalShell from "../UI/ModalShell"
import { supabase } from "../../supabase"
import { r2InvalidateAll } from "../../lib/r2"

// ── Types ─────────────────────────────────────────────────────────────────────
type MigrationType =
  | "modules"
  | "tests"
  | "revisions"
  | "step_orders"
  | "test_steps"
  | "delete_step_orders"
  | "delete_test_steps"
  | "reader"

type Stage =
  | "selecttype"
  | "selectrevisions"
  | "uploading"
  | "deleting"
  | "done"
  | "reader"
  | "error"

type R2FileStatus = "unknown" | "checking" | "exists" | "missing"

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
    throw new Error((err as any).error || `Worker ${res.status}`)
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
    throw new Error((err as any).error || `Worker ${res.status}`)
  }
  return res.json()
}

async function r2Delete(token: string, key: string) {
  const res = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "delete", key }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any).error || `Worker ${res.status}`)
  }
}

async function r2Check(token: string, key: string): Promise<boolean> {
  try {
    await r2Read(token, key)
    return true
  } catch {
    return false
  }
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

function R2StatusBadge({ status }: { status: R2FileStatus }) {
  if (status === "unknown") return null
  if (status === "checking") return (
    <span className="flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-c-brand/10 text-c-brand shrink-0">
      <div className="w-2 h-2 border border-c-brand border-t-transparent rounded-full animate-spin" />
      checking
    </span>
  )
  if (status === "exists") return (
    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20 shrink-0">
      ✓ in R2
    </span>
  )
  return (
    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 shrink-0">
      ✗ missing
    </span>
  )
}

// ── Migration type definitions ────────────────────────────────────────────────
const TYPE_META: {
  id:    MigrationType
  label: string
  icon:  React.ReactNode
  desc:  string
  flow:  "direct" | "revision" | "delete_revision" | "reader"
  danger?: boolean
}[] = [
  {
    id:   "modules",
    label: "Modules",
    icon:  <Package size={18} />,
    desc:  "Upload all modules → modules/all.json",
    flow:  "direct",
  },
  {
    id:   "tests",
    label: "Tests",
    icon:  <FlaskConical size={18} />,
    desc:  "Upload all tests → tests/all.json",
    flow:  "direct",
  },
  {
    id:   "revisions",
    label: "Revisions",
    icon:  <GitBranch size={18} />,
    desc:  "Upload all test revisions → revisions/all.json",
    flow:  "direct",
  },
  {
    id:   "step_orders",
    label: "Step Orders",
    icon:  <ListOrdered size={18} />,
    desc:  "Upload step_order per revision → step_orders/{id}.json",
    flow:  "revision",
  },
  {
    id:   "test_steps",
    label: "Test Steps",
    icon:  <Layers size={18} />,
    desc:  "Upload test_steps per revision → test_steps/{id}.json",
    flow:  "revision",
  },
  {
    id:   "delete_step_orders",
    label: "Delete Step Orders",
    icon:  <Trash2 size={18} />,
    desc:  "Delete step_orders/{id}.json files from R2",
    flow:  "delete_revision",
    danger: true,
  },
  {
    id:   "delete_test_steps",
    label: "Delete Test Steps",
    icon:  <Trash2 size={18} />,
    desc:  "Delete test_steps/{id}.json files from R2",
    flow:  "delete_revision",
    danger: true,
  },
  {
    id:   "reader",
    label: "Read from R2",
    icon:  <Eye size={18} />,
    desc:  "Fetch any R2 key and inspect its JSON",
    flow:  "reader",
  },
]

// ── Component ─────────────────────────────────────────────────────────────────
interface Props { onClose: () => void; onBack: () => void }

const R2MigrationModal: React.FC<Props> = ({ onClose, onBack }) => {
  const [stage,         setStage]         = useState<Stage>("selecttype")
  const [migrType,      setMigrType]      = useState<MigrationType | null>(null)
  const [revisions,     setRevisions]     = useState<TestRevision[]>([])
  // ── Default: nothing selected ──────────────────────────────────────────────
  const [selected,      setSelected]      = useState<Set<string>>(new Set())
  const [revLoading,    setRevLoading]    = useState(false)
  const [progress,      setProgress]      = useState<ProgressItem[]>([])
  const [summary,       setSummary]       = useState<{ label: string; count: number }[]>([])
  const [error,         setError]         = useState<string | null>(null)
  const [readerKey,     setReaderKey]     = useState("")
  const [readerData,    setReaderData]    = useState<unknown>(null)
  const [readerLoading, setReaderLoading] = useState(false)
  const [readerError,   setReaderError]   = useState<string | null>(null)
  const [showFull,      setShowFull]      = useState(false)
  // ── Differential: R2 status per revision ID ────────────────────────────────
  const [r2Status,      setR2Status]      = useState<Map<string, R2FileStatus>>(new Map())
  const [checkingAll,   setCheckingAll]   = useState(false)

  const subtitle: Record<Stage, string> = {
    selecttype:      "Choose type",
    selectrevisions: "Select revisions",
    uploading:       "Uploading…",
    deleting:        "Deleting…",
    done:            "Done",
    reader:          "R2 Reader",
    error:           "Something went wrong",
  }

  // ── Derive R2 key prefix from current migration type ───────────────────────
  const r2Prefix = (mt: MigrationType | null): string => {
    if (mt === "step_orders" || mt === "delete_step_orders") return "step_orders"
    if (mt === "test_steps"  || mt === "delete_test_steps")  return "test_steps"
    return ""
  }

  // ── Load revisions when entering selectrevisions / delete stage ────────────
  useEffect(() => {
    if (stage !== "selectrevisions") return
    setRevLoading(true)
    setSelected(new Set())   // always start unticked
    setR2Status(new Map())   // reset differential state
    supabase
      .from("test_revisions")
      .select("id, revision, tests_serial_no, step_order, status")
      .order("tests_serial_no")
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setRevisions((data ?? []) as TestRevision[])
        setRevLoading(false)
      })
  }, [stage])

  const patch = (label: string, changes: Partial<ProgressItem>) =>
    setProgress(prev => prev.map(p => p.label === label ? { ...p, ...changes } : p))

  // ── Check R2 existence for a single revision (on tick) ─────────────────────
  const checkOne = useCallback(async (rev: TestRevision) => {
    const prefix = r2Prefix(migrType)
    if (!prefix) return
    setR2Status(prev => new Map(prev).set(rev.id, "checking"))
    try {
      const token = await getToken()
      const exists = await r2Check(token, `${prefix}/${rev.id}.json`)
      setR2Status(prev => new Map(prev).set(rev.id, exists ? "exists" : "missing"))
    } catch {
      setR2Status(prev => new Map(prev).set(rev.id, "missing"))
    }
  }, [migrType])

  // ── Check all selected revisions at once ───────────────────────────────────
  const checkAll = useCallback(async () => {
    if (!revisions.length) return
    setCheckingAll(true)
    const prefix = r2Prefix(migrType)
    if (!prefix) { setCheckingAll(false); return }

    // Mark all as checking
    setR2Status(new Map(revisions.map(r => [r.id, "checking"])))

    try {
      const token = await getToken()
      await Promise.all(revisions.map(async (rev) => {
        const exists = await r2Check(token, `${prefix}/${rev.id}.json`)
        setR2Status(prev => new Map(prev).set(rev.id, exists ? "exists" : "missing"))
      }))
    } catch {
      setR2Status(prev => {
        const next = new Map(prev)
        revisions.forEach(r => { if (next.get(r.id) === "checking") next.set(r.id, "missing") })
        return next
      })
    } finally {
      setCheckingAll(false)
    }
  }, [revisions, migrType])

  // ── Auto-select missing revisions after check all ──────────────────────────
  const selectMissing = useCallback(() => {
    const missing = revisions.filter(r => r2Status.get(r.id) === "missing").map(r => r.id)
    setSelected(new Set(missing))
  }, [revisions, r2Status])

  const selectExisting = useCallback(() => {
    const existing = revisions.filter(r => r2Status.get(r.id) === "exists").map(r => r.id)
    setSelected(new Set(existing))
  }, [revisions, r2Status])

  // ── Type select ──────────────────────────────────────────────────────────────
  const handleTypeSelect = (t: MigrationType) => {
    setMigrType(t)
    setError(null)
    const meta = TYPE_META.find(m => m.id === t)
    if (meta?.flow === "reader")          { setStage("reader");           return }
    if (meta?.flow === "revision")        { setStage("selectrevisions");  return }
    if (meta?.flow === "delete_revision") { setStage("selectrevisions");  return }
    handleDirectUpload(t)
  }

  // ── Direct upload ──────────────────────────────────────────────────────────
  const handleDirectUpload = async (t: MigrationType) => {
    setStage("uploading")
    const labelMap: Partial<Record<MigrationType, string>> = {
      modules:   "Modules",
      tests:     "Tests",
      revisions: "Revisions",
    }
    const label = labelMap[t] ?? t
    setProgress([{ label, status: "running" }])
    const done: { label: string; count: number }[] = []
    try {
      const token = await getToken()
      if (t === "modules") {
        const { data, error: e } = await supabase.from("modules").select("*")
        if (e) throw new Error(e.message)
        await r2Write(token, "modules/all.json", data)
        patch(label, { status: "done", count: data?.length ?? 0 })
        done.push({ label, count: data?.length ?? 0 })
      } else if (t === "tests") {
        const { data, error: e } = await supabase.from("tests").select("*")
        if (e) throw new Error(e.message)
        await r2Write(token, "tests/all.json", data)
        patch(label, { status: "done", count: data?.length ?? 0 })
        done.push({ label, count: data?.length ?? 0 })
      } else if (t === "revisions") {
        const { data, error: e } = await supabase
          .from("test_revisions")
          .select("*")
          .order("tests_serial_no")
        if (e) throw new Error(e.message)
        await r2Write(token, "revisions/all.json", data)
        patch(label, { status: "done", count: data?.length ?? 0 })
        done.push({ label, count: data?.length ?? 0 })
      }
      r2InvalidateAll()
      setSummary(done)
      setStage("done")
    } catch (e: any) {
      setError(e.message)
      setStage("error")
    }
  }

  // ── Revision upload ────────────────────────────────────────────────────────
  const handleRevisionUpload = async () => {
    const chosenRevs = revisions.filter(r => selected.has(r.id))
    if (!chosenRevs.length) return
    setStage("uploading")
    const label = migrType === "step_orders" ? "Step Orders" : "Test Steps"
    setProgress(chosenRevs.map(r => ({
      label:  `${label} — ${r.revision || r.id.slice(0, 8)}`,
      status: "pending" as const,
    })))
    const done: { label: string; count: number }[] = []
    let token: string
    try { token = await getToken() } catch (e: any) { setError(e.message); setStage("error"); return }

    for (const rev of chosenRevs) {
      const rowLabel = `${label} — ${rev.revision || rev.id.slice(0, 8)}`
      patch(rowLabel, { status: "running" })
      try {
        if (migrType === "step_orders") {
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
    r2InvalidateAll()
    setSummary(done)
    setStage("done")
  }

  // ── Revision delete ────────────────────────────────────────────────────────
  const handleRevisionDelete = async () => {
    const chosenRevs = revisions.filter(r => selected.has(r.id))
    if (!chosenRevs.length) return
    setStage("deleting")
    const prefix  = r2Prefix(migrType)
    const label   = migrType === "delete_step_orders" ? "Delete Step Order" : "Delete Test Steps"
    setProgress(chosenRevs.map(r => ({
      label:  `${label} — ${r.revision || r.id.slice(0, 8)}`,
      status: "pending" as const,
    })))
    const done: { label: string; count: number }[] = []
    let token: string
    try { token = await getToken() } catch (e: any) { setError(e.message); setStage("error"); return }

    for (const rev of chosenRevs) {
      const rowLabel = `${label} — ${rev.revision || rev.id.slice(0, 8)}`
      patch(rowLabel, { status: "running" })
      try {
        await r2Delete(token, `${prefix}/${rev.id}.json`)
        patch(rowLabel, { status: "done", count: 0 })
        done.push({ label: rowLabel, count: 0 })
      } catch (e: any) {
        patch(rowLabel, { status: "error", error: e.message })
      }
    }
    r2InvalidateAll()
    setSummary(done)
    setStage("done")
  }

  // ── R2 Reader ──────────────────────────────────────────────────────────────
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
    if (stage === "selectrevisions") { setStage("selecttype"); setSelected(new Set()); setRevisions([]); setR2Status(new Map()) }
    if (stage === "done")            { setStage("selecttype"); setSummary([]) }
    if (stage === "error")           { setStage("selecttype"); setError(null) }
    if (stage === "reader")          { setStage("selecttype"); setReaderData(null); setReaderKey("") }
  }

  const allSelected  = revisions.length > 0 && selected.size === revisions.length
  const noneSelected = selected.size === 0

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(revisions.map(r => r.id)))

  const toggleOne = async (rev: TestRevision) => {
    const next = new Set(selected)
    if (next.has(rev.id)) {
      next.delete(rev.id)
    } else {
      next.add(rev.id)
      // Lazy R2 check only when ticking — not on untick
      if (r2Status.get(rev.id) === "unknown" || !r2Status.has(rev.id)) {
        checkOne(rev)
      }
    }
    setSelected(next)
  }

  const isDeleteFlow = migrType === "delete_step_orders" || migrType === "delete_test_steps"
  const totalRows    = summary.reduce((a, s) => a + s.count, 0)

  const previewJson  = readerData ? JSON.stringify(readerData, null, 2) : ""
  const previewLines = previewJson.split("\n")
  const isLong       = previewLines.length > 30

  // Differential summary
  const checkedCount  = [...r2Status.values()].filter(s => s !== "unknown" && s !== "checking").length
  const existsCount   = [...r2Status.values()].filter(s => s === "exists").length
  const missingCount  = [...r2Status.values()].filter(s => s === "missing").length

  return (
    <ModalShell
      title="R2 Migration"
      icon={<Database size={16} />}
      subtitle={subtitle[stage]}
      onClose={onClose}
    >
      {/* Back */}
      {stage !== "uploading" && stage !== "deleting" && (
        <button
          onClick={handleBack}
          className="-mt-2 self-start flex items-center gap-1 text-xs text-t-muted hover:text-t-primary transition-colors"
        >
          <ArrowLeft size={13} /> Back
        </button>
      )}

      {/* ── Select type ── */}
      {stage === "selecttype" && (
        <div className="flex flex-col gap-2">
          {TYPE_META.map(m => (
            <button
              key={m.id}
              onClick={() => handleTypeSelect(m.id)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all
                ${m.danger
                  ? "border-red-500/20 bg-red-500/5 hover:bg-red-500/10"
                  : "border-(--border-color) bg-bg-card hover:bg-bg-base"}`}
            >
              <span className={`shrink-0 ${m.danger ? "text-red-400" : "text-t-muted"}`}>{m.icon}</span>
              <div>
                <p className={`text-sm font-semibold ${m.danger ? "text-red-400" : "text-t-primary"}`}>{m.label}</p>
                <p className="text-xs text-t-muted">{m.desc}</p>
              </div>
            </button>
          ))}
          <p className="text-xs text-t-muted text-center pt-1">
            Run <span className="font-medium text-t-primary">Modules → Tests → Revisions → Step Orders → Test Steps</span> in order for a full migration.
          </p>
        </div>
      )}

      {/* ── Select revisions ── */}
      {stage === "selectrevisions" && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-t-muted">
            {isDeleteFlow
              ? `Select revisions to delete from R2`
              : migrType === "step_orders"
              ? "Select revisions to upload their step_order array"
              : "Select revisions to upload their test_steps"}
          </p>

          {revLoading ? (
            <div className="flex items-center justify-center py-6">
              <div className="w-6 h-6 border-2 border-c-brand border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* ── Differential toolbar ── */}
              <div className="flex flex-wrap items-center gap-1.5 p-2.5 rounded-xl border border-(--border-color) bg-bg-card">
                <span className="text-[10px] font-semibold text-t-muted uppercase tracking-wider mr-1">Differential</span>

                {/* Check all */}
                <button
                  onClick={checkAll}
                  disabled={checkingAll || revLoading}
                  className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg
                    bg-c-brand/10 hover:bg-c-brand/20 text-c-brand border border-c-brand/20
                    disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <RefreshCw size={10} className={checkingAll ? "animate-spin" : ""} />
                  Check all R2
                </button>

                {/* Select missing */}
                {missingCount > 0 && (
                  <button
                    onClick={selectMissing}
                    className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg
                      bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 border border-yellow-500/20 transition-colors"
                  >
                    <MinusSquare size={10} />
                    Select missing ({missingCount})
                  </button>
                )}

                {/* Select existing */}
                {existsCount > 0 && (
                  <button
                    onClick={selectExisting}
                    className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg
                      bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20 transition-colors"
                  >
                    <CheckSquare2 size={10} />
                    Select existing ({existsCount})
                  </button>
                )}

                {/* Summary counts */}
                {checkedCount > 0 && (
                  <span className="ml-auto text-[10px] text-t-muted">
                    {existsCount} in R2 · {missingCount} missing
                  </span>
                )}
              </div>

              {/* ── Select all toggle ── */}
              <div className="flex items-center justify-between">
                <button
                  onClick={toggleAll}
                  className="flex items-center gap-2 text-xs text-t-muted hover:text-t-primary transition-colors px-1"
                >
                  {allSelected
                    ? <CheckSquare size={14} className="text-c-brand" />
                    : noneSelected
                    ? <Square size={14} />
                    : <MinusSquare size={14} className="text-t-muted" />}
                  {allSelected ? "Deselect all" : "Select all"} ({revisions.length})
                </button>
                <span className="text-xs text-t-muted">{selected.size} selected</span>
              </div>

              {/* ── Revision list ── */}
              <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                {revisions.map(r => {
                  const status = r2Status.get(r.id) ?? "unknown"
                  return (
                    <button
                      key={r.id}
                      onClick={() => toggleOne(r)}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-left text-sm transition-all
                        ${selected.has(r.id)
                          ? isDeleteFlow
                            ? "border-red-500/30 bg-red-500/5 text-t-primary"
                            : "border-c-brand/40 bg-c-brand-bg text-t-primary"
                          : "border-(--border-color) bg-bg-card text-t-muted hover:bg-bg-base"}`}
                    >
                      {selected.has(r.id)
                        ? <CheckSquare size={14} className={isDeleteFlow ? "text-red-400 shrink-0" : "text-c-brand shrink-0"} />
                        : <Square size={14} className="shrink-0" />}

                      <span className="flex-1 truncate font-mono text-xs">{r.id}</span>

                      <span className="text-xs text-t-muted shrink-0">
                        {r.revision || `sno:${r.tests_serial_no}`}
                      </span>

                      {/* R2 status badge — only shows after check */}
                      <R2StatusBadge status={status} />

                      {/* step_order local count — only for step_orders type, no extra fetch */}
                      {migrType === "step_orders" && selected.has(r.id) && (
                        <span className={`text-xs shrink-0 ${r.step_order?.length ? "text-green-400" : "text-yellow-400"}`}>
                          {r.step_order?.length ? `${r.step_order.length} local` : "fallback"}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* ── Action button ── */}
              {isDeleteFlow ? (
                <button
                  onClick={handleRevisionDelete}
                  disabled={selected.size === 0}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold
                    bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20
                    disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Trash2 size={14} />
                  Delete {selected.size} file{selected.size !== 1 ? "s" : ""} from R2
                </button>
              ) : (
                <button
                  onClick={handleRevisionUpload}
                  disabled={selected.size === 0}
                  className="btn-primary text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <CloudUpload size={14} />
                  Upload {selected.size} revision{selected.size !== 1 ? "s" : ""}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Uploading / Deleting ── */}
      {(stage === "uploading" || stage === "deleting") && (
        <div className="rounded-xl border border-(--border-color) bg-bg-card divide-y divide-(--border-color) overflow-hidden max-h-80 overflow-y-auto">
          {progress.map(p => <ProgressRow key={p.label} item={p} />)}
        </div>
      )}

      {/* ── Done ── */}
      {stage === "done" && (
        <div className="flex flex-col items-center gap-3 py-2">
          <CheckCircle size={32} className="text-green-400" />
          <p className="text-sm font-semibold text-t-primary">
            {isDeleteFlow ? "Deletion complete" : "Upload complete"}
          </p>
          <div className="rounded-xl border border-(--border-color) bg-bg-card w-full divide-y divide-(--border-color) overflow-hidden text-xs max-h-64 overflow-y-auto">
            {summary.map(s => (
              <div key={s.label} className="flex items-center justify-between px-3 py-2">
                <span className="text-t-primary truncate flex-1">{s.label}</span>
                {!isDeleteFlow && <span className="text-t-muted shrink-0 ml-2">{s.count} rows</span>}
              </div>
            ))}
            {!isDeleteFlow && (
              <div className="flex items-center justify-between px-3 py-2 bg-bg-base sticky bottom-0">
                <span className="text-t-primary font-semibold">Total</span>
                <span className="text-c-brand font-semibold">{totalRows} rows</span>
              </div>
            )}
          </div>
          <p className="text-xs text-t-muted text-center">
            R2 cache cleared — live reads will pick up fresh data immediately.
          </p>
          <div className="flex gap-2 w-full">
            <button
              onClick={() => { setStage("selecttype"); setSummary([]) }}
              className="flex-1 btn-ghost text-sm"
            >
              Do more
            </button>
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
            <button
              onClick={() => { setStage("selecttype"); setError(null) }}
              className="flex-1 btn-primary text-sm"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* ── R2 Reader ── */}
      {stage === "reader" && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-t-muted">Enter the R2 key to fetch and inspect its contents</p>

          <div className="flex flex-wrap gap-1.5">
            {["modules/all.json", "tests/all.json", "revisions/all.json"].map(k => (
              <button
                key={k}
                onClick={() => setReaderKey(k)}
                className="text-xs px-2 py-1 rounded-lg border border-(--border-color) bg-bg-card hover:bg-bg-base text-t-muted hover:text-t-primary transition-colors font-mono"
              >
                {k}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              value={readerKey}
              onChange={e => setReaderKey(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleRead()}
              placeholder="e.g. step_orders/T001-R0-1.json"
              className="input text-sm font-mono flex-1"
            />
            <button
              onClick={handleRead}
              disabled={!readerKey.trim() || readerLoading}
              className="btn-primary text-sm px-4 disabled:opacity-50 shrink-0"
            >
              {readerLoading
                ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : "Fetch"}
            </button>
          </div>

          {readerError && <p className="text-xs text-red-400 px-1">{readerError}</p>}

          {readerData !== null && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-t-muted">
                  {Array.isArray(readerData) ? `${(readerData as unknown[]).length} items` : "object"}
                </span>
                {isLong && (
                  <button
                    onClick={() => setShowFull(p => !p)}
                    className="flex items-center gap-1 text-xs text-c-brand hover:underline"
                  >
                    {showFull
                      ? <><ChevronUp size={12} /> Collapse</>
                      : <><ChevronDown size={12} /> Expand all</>}
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