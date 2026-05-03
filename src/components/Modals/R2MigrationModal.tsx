// src/components/Modals/R2MigrationModal.tsx
const WORKER_URL = "https://shrill-thunder-6fdf.rehnab-rk.workers.dev"

import React, { useState, useEffect, useCallback } from "react"
import {
  Database, ArrowLeft, CheckCircle, CloudUpload, Eye,
  Package, FlaskConical, ListOrdered, Layers, AlertCircle,
  Square, CheckSquare, ChevronDown, ChevronUp, GitBranch,
  Trash2, RefreshCw, CheckSquare2, MinusSquare,
  ShieldCheck, Diff, Hash, Rows, Zap, AlertTriangle,
  ArrowRight, RotateCcw,
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
  | "validate"
  | "validate_revisions"

type Stage =
  | "selecttype"
  | "selectrevisions"
  | "uploading"
  | "deleting"
  | "done"
  | "reader"
  | "error"
  | "validating"
  | "validation_done"
  | "selectrevisions_validate"
  | "validating_revisions"
  | "revision_validation_done"

type R2FileStatus = "unknown" | "checking" | "exists" | "missing"

type SyncStatus =
  | "unknown"
  | "checking_r2"
  | "checking_db"
  | "in_sync"
  | "count_mismatch"
  | "id_mismatch"
  | "missing_r2"
  | "error"

interface ValidationEntry {
  key:      string
  label:    string
  table:    string
  pkField:  string
  icon:     React.ReactNode
  r2Data:   Record<string, unknown>[] | null
  r2Count:  number | null
  r2Ids:    Set<string> | null
  dbCount:  number | null
  dbIds:    Set<string> | null
  diff:     { added: string[]; removed: string[]; modified: string[] } | null
  tier2:    "idle" | "running" | "done" | "error"
  status:   SyncStatus
  error?:   string
}

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

type RevValSubStatus =
  | "pending"
  | "running"
  | "ok"
  | "count_mismatch"
  | "missing_r2"
  | "deep_diff_running"
  | "deep_diff_ok"
  | "deep_diff_failed"
  | "error"

interface RevisionValidationItem {
  revId:     string
  revision:  string
  sno:       number
  soStatus:  RevValSubStatus
  soR2Count: number | null
  soDbCount: number | null
  soError?:  string
  tsStatus:  RevValSubStatus
  tsR2Count: number | null
  tsDbCount: number | null
  tsError?:  string
}

const TIER2_CHUNK_SIZE = 50

// ── Validation targets ────────────────────────────────────────────────────────
const VALIDATION_TARGETS: Pick<ValidationEntry, "key" | "label" | "table" | "pkField" | "icon">[] = [
  { key: "modules/all.json",   label: "Modules",   table: "modules",        pkField: "id", icon: <Package size={15} /> },
  { key: "tests/all.json",     label: "Tests",     table: "tests",          pkField: "id", icon: <FlaskConical size={15} /> },
  { key: "revisions/all.json", label: "Revisions", table: "test_revisions", pkField: "id", icon: <GitBranch size={15} /> },
]

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
  try { await r2Read(token, key); return true } catch { return false }
}

// ── Chunked Tier-2 deep diff ──────────────────────────────────────────────────
// Fetches DB rows in pages of TIER2_CHUNK_SIZE. Stops as soon as a mismatch is
// found — never reads more rows than necessary.
async function chunkedDeepDiff(
  r2Rows: Record<string, unknown>[],
  table: string,
  filterCol: string,
  filterVal: number,
): Promise<{ result: "ok" | "failed"; detail?: string }> {
  const r2Map = new Map(r2Rows.map(r => [String(r["id"]), JSON.stringify(r)]))
  const seen  = new Set<string>()
  let offset  = 0

  while (offset < r2Rows.length) {
    const { data: chunk, error: ce } = await supabase
      .from(table)
      .select("*")
      .eq(filterCol, filterVal)
      .order("serial_no")
      .range(offset, offset + TIER2_CHUNK_SIZE - 1)

    if (ce) return { result: "failed", detail: ce.message }
    if (!chunk || chunk.length === 0) break

    for (const row of chunk) {
      const id  = String((row as any).id)
      seen.add(id)
      const r2Val = r2Map.get(id)
      if (!r2Val)                          return { result: "failed", detail: `Row ${id} in DB but not in R2` }
      if (r2Val !== JSON.stringify(row))   return { result: "failed", detail: `Row ${id} values differ` }
    }

    if (chunk.length < TIER2_CHUNK_SIZE) break
    offset += TIER2_CHUNK_SIZE
  }

  for (const id of r2Map.keys()) {
    if (!seen.has(id)) return { result: "failed", detail: `Row ${id} in R2 but not in DB` }
  }

  return { result: "ok" }
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
  if (status === "unknown")   return null
  if (status === "checking")  return (
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

// ── Revision Validation Row ───────────────────────────────────────────────────
function RevisionValidationRow({ item }: { item: RevisionValidationItem }) {
  const pill = (
    status: RevValSubStatus,
    r2: number | null,
    db: number | null,
    label: string,
    err?: string,
  ) => {
    const colors: Record<RevValSubStatus, string> = {
      pending:          "text-t-muted bg-bg-card border-(--border-color)",
      running:          "text-c-brand bg-c-brand/10 border-c-brand/20",
      ok:               "text-green-400 bg-green-500/10 border-green-500/20",
      count_mismatch:   "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
      missing_r2:       "text-red-400 bg-red-500/10 border-red-500/20",
      deep_diff_running:"text-c-brand bg-c-brand/10 border-c-brand/20",
      deep_diff_ok:     "text-green-400 bg-green-500/10 border-green-500/20",
      deep_diff_failed: "text-orange-400 bg-orange-500/10 border-orange-500/20",
      error:            "text-red-400 bg-red-500/10 border-red-500/20",
    }
    const labelMap: Record<RevValSubStatus, string> = {
      pending:           label,
      running:           label + "…",
      ok:                "✓ " + label,
      count_mismatch:    "⚠ " + label,
      missing_r2:        "✗ " + label,
      deep_diff_running: label + " diff…",
      deep_diff_ok:      "✓ " + label + " exact",
      deep_diff_failed:  "✗ " + label + " diff",
      error:             "! " + label,
    }
    return (
      <span
        className={`flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${colors[status]}`}
        title={err}
      >
        {(status === "running" || status === "deep_diff_running") && (
          <div className="w-2 h-2 border border-current border-t-transparent rounded-full animate-spin" />
        )}
        {labelMap[status]}
        {r2 !== null && db !== null && status === "count_mismatch" && (
          <span className="font-mono opacity-80 ml-0.5">R2:{r2} DB:{db}</span>
        )}
        {(status === "ok" || status === "deep_diff_ok") && r2 !== null && (
          <span className="font-mono opacity-60 ml-0.5">{r2}</span>
        )}
      </span>
    )
  }

  return (
    <div className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-xs transition-all
      ${
        item.soStatus === "missing_r2"      || item.tsStatus === "missing_r2"      ? "border-red-500/20 bg-red-500/5" :
        item.soStatus === "deep_diff_failed"|| item.tsStatus === "deep_diff_failed" ? "border-orange-500/20 bg-orange-500/5" :
        item.soStatus === "count_mismatch"  || item.tsStatus === "count_mismatch"  ? "border-yellow-500/20 bg-yellow-500/5" :
        item.soStatus === "error"           || item.tsStatus === "error"           ? "border-red-500/20 bg-red-500/5" :
        item.soStatus === "deep_diff_ok"    && item.tsStatus === "deep_diff_ok"    ? "border-green-500/20 bg-green-500/5" :
        item.soStatus === "ok"              && item.tsStatus === "ok"              ? "border-green-500/20 bg-green-500/5" :
        "border-(--border-color) bg-bg-card"
      }`}
    >
      <span className="font-mono text-t-muted text-[10px] shrink-0 w-5 text-right">{item.sno}</span>
      <span className="flex-1 truncate text-t-primary font-medium text-xs">
        {item.revision || item.revId.slice(0, 12)}
      </span>
      {pill(item.soStatus, item.soR2Count, item.soDbCount, "SO", item.soError)}
      {pill(item.tsStatus, item.tsR2Count, item.tsDbCount, "TS", item.tsError)}
    </div>
  )
}

// ── Validation Card ───────────────────────────────────────────────────────────
function ValidationCard({
  entry,
  onDeepDiff,
  onSyncNow,
}: {
  entry:       ValidationEntry
  onDeepDiff:  () => void
  onSyncNow:   () => void
}) {
  const [expanded, setExpanded] = useState(false)

  const statusConfig: Record<SyncStatus, {
    badge:    string
    badgeBg:  string
    dot:      string
    label:    string
  }> = {
    unknown:         { badge: "text-t-muted",    badgeBg: "bg-bg-card",          dot: "bg-t-muted",    label: "Not checked" },
    checking_r2:     { badge: "text-c-brand",    badgeBg: "bg-c-brand/10",       dot: "bg-c-brand",    label: "Fetching R2…" },
    checking_db:     { badge: "text-c-brand",    badgeBg: "bg-c-brand/10",       dot: "bg-c-brand",    label: "Querying DB…" },
    in_sync:         { badge: "text-green-400",  badgeBg: "bg-green-500/10",     dot: "bg-green-400",  label: "In sync" },
    count_mismatch:  { badge: "text-yellow-400", badgeBg: "bg-yellow-500/10",    dot: "bg-yellow-400", label: "Count drift" },
    id_mismatch:     { badge: "text-orange-400", badgeBg: "bg-orange-500/10",    dot: "bg-orange-400", label: "ID mismatch" },
    missing_r2:      { badge: "text-red-400",    badgeBg: "bg-red-500/10",       dot: "bg-red-400",    label: "Missing in R2" },
    error:           { badge: "text-red-400",    badgeBg: "bg-red-500/10",       dot: "bg-red-400",    label: "Error" },
  }

  const cfg        = statusConfig[entry.status]
  const isChecking = entry.status === "checking_r2" || entry.status === "checking_db"
  const isDrifted  = entry.status === "count_mismatch" || entry.status === "id_mismatch"
  const isMissing  = entry.status === "missing_r2"
  const isInSync   = entry.status === "in_sync"

  return (
    <div className={`rounded-xl border overflow-hidden transition-all
      ${isMissing  ? "border-red-500/20 bg-red-500/5" :
        isDrifted  ? "border-yellow-500/20 bg-yellow-500/5" :
        isInSync   ? "border-green-500/20 bg-green-500/5" :
        "border-(--border-color) bg-bg-card"}`}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        <span className="text-t-muted shrink-0">{entry.icon}</span>
        <span className="text-sm font-semibold text-t-primary flex-1">{entry.label}</span>

        <div className="flex items-center gap-1 text-[10px] font-mono">
          {entry.r2Count !== null ? (
            <span className="px-1.5 py-0.5 rounded-md bg-c-brand/10 text-c-brand border border-c-brand/20">
              R2 {entry.r2Count}
            </span>
          ) : isChecking && entry.status === "checking_r2" ? (
            <span className="px-1.5 py-0.5 rounded-md bg-c-brand/10 text-c-brand border border-c-brand/20 flex items-center gap-1">
              <div className="w-2 h-2 border border-c-brand border-t-transparent rounded-full animate-spin" />
              R2
            </span>
          ) : null}

          {entry.dbCount !== null ? (
            <span className={`px-1.5 py-0.5 rounded-md border
              ${entry.dbCount !== entry.r2Count
                ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
                : "bg-bg-base text-t-muted border-(--border-color)"}`}>
              DB {entry.dbCount}
            </span>
          ) : isChecking && entry.status === "checking_db" ? (
            <span className="px-1.5 py-0.5 rounded-md bg-bg-base text-t-muted border-(--border-color) flex items-center gap-1">
              <div className="w-2 h-2 border border-t-muted border-t-transparent rounded-full animate-spin" />
              DB
            </span>
          ) : null}
        </div>

        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${cfg.badge} ${cfg.badgeBg}`}>
          {isChecking
            ? <span className="flex items-center gap-1">
                <div className={`w-2 h-2 border ${entry.status === "checking_r2" ? "border-c-brand" : "border-t-muted"} border-t-transparent rounded-full animate-spin`} />
                {cfg.label}
              </span>
            : cfg.label
          }
        </span>
      </div>

      {!isChecking && entry.status !== "unknown" && (
        <div className="px-3 pb-2.5 flex flex-wrap items-center gap-2 border-t border-(--border-color)/50">

          {isInSync && (
            <span className="text-xs text-t-muted flex items-center gap-1 mr-auto">
              <Hash size={10} /> {entry.r2Count} rows · all IDs match
            </span>
          )}

          {entry.status === "count_mismatch" && entry.r2Count !== null && entry.dbCount !== null && (
            <span className="text-xs text-yellow-400 flex items-center gap-1 mr-auto">
              <AlertTriangle size={10} />
              {entry.dbCount > entry.r2Count
                ? `DB has ${entry.dbCount - entry.r2Count} more rows than R2`
                : `R2 has ${entry.r2Count - entry.dbCount} stale rows`}
            </span>
          )}

          {entry.status === "id_mismatch" && (
            <span className="text-xs text-orange-400 flex items-center gap-1 mr-auto">
              <AlertTriangle size={10} /> Same count but IDs differ — rows replaced or swapped
            </span>
          )}

          {isMissing && (
            <span className="text-xs text-red-400 flex items-center gap-1 mr-auto">
              <AlertCircle size={10} /> Key not found in R2
            </span>
          )}

          {entry.status === "error" && (
            <span className="text-xs text-red-400 flex items-center gap-1 mr-auto truncate">
              <AlertCircle size={10} /> {entry.error || "Unknown error"}
            </span>
          )}

          {(isInSync || isDrifted) && entry.r2Data && (
            <>
              {entry.tier2 === "idle" && (
                <button
                  onClick={onDeepDiff}
                  className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg
                    bg-bg-base hover:bg-bg-card text-t-muted hover:text-t-primary border border-(--border-color) transition-colors"
                >
                  <Diff size={10} /> Deep diff
                </button>
              )}

              {entry.tier2 === "running" && (
                <span className="flex items-center gap-1 text-[10px] text-c-brand">
                  <div className="w-3 h-3 border border-c-brand border-t-transparent rounded-full animate-spin" />
                  Comparing rows…
                </span>
              )}

              {entry.tier2 === "done" && entry.diff && (
                <div className="w-full mt-1">
                  <button
                    onClick={() => setExpanded(e => !e)}
                    className="flex items-center gap-1.5 text-[10px] text-t-muted hover:text-t-primary transition-colors"
                  >
                    {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                    Deep diff:
                    {entry.diff.added.length > 0    && <span className="text-green-400 font-bold">+{entry.diff.added.length} added</span>}
                    {entry.diff.removed.length > 0  && <span className="text-red-400 font-bold">−{entry.diff.removed.length} removed</span>}
                    {entry.diff.modified.length > 0 && <span className="text-yellow-400 font-bold">~{entry.diff.modified.length} modified</span>}
                    {entry.diff.added.length === 0 && entry.diff.removed.length === 0 && entry.diff.modified.length === 0 && (
                      <span className="text-green-400 font-bold">all rows identical</span>
                    )}
                  </button>
                  {expanded && (
                    <div className="mt-1.5 flex flex-col gap-1 max-h-32 overflow-y-auto">
                      {entry.diff.added.map(id => (
                        <div key={id} className="flex items-center gap-1.5 text-[10px] font-mono text-green-400 bg-green-500/5 px-2 py-1 rounded-lg">
                          <span className="font-bold">+</span> {id} <span className="text-t-muted ml-auto">in DB, not in R2</span>
                        </div>
                      ))}
                      {entry.diff.removed.map(id => (
                        <div key={id} className="flex items-center gap-1.5 text-[10px] font-mono text-red-400 bg-red-500/5 px-2 py-1 rounded-lg">
                          <span className="font-bold">−</span> {id} <span className="text-t-muted ml-auto">in R2, not in DB</span>
                        </div>
                      ))}
                      {entry.diff.modified.map(id => (
                        <div key={id} className="flex items-center gap-1.5 text-[10px] font-mono text-yellow-400 bg-yellow-500/5 px-2 py-1 rounded-lg">
                          <span className="font-bold">~</span> {id} <span className="text-t-muted ml-auto">values differ</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {(isDrifted || isMissing) && (
            <button
              onClick={onSyncNow}
              className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-lg ml-auto
                bg-c-brand/10 hover:bg-c-brand/20 text-c-brand border border-c-brand/20 transition-colors"
            >
              <CloudUpload size={10} /> Upload to sync
              <ArrowRight size={9} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Migration type definitions ────────────────────────────────────────────────
const TYPE_META: {
  id:       MigrationType
  label:    string
  icon:     React.ReactNode
  desc:     string
  flow:     "direct" | "revision" | "delete_revision" | "reader" | "validate" | "validate_revisions"
  danger?:  boolean
  group:    "sync" | "manage" | "util"
}[] = [
  {
    id:    "validate",
    label: "Validate",
    icon:  <ShieldCheck size={18} />,
    desc:  "Compare R2 snapshots vs live Supabase — tiered, zero-waste checks",
    flow:  "validate",
    group: "sync",
  },
  {
    id:    "validate_revisions",
    label: "Validate Step/Steps",
    icon:  <ShieldCheck size={18} />,
    desc:  "Per-revision R2 vs DB check for step_orders & test_steps — chunked Tier-2 diff",
    flow:  "validate_revisions",
    group: "sync",
  },
  {
    id:    "modules",
    label: "Modules",
    icon:  <Package size={18} />,
    desc:  "Upload all modules → modules/all.json",
    flow:  "direct",
    group: "sync",
  },
  {
    id:    "tests",
    label: "Tests",
    icon:  <FlaskConical size={18} />,
    desc:  "Upload all tests → tests/all.json",
    flow:  "direct",
    group: "sync",
  },
  {
    id:    "revisions",
    label: "Revisions",
    icon:  <GitBranch size={18} />,
    desc:  "Upload all test revisions → revisions/all.json",
    flow:  "direct",
    group: "sync",
  },
  {
    id:    "step_orders",
    label: "Step Orders",
    icon:  <ListOrdered size={18} />,
    desc:  "Upload step_order per revision → step_orders/{id}.json",
    flow:  "revision",
    group: "manage",
  },
  {
    id:    "test_steps",
    label: "Test Steps",
    icon:  <Layers size={18} />,
    desc:  "Upload test_steps per revision → test_steps/{id}.json",
    flow:  "revision",
    group: "manage",
  },
  {
    id:     "delete_step_orders",
    label:  "Delete Step Orders",
    icon:   <Trash2 size={18} />,
    desc:   "Delete step_orders/{id}.json files from R2",
    flow:   "delete_revision",
    danger: true,
    group:  "util",
  },
  {
    id:     "delete_test_steps",
    label:  "Delete Test Steps",
    icon:   <Trash2 size={18} />,
    desc:   "Delete test_steps/{id}.json files from R2",
    flow:   "delete_revision",
    danger: true,
    group:  "util",
  },
  {
    id:    "reader",
    label: "Read from R2",
    icon:  <Eye size={18} />,
    desc:  "Fetch any R2 key and inspect its JSON",
    flow:  "reader",
    group: "util",
  },
]

// ── Component ─────────────────────────────────────────────────────────────────
interface Props { onClose: () => void; onBack: () => void }

const R2MigrationModal: React.FC<Props> = ({ onClose, onBack }) => {
  const [stage,              setStage]              = useState<Stage>("selecttype")
  const [migrType,           setMigrType]           = useState<MigrationType | null>(null)
  const [revisions,          setRevisions]          = useState<TestRevision[]>([])
  const [selected,           setSelected]           = useState<Set<string>>(new Set())
  const [revLoading,         setRevLoading]         = useState(false)
  const [progress,           setProgress]           = useState<ProgressItem[]>([])
  const [summary,            setSummary]            = useState<{ label: string; count: number }[]>([])
  const [error,              setError]              = useState<string | null>(null)
  const [readerKey,          setReaderKey]          = useState("")
  const [readerData,         setReaderData]         = useState<unknown>(null)
  const [readerLoading,      setReaderLoading]      = useState(false)
  const [readerError,        setReaderError]        = useState<string | null>(null)
  const [showFull,           setShowFull]           = useState(false)
  const [r2Status,           setR2Status]           = useState<Map<string, R2FileStatus>>(new Map())
  const [checkingAll,        setCheckingAll]        = useState(false)
  const [validationEntries,  setValidationEntries]  = useState<ValidationEntry[]>([])
  const [validationError,    setValidationError]    = useState<string | null>(null)
  const [revValSelected,     setRevValSelected]     = useState<Set<string>>(new Set())
  const [revValidation,      setRevValidation]      = useState<RevisionValidationItem[]>([])

  const subtitle: Record<Stage, string> = {
    selecttype:               "Choose operation",
    selectrevisions:          "Select revisions",
    uploading:                "Uploading…",
    deleting:                 "Deleting…",
    done:                     "Done",
    reader:                   "R2 Reader",
    error:                    "Something went wrong",
    validating:               "Validating…",
    validation_done:          "Validation complete",
    selectrevisions_validate: "Select revisions to validate",
    validating_revisions:     "Validating revisions…",
    revision_validation_done: "Revision validation complete",
  }

  const r2Prefix = (mt: MigrationType | null): string => {
    if (mt === "step_orders" || mt === "delete_step_orders") return "step_orders"
    if (mt === "test_steps"  || mt === "delete_test_steps")  return "test_steps"
    return ""
  }

  // ── Load revisions (upload flow) ────────────────────────────────────────────
  useEffect(() => {
    if (stage !== "selectrevisions") return
    setRevLoading(true)
    setSelected(new Set())
    setR2Status(new Map())
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

  // ── Load revisions (validate flow) ─────────────────────────────────────────
  useEffect(() => {
    if (stage !== "selectrevisions_validate") return
    setRevLoading(true)
    setRevValSelected(new Set())
    setRevValidation([])
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

  const patchEntry = (idx: number, changes: Partial<ValidationEntry>) =>
    setValidationEntries(prev => prev.map((e, i) => i === idx ? { ...e, ...changes } : e))

  // ── R2 check helpers ────────────────────────────────────────────────────────
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

  const checkAll = useCallback(async () => {
    if (!revisions.length) return
    setCheckingAll(true)
    const prefix = r2Prefix(migrType)
    if (!prefix) { setCheckingAll(false); return }
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

  const selectMissing  = useCallback(() => setSelected(new Set(revisions.filter(r => r2Status.get(r.id) === "missing").map(r => r.id))),  [revisions, r2Status])
  const selectExisting = useCallback(() => setSelected(new Set(revisions.filter(r => r2Status.get(r.id) === "exists").map(r => r.id))),   [revisions, r2Status])

  // ── Type select ──────────────────────────────────────────────────────────────
  const handleTypeSelect = (t: MigrationType) => {
    setMigrType(t)
    setError(null)
    const meta = TYPE_META.find(m => m.id === t)
    if (meta?.flow === "reader")             { setStage("reader");                   return }
    if (meta?.flow === "validate")           { handleValidate();                     return }
    if (meta?.flow === "validate_revisions") { setStage("selectrevisions_validate"); return }
    if (meta?.flow === "revision")           { setStage("selectrevisions");          return }
    if (meta?.flow === "delete_revision")    { setStage("selectrevisions");          return }
    handleDirectUpload(t)
  }

  // ── Direct upload ──────────────────────────────────────────────────────────
  const handleDirectUpload = async (t: MigrationType) => {
    setStage("uploading")
    const labelMap: Partial<Record<MigrationType, string>> = {
      modules: "Modules", tests: "Tests", revisions: "Revisions",
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
        const { data, error: e } = await supabase.from("test_revisions").select("*").order("tests_serial_no")
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
    setProgress(chosenRevs.map(r => ({ label: `${label} — ${r.revision || r.id.slice(0, 8)}`, status: "pending" as const })))
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
            const { data: steps, error: se } = await supabase.from("test_steps").select("id").eq("tests_serial_no", rev.tests_serial_no).order("serial_no")
            if (se) throw new Error(se.message)
            order = (steps ?? []).map((s: any) => s.id)
          }
          await r2Write(token, `step_orders/${rev.id}.json`, order)
          patch(rowLabel, { status: "done", count: order.length })
          done.push({ label: rowLabel, count: order.length })
        } else {
          const { data: steps, error: se } = await supabase.from("test_steps").select("*").eq("tests_serial_no", rev.tests_serial_no).order("serial_no")
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
    const prefix = r2Prefix(migrType)
    const label  = migrType === "delete_step_orders" ? "Delete Step Order" : "Delete Test Steps"
    setProgress(chosenRevs.map(r => ({ label: `${label} — ${r.revision || r.id.slice(0, 8)}`, status: "pending" as const })))
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

  // ── 3-Tier Validation (modules / tests / revisions) ────────────────────────
  //
  //  Tier 0  → R2 full fetch (parallel)
  //  Tier 1  → Supabase COUNT only (HEAD)
  //  Tier 1.5→ Supabase PKs only
  //  Tier 2  → Full row diff (on-demand via "Deep diff" button)
  //
  const handleValidate = async () => {
    setStage("validating")
    setValidationError(null)

    const entries: ValidationEntry[] = VALIDATION_TARGETS.map(t => ({
      ...t,
      r2Data:  null,
      r2Count: null,
      r2Ids:   null,
      dbCount: null,
      dbIds:   null,
      diff:    null,
      tier2:   "idle",
      status:  "checking_r2",
    }))
    setValidationEntries([...entries])

    let token: string
    try { token = await getToken() }
    catch (e: any) { setValidationError(e.message); setStage("error"); return }

    await Promise.all(entries.map(async (_, i) => {
      try {
        const data = await r2Read(token, entries[i].key)
        const arr  = Array.isArray(data) ? data as Record<string, unknown>[] : []
        entries[i] = {
          ...entries[i],
          r2Data:  arr,
          r2Count: arr.length,
          r2Ids:   new Set(arr.map(r => String(r[entries[i].pkField]))),
          status:  "checking_db",
        }
      } catch {
        entries[i] = { ...entries[i], status: "missing_r2" }
      }
      setValidationEntries([...entries])
    }))

    await Promise.all(entries.map(async (_, i) => {
      if (entries[i].status !== "checking_db") return
      try {
        const { count, error: ce } = await supabase
          .from(entries[i].table)
          .select("*", { count: "exact", head: true })
        if (ce) throw new Error(ce.message)

        entries[i] = { ...entries[i], dbCount: count ?? 0 }

        if ((count ?? 0) !== entries[i].r2Count) {
          entries[i] = { ...entries[i], status: "count_mismatch" }
          setValidationEntries([...entries])
          return
        }

        const { data: pkRows, error: pe } = await supabase
          .from(entries[i].table)
          .select(entries[i].pkField)
        if (pe) throw new Error(pe.message)

        const dbIds = new Set((pkRows ?? []).map((r: any) => String(r[entries[i].pkField])))
        entries[i] = { ...entries[i], dbIds }

        const r2Ids       = entries[i].r2Ids!
        const extraInDb   = [...dbIds].filter(id => !r2Ids.has(id))
        const missingInDb = [...r2Ids].filter(id => !dbIds.has(id))

        entries[i] = {
          ...entries[i],
          status: (extraInDb.length > 0 || missingInDb.length > 0) ? "id_mismatch" : "in_sync",
        }
      } catch (e: any) {
        entries[i] = { ...entries[i], status: "error", error: e.message }
      }
      setValidationEntries([...entries])
    }))

    setStage("validation_done")
  }

  // ── Tier 2: Full row comparison (on demand, for bulk validation) ───────────
  const handleTier2 = async (idx: number) => {
    const entry = validationEntries[idx]
    if (!entry.r2Data) return
    patchEntry(idx, { tier2: "running" })
    try {
      const { data: fullRows, error: fe } = await supabase.from(entry.table).select("*")
      if (fe) throw new Error(fe.message)

      const r2Map = new Map(entry.r2Data.map(r => [String(r[entry.pkField]), JSON.stringify(r)]))
      const dbMap = new Map((fullRows ?? []).map((r: any) => [String(r[entry.pkField]), JSON.stringify(r)]))

      const added    = [...dbMap.keys()].filter(k => !r2Map.has(k))
      const removed  = [...r2Map.keys()].filter(k => !dbMap.has(k))
      const modified = [...r2Map.keys()].filter(k => dbMap.has(k) && r2Map.get(k) !== dbMap.get(k))

      patchEntry(idx, { tier2: "done", diff: { added, removed, modified } })
    } catch (e: any) {
      patchEntry(idx, { tier2: "error", error: e.message })
    }
  }

  // ── Trigger upload for a drifted bulk validation entry ────────────────────
  const handleSyncFromValidation = (entry: ValidationEntry) => {
    const map: Partial<Record<string, MigrationType>> = {
      "modules/all.json":   "modules",
      "tests/all.json":     "tests",
      "revisions/all.json": "revisions",
    }
    const t = map[entry.key]
    if (!t) return
    setMigrType(t as MigrationType)
    handleDirectUpload(t as MigrationType)
  }

  // ── Per-revision validation (step_orders + test_steps) ────────────────────
  //
  //  Sequential — one revision at a time, same pattern as upload migration.
  //  SO: array comparison (order matters).
  //  TS: COUNT check first; if counts match → chunked Tier-2 diff, fail-fast.
  //
  const handleValidateRevisions = async () => {
    const chosenRevs = revisions.filter(r => revValSelected.has(r.id))
    if (!chosenRevs.length) return

    setStage("validating_revisions")
    setValidationError(null)

    let token: string
    try { token = await getToken() }
    catch (e: any) { setValidationError(e.message); setStage("error"); return }

    const items: RevisionValidationItem[] = chosenRevs.map(r => ({
      revId: r.id, revision: r.revision, sno: r.tests_serial_no,
      soStatus: "pending", soR2Count: null, soDbCount: null,
      tsStatus: "pending", tsR2Count: null, tsDbCount: null,
    }))
    setRevValidation([...items])

    for (let i = 0; i < chosenRevs.length; i++) {
      const rev = chosenRevs[i]

      // ── step_order ──────────────────────────────────────────────────────────
      items[i] = { ...items[i], soStatus: "running" }
      setRevValidation([...items])
      try {
        const soData = await r2Read(token, `step_orders/${rev.id}.json`)
        const soR2: string[] = Array.isArray(soData) ? soData : []

        let soDb: string[]
        if (rev.step_order && rev.step_order.length > 0) {
          soDb = rev.step_order
        } else {
          const { data: steps, error: se } = await supabase
            .from("test_steps")
            .select("id")
            .eq("tests_serial_no", rev.tests_serial_no)
            .order("serial_no")
          if (se) throw new Error(se.message)
          soDb = (steps ?? []).map((s: any) => s.id)
        }

        const soR2Count = soR2.length
        const soDbCount = soDb.length

        if (soR2Count !== soDbCount) {
          items[i] = { ...items[i], soStatus: "count_mismatch", soR2Count, soDbCount }
        } else {
          const mismatch = soR2.some((id, idx) => id !== soDb[idx])
          items[i] = { ...items[i], soStatus: mismatch ? "count_mismatch" : "ok", soR2Count, soDbCount }
        }
      } catch (e: any) {
        const msg = String(e.message ?? "")
        items[i] = {
          ...items[i],
          soStatus: msg.includes("404") || msg.toLowerCase().includes("not found") ? "missing_r2" : "error",
          soError:  msg,
        }
      }
      setRevValidation([...items])

      // ── test_steps ──────────────────────────────────────────────────────────
      items[i] = { ...items[i], tsStatus: "running" }
      setRevValidation([...items])
      try {
        const tsData = await r2Read(token, `test_steps/${rev.id}.json`)
        const tsR2: Record<string, unknown>[] = Array.isArray(tsData) ? tsData : []
        const tsR2Count = tsR2.length

        const { count, error: ce } = await supabase
          .from("test_steps")
          .select("*", { count: "exact", head: true })
          .eq("tests_serial_no", rev.tests_serial_no)
        if (ce) throw new Error(ce.message)
        const tsDbCount = count ?? 0

        if (tsR2Count !== tsDbCount) {
          items[i] = { ...items[i], tsStatus: "count_mismatch", tsR2Count, tsDbCount }
        } else {
          // Tier 2 — chunked, fail-fast
          items[i] = { ...items[i], tsStatus: "deep_diff_running", tsR2Count, tsDbCount }
          setRevValidation([...items])

          const { result, detail } = await chunkedDeepDiff(
            tsR2, "test_steps", "tests_serial_no", rev.tests_serial_no,
          )
          items[i] = {
            ...items[i],
            tsStatus: result === "ok" ? "deep_diff_ok" : "deep_diff_failed",
            tsError:  detail,
          }
        }
      } catch (e: any) {
        const msg = String(e.message ?? "")
        items[i] = {
          ...items[i],
          tsStatus: msg.includes("404") || msg.toLowerCase().includes("not found") ? "missing_r2" : "error",
          tsError:  msg,
        }
      }
      setRevValidation([...items])
    }

    setStage("revision_validation_done")
  }

  // ── R2 Reader ──────────────────────────────────────────────────────────────
  const handleRead = async () => {
    if (!readerKey.trim()) return
    setReaderLoading(true)
    setReaderError(null)
    setReaderData(null)
    try {
      const token = await getToken()
      const data  = await r2Read(token, readerKey.trim())
      setReaderData(data)
    } catch (e: any) {
      setReaderError(e.message)
    } finally {
      setReaderLoading(false)
    }
  }

  const handleBack = () => {
    if (stage === "selecttype")                { return onBack() }
    if (stage === "selectrevisions")           { setStage("selecttype"); setSelected(new Set()); setRevisions([]); setR2Status(new Map()) }
    if (stage === "done")                      { setStage("selecttype"); setSummary([]) }
    if (stage === "error")                     { setStage("selecttype"); setError(null); setValidationError(null) }
    if (stage === "reader")                    { setStage("selecttype"); setReaderData(null); setReaderKey("") }
    if (stage === "validating" || stage === "validation_done") {
      setStage("selecttype"); setValidationEntries([]); setValidationError(null)
    }
    if (stage === "selectrevisions_validate")  { setStage("selecttype"); setRevisions([]); setRevValSelected(new Set()) }
    if (stage === "validating_revisions" || stage === "revision_validation_done") {
      setStage("selecttype"); setRevValidation([]); setRevValSelected(new Set())
    }
  }

  const allSelected  = revisions.length > 0 && selected.size === revisions.length
  const noneSelected = selected.size === 0
  const toggleAll    = () => setSelected(allSelected ? new Set() : new Set(revisions.map(r => r.id)))
  const toggleOne    = async (rev: TestRevision) => {
    const next = new Set(selected)
    if (next.has(rev.id)) {
      next.delete(rev.id)
    } else {
      next.add(rev.id)
      if (r2Status.get(rev.id) === "unknown" || !r2Status.has(rev.id)) checkOne(rev)
    }
    setSelected(next)
  }

  const isDeleteFlow = migrType === "delete_step_orders" || migrType === "delete_test_steps"
  const totalRows    = summary.reduce((a, s) => a + s.count, 0)
  const previewJson  = readerData ? JSON.stringify(readerData, null, 2) : ""
  const previewLines = previewJson.split("\n")
  const isLong       = previewLines.length > 30

  const checkedCount = [...r2Status.values()].filter(s => s !== "unknown" && s !== "checking").length
  const existsCount  = [...r2Status.values()].filter(s => s === "exists").length
  const missingCount = [...r2Status.values()].filter(s => s === "missing").length

  const inSyncCount = validationEntries.filter(e => e.status === "in_sync").length
  const driftCount  = validationEntries.filter(e => e.status === "count_mismatch" || e.status === "id_mismatch" || e.status === "missing_r2").length

  const syncTypes   = TYPE_META.filter(m => m.group === "sync")
  const manageTypes = TYPE_META.filter(m => m.group === "manage")
  const utilTypes   = TYPE_META.filter(m => m.group === "util")

  // ── Revision validation summary counts ────────────────────────────────────
  const rvTotal    = revValidation.length
  const rvSoOk     = revValidation.filter(r => r.soStatus === "ok").length
  const rvTsOk     = revValidation.filter(r => r.tsStatus === "deep_diff_ok" || r.tsStatus === "ok").length
  const rvSoIssues = rvTotal - rvSoOk
  const rvTsIssues = rvTotal - rvTsOk
  const rvAllGood  = rvSoIssues === 0 && rvTsIssues === 0

  return (
    <ModalShell
      title="R2 Migration"
      icon={<Database size={16} />}
      subtitle={subtitle[stage]}
      onClose={onClose}
    >
      {/* Back */}
      {stage !== "uploading" && stage !== "deleting" && stage !== "validating" && stage !== "validating_revisions" && (
        <button
          onClick={handleBack}
          className="-mt-2 self-start flex items-center gap-1 text-xs text-t-muted hover:text-t-primary transition-colors"
        >
          <ArrowLeft size={13} /> Back
        </button>
      )}

      {/* ── Select type ── */}
      {stage === "selecttype" && (
        <div className="flex flex-col gap-3">

          <div className="flex flex-col gap-1.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-t-muted px-1">Sync & Validate</p>
            {syncTypes.map(m => (
              <button
                key={m.id}
                onClick={() => handleTypeSelect(m.id)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all
                  ${m.id === "validate" || m.id === "validate_revisions"
                    ? "border-c-brand/30 bg-c-brand/5 hover:bg-c-brand/10"
                    : "border-(--border-color) bg-bg-card hover:bg-bg-base"}`}
              >
                <span className={`shrink-0 ${m.id === "validate" || m.id === "validate_revisions" ? "text-c-brand" : "text-t-muted"}`}>{m.icon}</span>
                <div className="flex-1">
                  <p className={`text-sm font-semibold ${m.id === "validate" || m.id === "validate_revisions" ? "text-c-brand" : "text-t-primary"}`}>{m.label}</p>
                  <p className="text-xs text-t-muted">{m.desc}</p>
                </div>
                {(m.id === "validate" || m.id === "validate_revisions") && <Zap size={12} className="text-c-brand shrink-0 opacity-70" />}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-t-muted px-1">Per-Revision Upload</p>
            {manageTypes.map(m => (
              <button
                key={m.id}
                onClick={() => handleTypeSelect(m.id)}
                className="flex items-center gap-3 px-4 py-3 rounded-xl border border-(--border-color) bg-bg-card hover:bg-bg-base text-left transition-all"
              >
                <span className="shrink-0 text-t-muted">{m.icon}</span>
                <div>
                  <p className="text-sm font-semibold text-t-primary">{m.label}</p>
                  <p className="text-xs text-t-muted">{m.desc}</p>
                </div>
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-t-muted px-1">Utilities</p>
            {utilTypes.map(m => (
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
          </div>

          <p className="text-xs text-t-muted text-center pt-1">
            Run <span className="font-medium text-t-primary">Modules → Tests → Revisions → Step Orders → Test Steps</span> for a full migration.
          </p>
        </div>
      )}

      {/* ── Select revisions (upload / delete flow) ── */}
      {stage === "selectrevisions" && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-t-muted">
            {isDeleteFlow
              ? "Select revisions to delete from R2"
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
              <div className="flex flex-wrap items-center gap-1.5 p-2.5 rounded-xl border border-(--border-color) bg-bg-card">
                <span className="text-[10px] font-semibold text-t-muted uppercase tracking-wider mr-1">Differential</span>
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
                {missingCount > 0 && (
                  <button
                    onClick={selectMissing}
                    className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg
                      bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 border border-yellow-500/20 transition-colors"
                  >
                    <MinusSquare size={10} /> Select missing ({missingCount})
                  </button>
                )}
                {existsCount > 0 && (
                  <button
                    onClick={selectExisting}
                    className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg
                      bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20 transition-colors"
                  >
                    <CheckSquare2 size={10} /> Select existing ({existsCount})
                  </button>
                )}
                {checkedCount > 0 && (
                  <span className="ml-auto text-[10px] text-t-muted">{existsCount} in R2 · {missingCount} missing</span>
                )}
              </div>

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
                      <span className="text-xs text-t-muted shrink-0">{r.revision || `sno:${r.tests_serial_no}`}</span>
                      <R2StatusBadge status={status} />
                      {migrType === "step_orders" && selected.has(r.id) && (
                        <span className={`text-xs shrink-0 ${r.step_order?.length ? "text-green-400" : "text-yellow-400"}`}>
                          {r.step_order?.length ? `${r.step_order.length} local` : "fallback"}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

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

      {/* ── Select revisions (validate flow) ── */}
      {stage === "selectrevisions_validate" && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-t-muted">
            Select which revisions to validate. Each revision's{" "}
            <code className="font-mono text-[10px] bg-bg-card px-1 py-0.5 rounded border border-(--border-color)">step_orders/</code>{" "}
            and{" "}
            <code className="font-mono text-[10px] bg-bg-card px-1 py-0.5 rounded border border-(--border-color)">test_steps/</code>{" "}
            R2 files will be compared against the DB.
          </p>

          {revLoading ? (
            <div className="flex items-center justify-center py-6">
              <div className="w-6 h-6 border-2 border-c-brand border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between px-1">
                <button
                  onClick={() => setRevValSelected(
                    revValSelected.size === revisions.length
                      ? new Set()
                      : new Set(revisions.map(r => r.id))
                  )}
                  className="flex items-center gap-2 text-xs text-t-muted hover:text-t-primary transition-colors"
                >
                  {revValSelected.size === revisions.length
                    ? <CheckSquare size={14} className="text-c-brand" />
                    : revValSelected.size === 0
                    ? <Square size={14} />
                    : <MinusSquare size={14} />}
                  {revValSelected.size === revisions.length ? "Deselect all" : "Select all"} ({revisions.length})
                </button>
                <span className="text-xs text-t-muted">{revValSelected.size} selected</span>
              </div>

              <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                {revisions.map(r => (
                  <button
                    key={r.id}
                    onClick={() => {
                      const next = new Set(revValSelected)
                      next.has(r.id) ? next.delete(r.id) : next.add(r.id)
                      setRevValSelected(next)
                    }}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-left text-sm transition-all
                      ${revValSelected.has(r.id)
                        ? "border-c-brand/40 bg-c-brand/5 text-t-primary"
                        : "border-(--border-color) bg-bg-card text-t-muted hover:bg-bg-base"}`}
                  >
                    {revValSelected.has(r.id)
                      ? <CheckSquare size={14} className="text-c-brand shrink-0" />
                      : <Square size={14} className="shrink-0" />}
                    <span className="flex-1 truncate font-mono text-xs">{r.id}</span>
                    <span className="text-xs text-t-muted shrink-0">{r.revision || `sno:${r.tests_serial_no}`}</span>
                  </button>
                ))}
              </div>

              <button
                onClick={handleValidateRevisions}
                disabled={revValSelected.size === 0}
                className="btn-primary text-sm flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <ShieldCheck size={14} />
                Validate {revValSelected.size} revision{revValSelected.size !== 1 ? "s" : ""}
              </button>
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

      {/* ── Validating (bulk) ── */}
      {stage === "validating" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-c-brand/5 border border-c-brand/15">
            <Zap size={13} className="text-c-brand mt-0.5 shrink-0" />
            <div className="flex flex-col gap-0.5">
              <p className="text-xs font-semibold text-c-brand">3-Tier validation running</p>
              <p className="text-[11px] text-t-muted leading-relaxed">
                R2 fetched in parallel · DB queried by count first, then PKs only · Full rows only if you ask
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {validationEntries.map((entry, i) => (
              <ValidationCard
                key={entry.key}
                entry={entry}
                onDeepDiff={() => handleTier2(i)}
                onSyncNow={() => handleSyncFromValidation(entry)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Validation done (bulk) ── */}
      {stage === "validation_done" && (
        <div className="flex flex-col gap-3">
          <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border
            ${driftCount > 0
              ? "border-yellow-500/20 bg-yellow-500/5"
              : "border-green-500/20 bg-green-500/5"}`}
          >
            {driftCount > 0
              ? <AlertTriangle size={15} className="text-yellow-400 shrink-0" />
              : <CheckCircle   size={15} className="text-green-400  shrink-0" />}
            <div className="flex-1">
              <p className={`text-sm font-semibold ${driftCount > 0 ? "text-yellow-400" : "text-green-400"}`}>
                {driftCount > 0
                  ? `${driftCount} source${driftCount > 1 ? "s" : ""} out of sync`
                  : "All sources in sync"}
              </p>
              <p className="text-xs text-t-muted">
                {inSyncCount}/{validationEntries.length} keys matched · Supabase rows fetched only where needed
              </p>
            </div>
            <button
              onClick={handleValidate}
              className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg
                bg-bg-base hover:bg-bg-card text-t-muted border border-(--border-color) transition-colors shrink-0"
            >
              <RotateCcw size={10} /> Re-run
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {validationEntries.map((entry, i) => (
              <ValidationCard
                key={entry.key}
                entry={entry}
                onDeepDiff={() => handleTier2(i)}
                onSyncNow={() => handleSyncFromValidation(entry)}
              />
            ))}
          </div>

          <div className="flex flex-wrap gap-x-3 gap-y-1 px-1">
            {[
              { icon: <Zap size={9} />,  color: "text-c-brand", label: "Tier 0: R2 fetch (always)" },
              { icon: <Rows size={9} />, color: "text-t-muted", label: "Tier 1: DB count only" },
              { icon: <Hash size={9} />, color: "text-t-muted", label: "Tier 1.5: PKs only" },
              { icon: <Diff size={9} />, color: "text-t-muted", label: "Tier 2: Full rows (on demand)" },
            ].map(l => (
              <span key={l.label} className={`flex items-center gap-1 text-[9px] ${l.color}`}>
                {l.icon} {l.label}
              </span>
            ))}
          </div>

          <div className="flex gap-2">
            <button onClick={() => { setStage("selecttype"); setValidationEntries([]) }} className="flex-1 btn-ghost text-sm">Back</button>
            <button onClick={onClose} className="flex-1 btn-primary text-sm">Close</button>
          </div>
        </div>
      )}

      {/* ── Validating revisions ── */}
      {(stage === "validating_revisions" || stage === "revision_validation_done") && (
        <div className="flex flex-col gap-3">

          {/* Legend (while running) */}
          {stage === "validating_revisions" && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-c-brand/5 border border-c-brand/15">
              <Zap size={13} className="text-c-brand shrink-0" />
              <p className="text-[11px] text-t-muted">
                Sequential per-revision ·{" "}
                <span className="font-semibold text-c-brand">SO</span> = step_orders ·{" "}
                <span className="font-semibold text-c-brand">TS</span> = test_steps · chunked diff ({TIER2_CHUNK_SIZE}/page) · fail-fast
              </p>
            </div>
          )}

          {/* Summary header (when done) */}
          {stage === "revision_validation_done" && (
            <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border
              ${rvAllGood
                ? "border-green-500/20 bg-green-500/5"
                : "border-yellow-500/20 bg-yellow-500/5"}`}
            >
              {rvAllGood
                ? <CheckCircle   size={15} className="text-green-400 shrink-0" />
                : <AlertTriangle size={15} className="text-yellow-400 shrink-0" />}
              <div className="flex-1">
                <p className={`text-sm font-semibold ${rvAllGood ? "text-green-400" : "text-yellow-400"}`}>
                  {rvAllGood
                    ? "All revisions in sync"
                    : `SO: ${rvSoIssues} issue${rvSoIssues !== 1 ? "s" : ""} · TS: ${rvTsIssues} issue${rvTsIssues !== 1 ? "s" : ""}`}
                </p>
                <p className="text-xs text-t-muted">
                  {rvTotal} revisions · {rvSoOk} step_orders ok · {rvTsOk} test_steps ok
                </p>
              </div>
              <button
                onClick={() => { setStage("selectrevisions_validate") }}
                className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg
                  bg-bg-base hover:bg-bg-card text-t-muted border border-(--border-color) transition-colors shrink-0"
              >
                <RotateCcw size={10} /> Re-select
              </button>
            </div>
          )}

          {/* Per-revision rows */}
          <div className="flex flex-col gap-1 max-h-96 overflow-y-auto">
            {revValidation.map(item => (
              <RevisionValidationRow key={item.revId} item={item} />
            ))}
          </div>

          {stage === "revision_validation_done" && (
            <div className="flex gap-2">
              <button
                onClick={() => { setStage("selecttype"); setRevValidation([]); setRevValSelected(new Set()) }}
                className="flex-1 btn-ghost text-sm"
              >
                Back
              </button>
              <button onClick={onClose} className="flex-1 btn-primary text-sm">Close</button>
            </div>
          )}
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
            <button onClick={() => { setStage("selecttype"); setSummary([]) }} className="flex-1 btn-ghost text-sm">Do more</button>
            <button onClick={onClose} className="flex-1 btn-primary text-sm">Close</button>
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {stage === "error" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2 px-3 py-3 rounded-xl bg-red-500/10 border border-red-500/20">
            <AlertCircle size={14} className="text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs text-red-400 break-all">{error || validationError}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={onBack} className="flex-1 btn-ghost text-sm">Back</button>
            <button onClick={() => { setStage("selecttype"); setError(null); setValidationError(null) }} className="flex-1 btn-primary text-sm">Retry</button>
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
                    {showFull ? <><ChevronUp size={12} /> Collapse</> : <><ChevronDown size={12} /> Expand all</>}
                  </button>
                )}
              </div>
              <pre className={`text-xs bg-bg-card border border-(--border-color) rounded-xl p-3
                overflow-auto font-mono text-t-primary
                ${showFull ? "max-h-[60vh]" : "max-h-48"}`}>
                {isLong && !showFull ? previewLines.slice(0, 30).join("\n") + "\n\n…" : previewJson}
              </pre>
            </div>
          )}
        </div>
      )}
    </ModalShell>
  )
}

export default R2MigrationModal
