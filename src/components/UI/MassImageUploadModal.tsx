// src/components/Modals/StepImageUploadModal.tsx
const WORKER_URL = "https://shrill-thunder-6fdf.rehnab-rk.workers.dev"
const IMAGE_PREFIX = "step-images"

import React, { useState, useRef } from "react"
import {
  Images, ArrowLeft, CheckCircle, Upload, AlertCircle,
  GitBranch, Search, X, ImagePlus, Layers, ChevronDown,
} from "lucide-react"
import ModalShell from "../UI/ModalShell"
import { supabase } from "../../supabase"

// ── Types ─────────────────────────────────────────────────────────────────────

type Stage = "selectrevision" | "selectstep" | "upload"

interface Revision {
  id:              string
  revision:        string
  tests_serial_no: number
}

interface StepItem {
  id:              string
  serial_no:       number
  action:          string
  expected_result: string
  is_divider:      boolean
  tests_serial_no: string
}

interface UploadEntry {
  fileName: string
  path:     string
  status:   "pending" | "uploading" | "done" | "error"
  message?: string
}

interface Props {
  onClose: () => void
  onBack:  () => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error("Not logged in")
  return session.access_token
}

async function r2WriteImage(token: string, key: string, file: File): Promise<void> {
  // Convert to base64 for JSON transport — worker must handle write_binary type
  const buffer = await file.arrayBuffer()
  const bytes  = new Uint8Array(buffer)
  let binary   = ""
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  const base64 = btoa(binary)

  const res = await fetch(WORKER_URL, {
    method:  "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      type:        "write_binary",
      key,
      data:        base64,
      contentType: file.type || "image/jpeg",
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any).error || `Worker ${res.status}`)
  }
}

async function fetchRevisionList(): Promise<Revision[]> {
  const { data, error } = await supabase
    .from("test_revisions")
    .select("id, revision, tests_serial_no, status")
    .eq("status", "active")
    .order("tests_serial_no")
  if (error) throw new Error(error.message)
  return (data ?? []) as Revision[]
}

async function fetchStepsForRevision(revisionId: string): Promise<StepItem[]> {
  const { data, error } = await supabase
    .rpc("get_ordered_steps", { p_revision_id: revisionId })
  if (error) throw new Error(error.message)
  return ((data ?? []) as StepItem[]).filter(s => !s.is_divider)
}

function fileExt(file: File): string {
  return file.name.split(".").pop()?.toLowerCase() || "jpg"
}

// ── Sub-components ────────────────────────────────────────────────────────────

function UploadZone({
  label,
  accent,
  entries,
  disabled,
  onFiles,
}: {
  label:    string
  accent:   string  // tailwind color token e.g. "c-brand" or "green-400"
  entries:  UploadEntry[]
  disabled: boolean
  onFiles:  (files: FileList) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  const doneCount  = entries.filter(e => e.status === "done").length
  const errorCount = entries.filter(e => e.status === "error").length
  const busy       = entries.some(e => e.status === "uploading" || e.status === "pending")

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-widest text-t-muted">{label}</p>
        {entries.length > 0 && (
          <span className="text-[10px] text-t-muted">
            {doneCount} done{errorCount > 0 ? ` · ${errorCount} error` : ""}
          </span>
        )}
      </div>

      {/* Drop zone */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={`flex flex-col items-center justify-center gap-2 px-4 py-5 rounded-xl border-2 border-dashed transition-all
          disabled:opacity-40 disabled:cursor-not-allowed
          hover:bg-c-brand/5 border-(--border-color) hover:border-c-brand/40`}
      >
        <ImagePlus size={20} className="text-t-muted" />
        <span className="text-xs text-t-muted">
          {busy ? "Uploading…" : "Click to select images"}
        </span>
        <span className="text-[10px] text-t-muted/60">jpg · png · webp · gif</span>
      </button>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={e => e.target.files?.length && onFiles(e.target.files)}
      />

      {/* Upload list */}
      {entries.length > 0 && (
        <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
          {entries.map(e => (
            <div key={e.path}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[10px] font-mono
                ${e.status === "done"      ? "border-green-500/20 bg-green-500/5 text-green-400" :
                  e.status === "error"     ? "border-red-500/20 bg-red-500/5 text-red-400" :
                  e.status === "uploading" ? "border-c-brand/20 bg-c-brand/5 text-c-brand" :
                  "border-(--border-color) bg-bg-card text-t-muted"}`}
            >
              {e.status === "uploading" && (
                <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin shrink-0" />
              )}
              {e.status === "done"    && <CheckCircle size={11} className="shrink-0" />}
              {e.status === "error"   && <AlertCircle size={11} className="shrink-0" />}
              {e.status === "pending" && <div className="w-3 h-3 rounded-full border border-current shrink-0" />}
              <span className="flex-1 truncate">{e.path.split("/").pop()}</span>
              {e.message && <span className="opacity-70 shrink-0">{e.message}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

const StepImageUploadModal: React.FC<Props> = ({ onClose, onBack }) => {
  const [stage,        setStage]        = useState<Stage>("selectrevision")
  const [revisions,    setRevisions]    = useState<Revision[]>([])
  const [revLoading,   setRevLoading]   = useState(false)
  const [revError,     setRevError]     = useState<string | null>(null)
  const [selRevision,  setSelRevision]  = useState<Revision | null>(null)

  const [steps,        setSteps]        = useState<StepItem[]>([])
  const [stepsLoading, setStepsLoading] = useState(false)
  const [stepsError,   setStepsError]   = useState<string | null>(null)
  const [selStep,      setSelStep]      = useState<StepItem | null>(null)
  const [dropOpen,     setDropOpen]     = useState(false)

  // Per-step image counters (odd = action, even = expected)
  const actionCounterRef   = useRef<number>(1)  // next odd: 1, 3, 5…
  const expectedCounterRef = useRef<number>(2)  // next even: 2, 4, 6…

  const [actionEntries,   setActionEntries]   = useState<UploadEntry[]>([])
  const [expectedEntries, setExpectedEntries] = useState<UploadEntry[]>([])

  const subtitle: Record<Stage, string> = {
    selectrevision: "Select revision",
    selectstep:     "Select step",
    upload:         "Upload images",
  }

  // ── Load revisions ──────────────────────────────────────────────────────────
  const loadRevisions = async () => {
    setRevLoading(true)
    setRevError(null)
    try {
      const data = await fetchRevisionList()
      setRevisions(data)
    } catch (e: any) {
      setRevError(e.message)
    } finally {
      setRevLoading(false)
    }
  }

  // ── Pick revision → load steps ─────────────────────────────────────────────
  const pickRevision = async (rev: Revision) => {
    setSelRevision(rev)
    setStepsLoading(true)
    setStepsError(null)
    setStage("selectstep")
    setSelStep(null)
    setDropOpen(false)
    try {
      const data = await fetchStepsForRevision(rev.id)
      setSteps(data)
    } catch (e: any) {
      setStepsError(e.message)
    } finally {
      setStepsLoading(false)
    }
  }

  // ── Pick step ───────────────────────────────────────────────────────────────
  const pickStep = (step: StepItem) => {
    setSelStep(step)
    setDropOpen(false)
    setActionEntries([])
    setExpectedEntries([])
    actionCounterRef.current   = 1
    expectedCounterRef.current = 2
    setStage("upload")
  }

  // ── Upload handler ──────────────────────────────────────────────────────────
  const handleUpload = async (files: FileList, type: "action" | "expected") => {
    if (!selStep) return

    const arr      = Array.from(files)
    const counter  = type === "action" ? actionCounterRef : expectedCounterRef
    const setEntries = type === "action" ? setActionEntries : setExpectedEntries

    // Build initial entries
    const initial: UploadEntry[] = arr.map((file, i) => {
      const n    = counter.current + i * 2
      const ext  = fileExt(file)
      const path = `${IMAGE_PREFIX}/${selStep.id}_${selStep.serial_no}_${n}.${ext}`
      return { fileName: file.name, path, status: "pending" }
    })

    setEntries(prev => [...prev, ...initial])

    let token: string
    try { token = await getToken() } catch (e: any) {
      setEntries(prev => prev.map(e =>
        initial.find(i => i.path === e.path) ? { ...e, status: "error", message: "Auth failed" } : e
      ))
      return
    }

    for (let i = 0; i < arr.length; i++) {
      const file  = arr[i]
      const entry = initial[i]

      setEntries(prev => prev.map(e =>
        e.path === entry.path ? { ...e, status: "uploading" } : e
      ))

      try {
        await r2WriteImage(token, entry.path, file)
        setEntries(prev => prev.map(e =>
          e.path === entry.path ? { ...e, status: "done", message: "Saved to R2" } : e
        ))
      } catch (err: any) {
        setEntries(prev => prev.map(e =>
          e.path === entry.path ? { ...e, status: "error", message: err.message } : e
        ))
      }
    }

    // Advance counter past used numbers
    counter.current += arr.length * 2
  }

  const handleBack = () => {
    if (stage === "selectrevision") { onBack(); return }
    if (stage === "selectstep")     { setStage("selectrevision"); setSteps([]); setSelRevision(null) }
    if (stage === "upload")         { setStage("selectstep"); setSelStep(null); setActionEntries([]); setExpectedEntries([]) }
  }

  const isUploading =
    actionEntries.some(e => e.status === "uploading" || e.status === "pending") ||
    expectedEntries.some(e => e.status === "uploading" || e.status === "pending")

  return (
    <ModalShell
      title="Step Image Upload"
      icon={<Images size={16} />}
      subtitle={subtitle[stage]}
      onClose={onClose}
    >
      {/* Back */}
      <button onClick={handleBack}
        className="-mt-2 self-start flex items-center gap-1 text-xs text-t-muted hover:text-t-primary transition-colors">
        <ArrowLeft size={13} /> Back
      </button>

      {/* ── Select Revision ── */}
      {stage === "selectrevision" && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-t-muted">
            Select an active test revision to browse its steps.
          </p>

          {revisions.length === 0 && !revLoading && !revError && (
            <button onClick={loadRevisions}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-(--border-color) bg-bg-card hover:bg-bg-base text-sm text-t-muted transition-colors">
              <Search size={13} /> Load Revisions
            </button>
          )}

          {revLoading && (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-c-brand border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {revError && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
              <AlertCircle size={13} className="text-red-400 shrink-0" />
              <span className="text-xs text-red-400">{revError}</span>
            </div>
          )}

          {!revLoading && revisions.length > 0 && (
            <div className="flex flex-col gap-1 max-h-80 overflow-y-auto">
              {revisions.map(r => (
                <button key={r.id} onClick={() => pickRevision(r)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-(--border-color) bg-bg-card hover:bg-bg-base hover:border-c-brand/40 text-left transition-all">
                  <GitBranch size={14} className="text-t-muted shrink-0" />
                  <span className="flex-1 text-sm font-medium text-t-primary truncate">
                    {r.revision || r.id.slice(0, 12)}
                  </span>
                  <span className="text-[10px] font-mono text-t-muted shrink-0">
                    T{String(r.tests_serial_no).padStart(3, "0")}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Select Step ── */}
      {stage === "selectstep" && (
        <div className="flex flex-col gap-3">
          {/* Revision badge */}
          {selRevision && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-c-brand/5 border border-c-brand/15">
              <GitBranch size={12} className="text-c-brand shrink-0" />
              <span className="text-xs font-semibold text-c-brand">{selRevision.revision}</span>
              <span className="text-[10px] text-t-muted ml-auto font-mono">{selRevision.id.slice(0, 12)}…</span>
            </div>
          )}

          {stepsLoading && (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-c-brand border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {stepsError && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
              <AlertCircle size={13} className="text-red-400 shrink-0" />
              <span className="text-xs text-red-400">{stepsError}</span>
            </div>
          )}

          {!stepsLoading && steps.length > 0 && (
            <>
              <p className="text-xs text-t-muted">
                Select a step to upload images for.
              </p>

              {/* Dropdown */}
              <div className="relative">
                <button onClick={() => setDropOpen(o => !o)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-(--border-color) bg-bg-card hover:bg-bg-base text-left transition-all">
                  <Layers size={13} className="text-t-muted shrink-0" />
                  <span className="flex-1 text-sm text-t-primary truncate">
                    {selStep
                      ? `#${selStep.serial_no} — ${selStep.action.slice(0, 48)}${selStep.action.length > 48 ? "…" : ""}`
                      : "Choose a step…"}
                  </span>
                  <ChevronDown size={13} className={`text-t-muted shrink-0 transition-transform ${dropOpen ? "rotate-180" : ""}`} />
                </button>

                {dropOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 z-20 rounded-xl border border-(--border-color) bg-bg-surface shadow-2xl max-h-64 overflow-y-auto">
                    {steps.map(step => (
                      <button key={step.id} onClick={() => pickStep(step)}
                        className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-bg-card transition-colors border-b border-(--border-color) last:border-b-0
                          ${selStep?.id === step.id ? "bg-c-brand/5" : ""}`}>
                        <span className="font-mono text-[10px] text-t-muted shrink-0 mt-0.5 w-6 text-right">
                          {step.serial_no}
                        </span>
                        <span className="text-xs text-t-primary leading-snug line-clamp-2">
                          {step.action}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selStep && (
                <button onClick={() => setStage("upload")}
                  className="btn-primary text-sm flex items-center justify-center gap-2">
                  <ImagePlus size={14} /> Upload for Step #{selStep.serial_no}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Upload ── */}
      {stage === "upload" && selStep && (
        <div className="flex flex-col gap-4">
          {/* Step info */}
          <div className="flex flex-col gap-1.5 px-3 py-2.5 rounded-xl border border-(--border-color) bg-bg-card">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-t-muted">#{selStep.serial_no}</span>
              <GitBranch size={10} className="text-t-muted" />
              <span className="text-[10px] font-mono text-t-muted truncate">{selStep.id}</span>
            </div>
            <p className="text-xs text-t-primary leading-snug line-clamp-2">{selStep.action}</p>
            {selStep.expected_result && (
              <p className="text-[10px] text-t-muted leading-snug line-clamp-1">{selStep.expected_result}</p>
            )}
          </div>

          {/* Naming info */}
          <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-c-brand/5 border border-c-brand/15">
            <span className="text-[10px] text-t-muted leading-relaxed">
              Files saved as{" "}
              <code className="font-mono text-c-brand">
                {`step-images/${selStep.id}_${selStep.serial_no}_N.ext`}
              </code>
              {" "}— odd N = Action · even N = Expected
            </span>
          </div>

          {/* Action upload */}
          <UploadZone
            label="Action Images"
            accent="c-brand"
            entries={actionEntries}
            disabled={isUploading}
            onFiles={files => handleUpload(files, "action")}
          />

          {/* Divider */}
          <div className="border-t border-(--border-color)" />

          {/* Expected upload */}
          <UploadZone
            label="Expected Result Images"
            accent="green-400"
            entries={expectedEntries}
            disabled={isUploading}
            onFiles={files => handleUpload(files, "expected")}
          />

          {/* Change step */}
          <button onClick={() => setStage("selectstep")}
            disabled={isUploading}
            className="text-xs text-t-muted hover:text-t-primary transition-colors self-center disabled:opacity-40">
            ← Change step
          </button>
        </div>
      )}
    </ModalShell>
  )
}

export default StepImageUploadModal