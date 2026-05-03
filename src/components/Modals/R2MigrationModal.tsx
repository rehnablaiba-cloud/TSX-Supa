// src/components/Modals/R2MigrationModal.tsx
const WORKER_URL = "https://shrill-thunder-6fdf.rehnab-rk.workers.dev"

import React, { useState } from "react"
import {
  Database, ArrowLeft, CheckCircle, CloudUpload,
  Wifi, WifiOff, AlertCircle,
} from "lucide-react"
import ModalShell from "../UI/ModalShell"
import { supabase } from "../../supabase"

// ── Types ─────────────────────────────────────────────────────────────────────
interface ModuleTest {
  id:          string
  tests_name:  string
  module_name: string
  is_visible:  boolean
}

interface StepRow {
  id:        string
  serial_no: number
  [key: string]: unknown
}

type Stage = "connect" | "connecting" | "ready" | "migrating" | "done" | "error"

interface ProgressItem {
  label:  string
  status: "pending" | "running" | "done" | "error"
  count?: number
  note?:  string
}

// ── R2 helper ─────────────────────────────────────────────────────────────────
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

// ── Progress row ──────────────────────────────────────────────────────────────
function ProgressRow({ item }: { item: ProgressItem }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 text-sm">
      {item.status === "pending" && (
        <div className="w-4 h-4 rounded-full border-2 border-(--border-color) shrink-0" />
      )}
      {item.status === "running" && (
        <div className="w-4 h-4 border-2 border-c-brand border-t-transparent rounded-full animate-spin shrink-0" />
      )}
      {item.status === "done" && (
        <CheckCircle size={16} className="text-green-400 shrink-0" />
      )}
      {item.status === "error" && (
        <AlertCircle size={16} className="text-red-400 shrink-0" />
      )}
      <span className={[
        "flex-1",
        item.status === "running" ? "text-c-brand font-medium" :
        item.status === "done"    ? "text-t-primary" :
        "text-t-muted"
      ].join(" ")}>
        {item.label}
      </span>
      {item.note && (
        <span className="text-xs text-t-muted">{item.note}</span>
      )}
      {item.status === "done" && item.count !== undefined && (
        <span className="text-xs text-t-muted ml-1">{item.count} rows</span>
      )}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Props { onClose: () => void; onBack: () => void }

const INITIAL_STEPS: ProgressItem[] = [
  { label: "Modules",        status: "pending" },
  { label: "Tests",          status: "pending" },
  { label: "Test Revisions", status: "pending" },
  { label: "Step Orders",    status: "pending", note: "per revision via RPC" },
  { label: "Test Steps",     status: "pending", note: "per revision via RPC" },
]

const R2MigrationModal: React.FC<Props> = ({ onClose, onBack }) => {
  const [stage,    setStage]    = useState<Stage>("connect")
  const [token,    setToken]    = useState("")
  const [progress, setProgress] = useState<ProgressItem[]>(INITIAL_STEPS)
  const [error,    setError]    = useState<string | null>(null)
  const [summary,  setSummary]  = useState<{ label: string; count: number }[]>([])

  const subtitle: Record<Stage, string> = {
    connect:    "Test connection",
    connecting: "Connecting…",
    ready:      "Ready to migrate",
    migrating:  "Uploading to R2…",
    done:       "Migration complete",
    error:      "Something went wrong",
  }

  const patch = (label: string, changes: Partial<ProgressItem>) =>
    setProgress(prev => prev.map(p => p.label === label ? { ...p, ...changes } : p))

  // ── Connect ───────────────────────────────────────────────────────────────────
  const handleConnect = async () => {
    setStage("connecting")
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error("Not logged in to Supabase")

      const res = await fetch(WORKER_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({ type: "write", key: "_ping/test.json", data: { ok: true } }),
      })
      if (!res.ok) throw new Error(`Worker returned ${res.status}`)

      setToken(session.access_token)
      setProgress(INITIAL_STEPS)
      setStage("ready")
    } catch (e: any) {
      setError(e.message)
      setStage("error")
    }
  }

  // ── Migrate ───────────────────────────────────────────────────────────────────
  const handleMigrate = async () => {
    setStage("migrating")
    setError(null)
    const done: { label: string; count: number }[] = []

    try {
      // 1. Modules
      patch("Modules", { status: "running" })
      const { data: modules, error: modErr } = await supabase.from("modules").select("*")
      if (modErr) throw new Error(`Modules: ${modErr.message}`)
      await r2Write(token, "modules/all.json", modules)
      patch("Modules", { status: "done", count: modules?.length ?? 0 })
      done.push({ label: "Modules", count: modules?.length ?? 0 })

      // 2. Tests
      patch("Tests", { status: "running" })
      const { data: tests, error: testErr } = await supabase.from("tests").select("*")
      if (testErr) throw new Error(`Tests: ${testErr.message}`)
      await r2Write(token, "tests/all.json", tests)
      patch("Tests", { status: "done", count: tests?.length ?? 0 })
      done.push({ label: "Tests", count: tests?.length ?? 0 })

      // 3. Test Revisions — module_tests without step_order column
      patch("Test Revisions", { status: "running" })
      const { data: revisions, error: revErr } = await supabase
        .from("module_tests")
        .select("id, tests_name, module_name, is_visible")
        .order("module_name")
      if (revErr) throw new Error(`Revisions: ${revErr.message}`)
      const revList = (revisions ?? []) as ModuleTest[]
      await r2Write(token, "test_revisions/all.json", revList)
      patch("Test Revisions", { status: "done", count: revList.length })
      done.push({ label: "Test Revisions", count: revList.length })

      // 4 & 5. Per revision via RPC
      patch("Step Orders", { status: "running", note: "starting…" })
      patch("Test Steps",  { status: "running", note: "starting…" })

      let totalStepOrders = 0
      let totalTestSteps  = 0

      for (let i = 0; i < revList.length; i++) {
        const rev = revList[i]

        const { data: rows, error: rpcErr } = await supabase.rpc("get_test_execution", {
          p_module_test_id: rev.id,
          p_module_name:    rev.module_name,
        })
        if (rpcErr) throw new Error(`RPC [${rev.id}]: ${rpcErr.message}`)

        const stepRows = (rows ?? []) as StepRow[]

        // step_orders → sorted IDs only
        const stepOrder = [...stepRows]
          .sort((a, b) => (a.serial_no ?? 0) - (b.serial_no ?? 0))
          .map(r => r.id)

        await Promise.all([
          r2Write(token, `step_orders/${rev.id}.json`, stepOrder),
          r2Write(token, `test_steps/${rev.id}.json`,  stepRows),
        ])

        totalStepOrders += stepOrder.length
        totalTestSteps  += stepRows.length

        const progress = `${i + 1}/${revList.length} revisions`
        patch("Step Orders", { note: progress })
        patch("Test Steps",  { note: progress })
      }

      patch("Step Orders", { status: "done", count: totalStepOrders, note: `${revList.length} revisions` })
      patch("Test Steps",  { status: "done", count: totalTestSteps,  note: `${revList.length} revisions` })
      done.push({ label: "Step Orders", count: totalStepOrders })
      done.push({ label: "Test Steps",  count: totalTestSteps  })

      setSummary(done)
      setStage("done")
    } catch (e: any) {
      setError(e.message)
      // Mark running step as error
      setProgress(prev => prev.map(p =>
        p.status === "running" ? { ...p, status: "error" } : p
      ))
      setStage("error")
    }
  }

  const handleBack = () => {
    if (stage === "connect" || stage === "error") return onBack()
    if (stage === "ready") { setStage("connect"); setProgress(INITIAL_STEPS) }
  }

  const totalRows = summary.reduce((a, s) => a + s.count, 0)

  return (
    <ModalShell
      title="R2 Migration"
      icon={<Database size={16} />}
      subtitle={subtitle[stage]}
      onClose={onClose}
    >
      {/* Back */}
      {(stage === "connect" || stage === "ready" || stage === "error") && (
        <button onClick={handleBack}
          className="-mt-2 self-start flex items-center gap-1 text-xs text-t-muted hover:text-t-primary transition-colors">
          <ArrowLeft size={13} /> Back
        </button>
      )}

      {/* ── Connect ── */}
      {stage === "connect" && (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-(--border-color) bg-bg-card p-4 flex flex-col gap-2.5">
            <p className="text-t-primary font-semibold text-sm">What this uploads</p>
            {[
              ["modules/all.json",               "All modules"],
              ["tests/all.json",                 "All tests"],
              ["test_revisions/all.json",         "All revisions (module_tests)"],
              ["step_orders/{revision_id}.json",  "Step order per revision  ←  RPC"],
              ["test_steps/{revision_id}.json",   "Test steps per revision  ←  RPC"],
            ].map(([key, label]) => (
              <div key={key} className="flex items-start gap-2 text-xs">
                <CloudUpload size={12} className="mt-0.5 shrink-0 text-c-brand" />
                <span>
                  <span className="text-t-primary font-medium">{label}</span>
                  <span className="ml-1 text-t-muted font-mono opacity-60">→ {key}</span>
                </span>
              </div>
            ))}
          </div>
          <button onClick={handleConnect}
            className="btn-primary text-sm flex items-center justify-center gap-2">
            <Wifi size={14} /> Test Connection & Continue
          </button>
        </div>
      )}

      {/* ── Connecting ── */}
      {stage === "connecting" && (
        <div className="flex items-center justify-center py-8">
          <div className="w-8 h-8 border-4 border-c-brand border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* ── Ready ── */}
      {stage === "ready" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-green-500/10 border border-green-500/20">
            <Wifi size={14} className="text-green-400" />
            <span className="text-xs text-green-400 font-medium">Worker connected successfully</span>
          </div>
          <div className="rounded-xl border border-(--border-color) bg-bg-card divide-y divide-(--border-color) overflow-hidden">
            {progress.map(p => (
              <div key={p.label} className="flex items-center justify-between px-3 py-2.5 text-xs">
                <span className="text-t-primary">{p.label}</span>
                {p.note && <span className="text-t-muted">{p.note}</span>}
              </div>
            ))}
          </div>
          <button onClick={handleMigrate}
            className="btn-primary text-sm flex items-center justify-center gap-2">
            <CloudUpload size={14} /> Start Migration
          </button>
        </div>
      )}

      {/* ── Migrating ── */}
      {stage === "migrating" && (
        <div className="rounded-xl border border-(--border-color) bg-bg-card divide-y divide-(--border-color) overflow-hidden">
          {progress.map(p => <ProgressRow key={p.label} item={p} />)}
        </div>
      )}

      {/* ── Done ── */}
      {stage === "done" && (
        <div className="flex flex-col items-center gap-3 py-2">
          <CheckCircle size={32} className="text-green-400" />
          <p className="text-sm font-semibold text-t-primary">Migration complete</p>
          <div className="rounded-xl border border-(--border-color) bg-bg-card w-full divide-y divide-(--border-color) overflow-hidden text-xs">
            {summary.map(s => (
              <div key={s.label} className="flex items-center justify-between px-3 py-2">
                <span className="text-t-primary">{s.label}</span>
                <span className="text-t-muted">{s.count} rows</span>
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

      {/* ── Error ── */}
      {stage === "error" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2 px-3 py-3 rounded-xl bg-red-500/10 border border-red-500/20">
            <WifiOff size={14} className="text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs text-red-400 break-all">{error}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={onBack} className="flex-1 btn-ghost text-sm">Back</button>
            <button
              onClick={() => { setStage("connect"); setError(null); setProgress(INITIAL_STEPS) }}
              className="flex-1 btn-primary text-sm">
              Retry
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  )
}

export default R2MigrationModal