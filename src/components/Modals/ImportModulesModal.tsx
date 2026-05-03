// src/components/Modals/ImportModulesModal.tsx
import React, { useEffect, useState } from "react";
import { Package, ArrowLeft, CheckCircle, AlertCircle } from "lucide-react";
import ModalShell from "../UI/ModalShell";
import { supabase } from "../../supabase";
import { r2GetModules, r2Invalidate } from "../../lib/r2";
import type { R2Module } from "../../lib/r2";

// ── R2 write helper (mirrors r2Fetch in r2.ts) ────────────────────────────────
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
const ImportModulesModal: React.FC<Props> = ({ onClose, onBack }) => {
  const [stage,    setStage]    = useState<Stage>("loading");
  const [all,      setAll]      = useState<R2Module[]>([]);
  const [original, setOriginal] = useState<R2Module | null>(null);
  const [name,     setName]     = useState("");
  const [desc,     setDesc]     = useState("");
  const [error,    setError]    = useState<string | null>(null);

  // ── 1. Fetch from R2 ────────────────────────────────────────────────────────
  const load = async () => {
    setStage("loading");
    setError(null);
    try {
      const data = await r2GetModules();
      setAll(data);
      setStage("select");
    } catch (e: any) {
      setError(e.message ?? "Failed to fetch modules from R2");
      setStage("error");
    }
  };

  useEffect(() => { load(); }, []);

  // ── 2. Select ───────────────────────────────────────────────────────────────
  const handleSelect = (moduleName: string) => {
    const found = all.find((m) => m.name === moduleName) ?? null;
    if (!found) return;
    setOriginal(found);
    setName(found.name);
    setDesc(found.description ?? "");
    setStage("edit");
  };

  // ── 4-6. Save → R2 + Supabase ───────────────────────────────────────────────
  const handleSave = async () => {
    if (!original) return;
    setStage("saving");
    setError(null);

    const newName = name.trim();
    const newDesc = desc.trim() || null;

    try {
      // 5. Patch the entry in the full list and upload to R2
      const updated: R2Module[] = all.map((m) =>
        m.name === original.name
          ? { name: newName, description: newDesc }
          : m
      );

      await r2Write("modules/all.json", updated);
      r2Invalidate("modules/all.json"); // bust L1 cache

      // 6. Patch only changed columns in Supabase
      const patch: Partial<R2Module> = {};
      if (newName !== original.name)        patch.name        = newName;
      if (newDesc !== original.description) patch.description = newDesc;

      if (Object.keys(patch).length > 0) {
        const { error: sbErr } = await supabase
          .from("modules")
          .update(patch)
          .eq("name", original.name);
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
    select:  "Select a module",
    edit:    "Edit details",
    saving:  "Saving…",
    done:    "Done!",
    error:   "Error",
  };

  const isDirty =
    original !== null &&
    (name.trim() !== original.name || (desc.trim() || null) !== original.description);

  return (
    <ModalShell
      title="Modules"
      icon={<Package size={16} />}
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
            {all.length} module{all.length !== 1 ? "s" : ""} loaded from R2
          </p>
          <select
            defaultValue=""
            onChange={(e) => handleSelect(e.target.value)}
            className="input text-sm"
          >
            <option value="" disabled>Choose a module…</option>
            {all
              .slice()
              .sort((a, b) =>
                a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
              )
              .map((m) => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))}
          </select>
        </div>
      )}

      {/* Edit */}
      {stage === "edit" && original && (
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-xs text-t-muted mb-1">Module Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input text-sm"
              placeholder="e.g. CAR-01"
            />
          </div>
          <div>
            <label className="block text-xs text-t-muted mb-1">Description (optional)</label>
            <input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="input text-sm"
              placeholder="Short description"
            />
          </div>

          {error && (
            <p className="flex items-center gap-1.5 text-xs text-red-400">
              <AlertCircle size={13} /> {error}
            </p>
          )}

          <button
            onClick={handleSave}
            disabled={!name.trim() || !isDirty}
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

export default ImportModulesModal;