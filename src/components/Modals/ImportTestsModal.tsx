// src/components/Modals/ImportTestsModal.tsx
import React, { useEffect, useState } from "react";
import { FlaskConical, ArrowLeft, CheckCircle, AlertCircle } from "lucide-react";
import ModalShell from "../UI/ModalShell";
import { supabase } from "../../supabase";
import { r2GetTests, r2Invalidate } from "../../lib/r2";
import type { R2Test } from "../../lib/r2";

// ── R2 write helper (same worker protocol as r2.ts) ───────────────────────────
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
type Stage = "loading" | "select" | "edit" | "saving" | "done" | "error";

interface Props { onClose: () => void; onBack: () => void }

// ── Component ─────────────────────────────────────────────────────────────────
const ImportTestsModal: React.FC<Props> = ({ onClose, onBack }) => {
  const [stage,    setStage]    = useState<Stage>("loading");
  const [all,      setAll]      = useState<R2Test[]>([]);
  const [original, setOriginal] = useState<R2Test | null>(null);
  const [serialNo, setSerialNo] = useState("");
  const [name,     setName]     = useState("");
  const [error,    setError]    = useState<string | null>(null);

  // ── 1. Fetch from R2 ────────────────────────────────────────────────────────
  const load = async () => {
    setStage("loading");
    setError(null);
    try {
      const data = await r2GetTests();
      setAll(data);
      setStage("select");
    } catch (e: any) {
      setError(e.message ?? "Failed to fetch tests from R2");
      setStage("error");
    }
  };

  useEffect(() => { load(); }, []);

  // ── 2. Select ───────────────────────────────────────────────────────────────
  const handleSelect = (sn: string) => {
    const found = all.find((t) => t.serial_no === sn) ?? null;
    if (!found) return;
    setOriginal(found);
    setSerialNo(found.serial_no);
    setName(found.name);
    setStage("edit");
  };

  // ── 4-6. Save → R2 + Supabase ───────────────────────────────────────────────
  const handleSave = async () => {
    if (!original) return;
    setStage("saving");
    setError(null);

    const newSn   = serialNo.trim();
    const newName = name.trim();

    try {
      // 5. Patch the entry in the full list and upload to R2
      const updated: R2Test[] = all.map((t) =>
        t.serial_no === original.serial_no
          ? { serial_no: newSn, name: newName }
          : t
      );

      await r2Write("tests/all.json", updated);
      r2Invalidate("tests/all.json");

      // 6. Patch only changed columns in Supabase
      const patch: Partial<R2Test> = {};
      if (newSn   !== original.serial_no) patch.serial_no = newSn;
      if (newName !== original.name)      patch.name      = newName;

      if (Object.keys(patch).length > 0) {
        const { error: sbErr } = await supabase
          .from("tests")
          .update(patch)
          .eq("serial_no", original.serial_no);
        if (sbErr) throw new Error(`Supabase: ${sbErr.message}`);
      }

      setStage("done");
    } catch (e: any) {
      setError(e.message ?? "Save failed");
      setStage("edit");
    }
  };

  const subtitles: Record<Stage, string> = {
    loading: "Fetching from R2…",
    select:  "Select a test",
    edit:    "Edit details",
    saving:  "Saving…",
    done:    "Done!",
    error:   "Error",
  };

  const isDirty =
    original !== null &&
    (serialNo.trim() !== original.serial_no || name.trim() !== original.name);

  return (
    <ModalShell
      title="Tests"
      icon={<FlaskConical size={16} />}
      subtitle={subtitles[stage]}
      onClose={onClose}
    >
      {/* Back */}
      {(stage === "select" || stage === "edit") && (
        <button
          onClick={stage === "select" ? onBack : () => setStage("select")}
          className="-mt-2 self-start flex items-center gap-1 text-xs text-t-muted
            hover:text-t-primary transition-colors"
        >
          <ArrowLeft size={13} /> Back
        </button>
      )}

      {/* Loading */}
      {stage === "loading" && (
        <div className="flex items-center justify-center py-10">
          <div className="w-8 h-8 border-4 border-c-brand border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Select */}
      {stage === "select" && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-t-muted">
            {all.length} test{all.length !== 1 ? "s" : ""} loaded from R2
          </p>
          <select
            defaultValue=""
            onChange={(e) => handleSelect(e.target.value)}
            className="input text-sm"
          >
            <option value="" disabled>Choose a test…</option>
            {all
              .slice()
              .sort((a, b) =>
                a.serial_no.localeCompare(b.serial_no, undefined, { numeric: true, sensitivity: "base" })
              )
              .map((t) => (
                <option key={t.serial_no} value={t.serial_no}>
                  {t.serial_no} — {t.name}
                </option>
              ))}
          </select>
        </div>
      )}

      {/* Edit */}
      {stage === "edit" && original && (
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-xs text-t-muted mb-1">Serial No</label>
            <input
              value={serialNo}
              onChange={(e) => setSerialNo(e.target.value)}
              className="input text-sm font-mono"
              placeholder="e.g. T001"
            />
          </div>
          <div>
            <label className="block text-xs text-t-muted mb-1">Test Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input text-sm"
              placeholder="e.g. Pantograph Test"
            />
          </div>

          {error && (
            <p className="flex items-center gap-1.5 text-xs text-red-400">
              <AlertCircle size={13} /> {error}
            </p>
          )}

          <button
            onClick={handleSave}
            disabled={!serialNo.trim() || !name.trim() || !isDirty}
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
          <p className="text-xs text-t-muted">Uploading to R2 · patching Supabase…</p>
        </div>
      )}

      {/* Done */}
      {stage === "done" && (
        <div className="flex flex-col items-center gap-3 py-6">
          <CheckCircle size={32} className="text-green-400" />
          <p className="text-sm font-semibold text-t-primary">Saved!</p>
          <p className="text-xs text-t-muted text-center">R2 updated · Supabase patched</p>
          <button onClick={onClose} className="btn-primary text-sm px-6">Close</button>
        </div>
      )}

      {/* Error (load failure) */}
      {stage === "error" && (
        <div className="flex flex-col items-center gap-3 py-6">
          <AlertCircle size={32} className="text-red-400" />
          <p className="text-sm font-semibold text-t-primary">Failed to load</p>
          <p className="text-xs text-t-muted text-center break-all">{error}</p>
          <div className="flex gap-2">
            <button onClick={onBack} className="btn-ghost text-sm px-4">Cancel</button>
            <button onClick={load}   className="btn-primary text-sm px-4">Retry</button>
          </div>
        </div>
      )}
    </ModalShell>
  );
};

export default ImportTestsModal;