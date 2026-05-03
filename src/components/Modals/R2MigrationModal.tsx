// src/components/Modals/R2MigrationModal.tsx
// ─── Adjust these to match your actual Supabase table names ───────────────────
const TABLE_MODULES        = "modules"
const TABLE_TESTS          = "tests"
const TABLE_REVISIONS      = "test_revisions"   // ← update if different
const TABLE_STEP_ORDERS    = "step_orders"       // ← update if different
const TABLE_TEST_STEPS     = "test_steps"        // ← update if different
const REVISION_FK          = "revision_id"       // FK column name in step_orders & test_steps
// ─────────────────────────────────────────────────────────────────────────────

const WORKER_URL = "https://shrill-thunder-6fdf.rehnab-rk.workers.dev"

import React, { useState } from "react"
import { Database, ArrowLeft, CheckCircle, CloudUpload, Wifi, WifiOff, AlertCircle } from "lucide-react"
import ModalShell from "../UI/ModalShell"
import { supabase } from "../../supabase"

type Stage = "connect" | "connecting" | "ready" | "migrating" | "done" | "error"

interface MigrationStep {
  id:     string
  label:  string
  r2Key?: string
  status: "pending" | "running" | "done" | "error"
  count?: number
  error?: string
}

interface Props { onClose: () => void; onBack: () => void }

// ── R2 helper ──────────────────────────────────────────────────────────────────
async function r2Write(token: string, key: string, data: unknown) {
  const res = await fetch(WORKER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({ type: "write", key, data }),
  })
  if (!res.ok) throw new Error(`Worker error ${res.status}`)
  return res.json()
}

async function r2Ping(token: string) {
  await r2Write(token, "_ping/test.json", { ok: true, ts: Date.now() })
}

// ── Component ──────────────────────────────────────────────────────────────────
const R2MigrationModal: React.FC<Props> = ({ onClose, onBack }) => {
  const [stage,   setStage]   = useState<Stage>("connect")
  const [token,   setToken]   = useState<string>("")
  const [steps,   setSteps]   = useState<MigrationStep[]>([])
  const [error,   setError]   = useState<string | null>(null)
  const [current, setCurrent] = useState<string>("")   // currently uploading label

  const subtitle: Record<Stage, string> = {
    connect:    "Test connection",
    connecting: "Connecting…",
    ready:      "Ready to migrate",
    migrating:  current || "Uploading…",
    done:       "Migration complete",
    error:      "Something went wrong",
  }

  // ── Step 1: Connect ──────────────────────────────────────────────────────────
  const handleConnect = async () => {
    setStage("connecting")
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error("Not logged in to Supabase")
      await r2Ping(session.access_token)
      setToken(session.access_token)

      // Build step list (revision-level steps are added dynamically during migration)
      setSteps([
        { id: "modules",   label: "Modules",           r2Key: "modules/all.json",        status: "pending" },
        { id: "tests",     label: "Tests",              r2Key: "tests/all.json",           status: "pending" },
        { id: "revisions", label: "Test Revisions",     r2Key: "test_revisions/all.json",  status: "pending" },
        { id: "sorders",   label: "Step Orders",        r2Key: "step_orders/{rev}.json",   status: "pending" },
        { id: "tsteps",    label: "Test Steps",         r2Key: "test_steps/{rev}.json",    status: "pending" },
      ])
      setStage("ready")
    } catch (e: any) {
      setError(e.message)
      setStage("error")
    }
  }

  // ── Step helper ──────────────────────────────────────────────────────────────
  const setStepStatus = (
    id: string,
    status: MigrationStep["status"],
    extras?: Partial<MigrationStep>
  ) => {
    setSteps(prev =>
      prev.map(s => s.id === id ? { ...s, status, ...extras } : s)
    )
  }

  // ── Step 2: Migrate ──────────────────────────────────────────────────────────
  const handleMigrate = async () => {
    setStage("migrating")
    setError(null)

    try {
      // ── Modules ──
      setCurrent("Uploading Modules…")
      setStepStatus("modules", "running")
      const { data: modules, error: modErr } = await supabase.from(TABLE_MODULES).select("*")
      if (modErr) throw new Error(`Modules: ${modErr.message}`)
      await r2Write(token, "modules/all.json", modules)
      setStepStatus("modules", "done", { count: modules?.length ?? 0 })

      // ── Tests ──
      setCurrent("Uploading Tests…")
      setStepStatus("tests", "running")
      const { data: tests, error: testErr } = await supabase.from(TABLE_TESTS).select("*")
      if (testErr) throw new Error(`Tests: ${testErr.message}`)
      await r2Write(token, "tests/all.json", tests)
      setStepStatus("tests", "done", { count: tests?.length ?? 0 })

      // ── Test Revisions (without step_order column) ──
      setCurrent("Uploading Test Revisions…")
      setStepStatus("revisions", "running")
      const { data: revisions, error: revErr } = await supabase
        .from(TABLE_REVISIONS)
        .select("*, step_order:false")   // exclude step_order if it's a column
        .order("id")
      if (revErr) {
        // Fallback: fetch all columns, strip step_order client-side
        const { data: revAll, error: revErr2 } = await supabase.from(TABLE_REVISIONS).select("*")
        if (revErr2) throw new Error(`Revisions: ${revErr2.message}`)
        const cleaned = revAll?.map(({ step_order, ...rest }) => rest) ?? []
        await r2Write(token, "test_revisions/all.json", cleaned)
        setStepStatus("revisions", "done", { count: cleaned.length })
      } else {
        await r2Write(token, "test_revisions/all.json", revisions)
        setStepStatus("revisions", "done", { count: revisions?.length ?? 0 })
      }

      const revIds: string[] = (revisions ?? []).map((r: any) => r.id)

      // ── Step Orders (one file per revision) ──
      setCurrent("Uploading Step Orders…")
      setStepStatus("sorders", "running")
      let sorderCount = 0
      for (const revId of revIds) {
        const { data: so, error: soErr } = await supabase
          .from(TABLE_STEP_ORDERS)
          .select("*")
          .eq(REVISION_FK, revId)
          .order("serial_no", { ascending: true })
        if (soErr) throw new Error(`StepOrders[${revId}]: ${soErr.message}`)
        await r2Write(token, `step_orders/${revId}.json`, so)
        sorderCount += so?.length ?? 0
      }
      setStepStatus("sorders", "done", { count: sorderCount, label: `Step Orders (${revIds.length} revisions)` })

      // ── Test Steps (one file per revision) ──
      setCurrent("Uploading Test Steps…")
      setStepStatus("tsteps", "running")
      let tstepCount = 0
      for (const revId of revIds) {
        const { data: ts, error: tsErr } = await supabase
          .from(TABLE_TEST_STEPS)
          .select("*")
          .eq(REVISION_FK, revId)
          .order("serial_no", { ascending: true })
        if (tsErr) throw new Error(`TestSteps[${revId}]: ${tsErr.message}`)
        await r2Write(token, `test_steps/${revId}.json`, ts)
        tstepCount += ts?.length ?? 0
      }
      setStepStatus("tsteps", "done", { count: tstepCount, label: `Test Steps (${revIds.length} revisions)` })

      setStage("done")
    } catch (e: any) {
      setError(e.message)
      setStage("error")
    }
  }

  const handleBack = () => {
    if (stage === "connect" || stage === "error") return onBack()
    if (stage === "ready") return setStage("connect")
  }

  const totalRows = steps.reduce((a, s) => a + (s.count ?? 0), 0)

  return (
    <ModalShell
      title="R2 Migration"
      icon={<Database size={16} />}
      subtitle={subtitle[stage]}
      onClose={onClose}
    >
      {/* Back button */}
      {(stage === "connect" || stage === "ready" || stage === "error") && (
        <button
          onClick={handleBack}
          className="-mt-2 self-start flex items-center gap-1 text-xs text-t-muted hover:text-t-primary transition-colors"
        >
          <ArrowLeft size={13} /> Back
        </button>
      )}

      {/* ── Connect stage ── */}
      {stage === "connect" && (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-(--border-color) bg-bg-card p-4 flex flex-col gap-2.5 text-xs text-t-muted">
            <p className="text-t-primary font-semibold text-sm">What this will do</p>
            {[
              ["modules/all.json",              "All modules"],
              ["tests/all.json",                "All tests"],
              ["test_revisions/all.json",       "All revisions (no step_order col)"],
              ["step_orders/{revision_id}.json","Step order per revision"],
              ["test_steps/{revision_id}.json", "Test steps per revision"],
            ].map(([key, label]) => (
              <div key={key} className="flex items-start gap-2">
                <CloudUpload size={12} className="mt-0.5 shrink-0 text-c-brand" />
                <span>
                  <span className="text-t-primary font-medium">{label}</span>
                  <span className="ml-1 opacity-60">→ {key}</span>
                </span>
              </div>
            ))}
          </div>
          <button onClick={handleConnect} className="btn-primary text-sm flex items-center justify-center gap-2">
            <Wifi size={14} /> Test Connection & Continue
          </button>
        </div>
      )}

      {/* ── Connecting spinner ── */}
      {stage === "connecting" && (
        <div className="flex items-center justify-center py-8">
          <div className="w-8 h-8 border-4 border-c-brand border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* ── Ready stage ── */}
      {stage === "ready" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-green-500/10 border border-green-500/20">
            <Wifi size={14} className="text-green-400" />
            <span className="text-xs text-green-400 font-medium">Worker connected successfully</span>
          </div>
          <div className="rounded-xl border border-(--border-color) bg-bg-card divide-y divide-(--border-color) text-xs overflow-hidden">
            {steps.map(s => (
              <div key={s.id} className="flex items-center justify-between px-3 py-2.5">
                <span className="text-t-primary">{s.label}</span>
                <span className="text-t-muted font-mono">{s.r2Key}</span>
              </div>
            ))}
          </div>
          <button onClick={handleMigrate} className="btn-primary text-sm flex items-center justify-center gap-2">
            <CloudUpload size={14} /> Start Migration
          </button>
        </div>
      )}

      {/* ── Migrating stage ── */}
      {stage === "migrating" && (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-(--border-color) bg-bg-card divide-y divide-(--border-color) overflow-hidden text-sm">
            {steps.map(s => (
              <div key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                {/* Status icon */}
                {s.status === "pending" && (
                  <div className="w-4 h-4 rounded-full border-2 border-(--border-color) shrink-0" />
                )}
                {s.status === "running" && (
                  <div className="w-4 h-4 border-2 border-c-brand border-t-transparent rounded-full animate-spin shrink-0" />
                )}
                {s.status === "done" && (
                  <CheckCircle size={16} className="text-green-400 shrink-0" />
                )}
                {s.status === "error" && (
                  <AlertCircle size={16} className="text-red-400 shrink-0" />
                )}
                <span className={
                  s.status === "done"    ? "text-t-primary" :
                  s.status === "running" ? "text-c-brand font-medium" :
                  "text-t-muted"
                }>
                  {s.label}
                </span>
                {s.status === "done" && s.count !== undefined && (
                  <span className="ml-auto text-xs text-t-muted">{s.count} rows</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Done stage ── */}
      {stage === "done" && (
        <div className="flex flex-col items-center gap-3 py-4">
          <CheckCircle size={32} className="text-green-400" />
          <p className="text-sm font-semibold text-t-primary">Migration complete</p>
          <div className="rounded-xl border border-(--border-color) bg-bg-card w-full divide-y divide-(--border-color) overflow-hidden text-xs">
            {steps.map(s => (
              <div key={s.id} className="flex items-center justify-between px-3 py-2">
                <span className="text-t-primary">{s.label}</span>
                <span className="text-t-muted">{s.count ?? 0} rows</span>
              </div>
            ))}
            <div className="flex items-center justify-between px-3 py-2 bg-bg-base">
              <span className="text-t-primary font-semibold">Total</span>
              <span className="text-c-brand font-semibold">{totalRows} rows</span>
            </div>
          </div>
          <button onClick={onClose} className="btn-primary text-sm px-6">Close</button>
        </div>
      )}

      {/* ── Error stage ── */}
      {stage === "error" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2 px-3 py-3 rounded-xl bg-red-500/10 border border-red-500/20">
            <WifiOff size={14} className="text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs text-red-400">{error}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={onBack} className="flex-1 btn-ghost text-sm">Back</button>
            <button onClick={() => { setStage("connect"); setError(null) }} className="flex-1 btn-primary text-sm">
              Retry
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  )
}

export default R2MigrationModal
