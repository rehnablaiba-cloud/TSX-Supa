// src/components/Modals/ImportStepsManualModal.tsx
import React, { useEffect, useState } from "react";
import { Hash, ArrowLeft, CheckCircle, AlertCircle, Lock } from "lucide-react";
import ModalShell from "../UI/ModalShell";
import { supabase } from "../../supabase";
import {
  r2GetRevisions,
  r2GetStepOrder,
  r2GetTestSteps,
  r2Invalidate,
} from "../../lib/r2";
import type { R2Revision, R2Step } from "../../lib/r2";

// ── R2 write helper ───────────────────────────────────────────────────────────
const WORKER_URL = "https://shrill-thunder-6fdf.rehnab-rk.workers.dev";

async function r2Write(key: string, data: unknown): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");

  const res = await fetch(WORKER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "write", key, data }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? `R2 write failed: ${res.status}`);
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────
type Stage =
  | "loadingRevisions"
  | "selectRevision"
  | "loadingSteps"
  | "selectStep"
  | "edit"
  | "saving"
  | "done"
  | "error";

interface Props { onClose: () => void; onBack: () => void }

// ── Component ─────────────────────────────────────────────────────────────────
const ImportStepsManualModal: React.FC<Props> = ({ onClose, onBack }) => {
  const [stage,        setStage]        = useState<Stage>("loadingRevisions");
  const [revisions,    setRevisions]    = useState<R2Revision[]>([]);
  const [selRevision,  setSelRevision]  = useState<R2Revision | null>(null);
  const [allSteps,     setAllSteps]     = useState<R2Step[]>([]);
  const [stepOrder,    setStepOrder]    = useState<string[]>([]);
  const [original,     setOriginal]     = useState<R2Step | null>(null);
  const [serialNo,     setSerialNo]     = useState("");
  const [action,       setAction]       = useState("");
  const [expected,     setExpected]     = useState("");
  const [isDivider,    setIsDivider]    = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  // ── 1. Load active revisions from R2 ────────────────────────────────────────
  const loadRevisions = async () => {
    setStage("loadingRevisions");
    setError(null);
    try {
      const all = await r2GetRevisions();
      const active = all.filter((r) => r.status === "active");
      setRevisions(active);
      setStage("selectRevision");
    } catch (e: any) {
      setError(e.message ?? "Failed to fetch revisions from R2");
      setStage("error");
    }
  };

  useEffect(() => { loadRevisions(); }, []);

  // ── 2. Load steps + step order for selected revision ────────────────────────
  const handleRevisionSelect = async (revId: string) => {
    const rev = revisions.find((r) => r.id === revId) ?? null;
    if (!rev) return;
    setSelRevision(rev);
    setStage("loadingSteps");
    setError(null);
    try {
      const [steps, order] = await Promise.all([
        r2GetTestSteps(rev.id),
        r2GetStepOrder(rev.id),
      ]);
      setAllSteps(steps);
      setStepOrder(order);
      setStage("selectStep");
    } catch (e: any) {
      setError(e.message ?? "Failed to fetch steps from R2");
      setStage("error");
    }
  };

  // ── 3. Select step → pre-fill edit form ─────────────────────────────────────
  const handleStepSelect = (step: R2Step) => {
    setOriginal(step);
    setSerialNo(String(step.serial_no));
    setAction(step.action ?? "");
    setExpected(step.expected_result ?? "");
    setIsDivider(step.is_divider);
    setStage("edit");
  };

  // ── 4-8. Save ────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!original || !selRevision) return;
    setStage("saving");
    setError(null);

    const newAction   = action.trim();
    const newExpected = expected.trim();

    try {
      // 1. Build updated step (serial_no LOCKED — never changes)
      const updatedStep: R2Step = {
        ...original,
        serial_no:       original.serial_no,  // ← RESTRICTED
        action:          newAction,
        expected_result: newExpected,
        is_divider:      isDivider,
      };

      // 2. Build updated steps list for R2 (full JSON rewrite, same order)
      const updatedSteps: R2Step[] = allSteps.map((s) =>
        s.id === original.id ? updatedStep : s
      );

      // 3. Push updated test_steps to R2 (full rewrite, NO step_order update)
      await r2Write(`test_steps/${selRevision.id}.json`, updatedSteps);
      r2Invalidate(`test_steps/${selRevision.id}.json`);

      // 4. Patch ONLY changed content columns in Supabase (after R2, no fetch)
      const patch: Partial<R2Step> = {};
      if (newAction   !== (original.action ?? ""))          patch.action          = newAction;
      if (newExpected !== (original.expected_result ?? "")) patch.expected_result = newExpected;
      if (isDivider   !== original.is_divider)              patch.is_divider      = isDivider;

      if (Object.keys(patch).length > 0) {
        const { error: stepErr } = await supabase
          .from("test_steps")
          .update(patch)
          .eq("id", original.id);
        if (stepErr) throw new Error(`Supabase test_steps: ${stepErr.message}`);
      }

      // 5. Update local state to reflect saved changes
      setAllSteps(updatedSteps);
      setOriginal(updatedStep);

      setStage("done");
    } catch (e: any) {
      setError(e.message ?? "Save failed");
      setStage("edit");
    }
  };

  // ── Derived ──────────────────────────────────────────────────────────────────
  const orderedSteps: R2Step[] = stepOrder
    .map((id) => allSteps.find((s) => s.id === id))
    .filter((s): s is R2Step => s !== undefined);

  // Dirty check: only content fields (serial_no excluded)
  const isDirty =
    original !== null && (
      action.trim()        !== (original.action ?? "") ||
      expected.trim()      !== (original.expected_result ?? "") ||
      isDivider            !== original.is_divider
    );

  const subtitles: Record<Stage, string> = {
    loadingRevisions: "Fetching revisions…",
    selectRevision:   "Select revision",
    loadingSteps:     "Fetching steps…",
    selectStep:       "Select step",
    edit:             "Edit step",
    saving:           "Saving…",
    done:             "Done!",
    error:            "Error",
  };

  // ── Back navigation ──────────────────────────────────────────────────────────
  const handleBack = () => {
    if (stage === "selectRevision") return onBack();
    if (stage === "selectStep")     return setStage("selectRevision");
    if (stage === "edit")           return setStage("selectStep");
  };

  return (
    <ModalShell
      title="Steps (Manual)"
      icon={<Hash size={16} />}
      subtitle={subtitles[stage]}
      onClose={onClose}
    >
      {/* Back */}
      {(stage === "selectRevision" || stage === "selectStep" || stage === "edit") && (
        <button
          onClick={handleBack}
          className="-mt-2 self-start flex items-center gap-1 text-xs text-t-muted
            hover:text-t-primary transition-colors"
        >
          <ArrowLeft size={13} /> Back
        </button>
      )}

      {/* Loading */}
      {(stage === "loadingRevisions" || stage === "loadingSteps") && (
        <div className="flex flex-col items-center gap-3 py-10">
          <div className="w-8 h-8 border-4 border-c-brand border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-t-muted">
            {stage === "loadingRevisions" ? "Fetching revisions from R2…" : "Fetching steps from R2…"}
          </p>
        </div>
      )}

      {/* Select revision */}
      {stage === "selectRevision" && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-t-muted">
            {revisions.length} active revision{revisions.length !== 1 ? "s" : ""} in R2
          </p>
          <select
            defaultValue=""
            onChange={(e) => handleRevisionSelect(e.target.value)}
            className="input text-sm"
          >
            <option value="" disabled>Choose a revision…</option>
            {revisions
              .slice()
              .sort((a, b) =>
                a.tests_serial_no.localeCompare(b.tests_serial_no, undefined, { numeric: true })
              )
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.tests_serial_no} — Rev {r.revision}
                </option>
              ))}
          </select>
        </div>
      )}

      {/* Select step */}
      {stage === "selectStep" && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-t-muted mb-1">
            {orderedSteps.length} step{orderedSteps.length !== 1 ? "s" : ""} — ordered by step array
          </p>
          <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
            {orderedSteps.length === 0 && (
              <p className="text-sm text-t-muted text-center py-4">No steps found.</p>
            )}
            {orderedSteps.map((s, idx) => (
              <button
                key={s.id}
                onClick={() => handleStepSelect(s)}
                className="text-left px-3 py-2 rounded-xl border border-(--border-color)
                  bg-bg-card hover:bg-bg-base text-xs text-t-primary transition-colors"
              >
                <span className="font-mono text-c-brand mr-2">
                  {String(idx + 1).padStart(2, "0")} · {s.serial_no}
                </span>
                {s.is_divider
                  ? <em className="text-t-muted">— divider —</em>
                  : <span className="truncate">{s.action}</span>
                }
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Edit */}
      {stage === "edit" && original && (
        <div className="flex flex-col gap-3">
          {/* Serial No — READ ONLY */}
          <div>
            <label className="block text-xs text-t-muted mb-1 flex items-center gap-1">
              <Lock size={10} /> Serial No <span className="text-t-muted/50">(locked)</span>
            </label>
            <input
              type="text"
              value={serialNo}
              readOnly
              disabled
              className="input text-sm font-mono bg-bg-base/50 opacity-60 cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-xs text-t-muted mb-1">Action</label>
            <textarea
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="input text-sm resize-none"
              rows={3}
            />
          </div>
          <div>
            <label className="block text-xs text-t-muted mb-1">Expected Result</label>
            <textarea
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
              className="input text-sm resize-none"
              rows={3}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-t-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isDivider}
              onChange={(e) => setIsDivider(e.target.checked)}
              className="rounded"
            />
            Is Divider
          </label>

          {error && (
            <p className="flex items-center gap-1.5 text-xs text-red-400">
              <AlertCircle size={13} /> {error}
            </p>
          )}

          <button
            onClick={handleSave}
            disabled={!isDirty}
            className="btn-primary text-sm disabled:opacity-40"
          >
            Save &amp; Upload
          </button>
        </div>
      )}

      {/* Saving */}
      {stage === "saving" && (
        <div className="flex flex-col items-center gap-3 py-8">
          <div className="w-8 h-8 border-4 border-c-brand border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-t-muted text-center">
            R2 test_steps · Supabase test_steps
          </p>
        </div>
      )}

      {/* Done */}
      {stage === "done" && (
        <div className="flex flex-col items-center gap-3 py-6">
          <CheckCircle size={32} className="text-green-400" />
          <p className="text-sm font-semibold text-t-primary">Saved!</p>
          <p className="text-xs text-t-muted text-center">
            R2 updated · Supabase patched
          </p>
          <button onClick={onClose} className="btn-primary text-sm px-6">Close</button>
        </div>
      )}

      {/* Error */}
      {stage === "error" && (
        <div className="flex flex-col items-center gap-3 py-6">
          <AlertCircle size={32} className="text-red-400" />
          <p className="text-sm font-semibold text-t-primary">Failed to load</p>
          <p className="text-xs text-t-muted text-center break-all">{error}</p>
          <div className="flex gap-2">
            <button onClick={onBack}          className="btn-ghost text-sm px-4">Cancel</button>
            <button onClick={loadRevisions}   className="btn-primary text-sm px-4">Retry</button>
          </div>
        </div>
      )}
    </ModalShell>
  );
};

export default ImportStepsManualModal;