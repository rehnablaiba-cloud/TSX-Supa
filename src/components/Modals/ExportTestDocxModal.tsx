// src/components/Modals/ExportTestDocxModal.tsx
// Admin-only modal: two modes
//   Mode 1 (no results): pick any revision from R2 → export DOCX with images (no status)
//   Mode 2 (with results): pick module → pick test (filtered to that module's tests) →
//           pick revision → fetch step_results from Supabase → export DOCX with status + images

import React, { useEffect, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, ChevronRight, Loader2, AlertCircle } from "lucide-react";
import ModalShell from "../Layout/ModalShell";
import { supabase } from "../../supabase";
import {
  r2GetModules,
  r2GetActiveRevisions,
  r2GetTestSteps,
  r2GetStepOrder,
  type R2Step,
} from "../../lib/r2";
import { fetchTestsForModule, fetchBatchStepImageUrls, type TestOption } from "../../lib/rpc";
import { exportTestDocx, type StepRow } from "../../utils/exportTestDocx";

// ── Types ──────────────────────────────────────────────────────────────────────

type Mode = "no-results" | "with-results";

interface R2Module {
  name: string;
  description?: string | null;
}

interface RevisionEntry {
  id:              string;
  revision:        string;
  tests_serial_no: string;
  tests_name?:     string;
}

interface Props {
  onClose: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Fetch step_results for the given stepIds scoped to a module. */
async function fetchStepResultStatuses(
  stepIds:    string[],
  moduleName: string
): Promise<Map<string, string>> {
  if (!stepIds.length) return new Map();
  const { data, error } = await supabase
    .from("step_results")
    .select("test_steps_id, status")
    .eq("module_name", moduleName)
    .in("test_steps_id", stepIds);
  if (error) throw error;
  return new Map((data ?? []).map((r: any) => [r.test_steps_id, r.status]));
}

/** Convert R2 steps (ordered) + optional status map into StepRow[]. */
function buildStepRows(
  stepOrder:   string[],
  stepMap:     Map<string, R2Step>,
  statusMap?:  Map<string, string>,
  imageUrlMap: Record<string, { actionUrls: string[]; expectedUrls: string[] }> = {}
): StepRow[] {
  return stepOrder.reduce<StepRow[]>((acc, id) => {
    const s = stepMap.get(id);
    if (!s) return acc;
    const resolved = imageUrlMap[id];
    acc.push({
      action:              s.action,
      expected_result:     s.expected_result,
      serial_no:           s.serial_no,
      is_divider:          s.is_divider ? parseInt(s.expected_result, 10) || 1 : null,
      status:              statusMap?.get(id) ?? null,
      action_image_urls:   resolved?.actionUrls   ?? [],
      expected_image_urls: resolved?.expectedUrls ?? [],
    });
    return acc;
  }, []);
}

// ── Component ──────────────────────────────────────────────────────────────────

const ExportTestDocxModal: React.FC<Props> = ({ onClose }) => {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("no-results");

  // ── Shared state ────────────────────────────────────────────────────────────
  const [allRevisions, setAllRevisions]       = useState<RevisionEntry[]>([]);
  const [loadingRevisions, setLoadingRevisions] = useState(true);

  // ── Mode 1 state ────────────────────────────────────────────────────────────
  const [selectedRevId, setSelectedRevId] = useState<string>("");

  // ── Mode 2 state ────────────────────────────────────────────────────────────
  const [modules, setModules]                     = useState<R2Module[]>([]);
  const [loadingModules, setLoadingModules]       = useState(false);
  const [selectedModule, setSelectedModule]       = useState<string>("");
  const [filteredRevisions, setFilteredRevisions] = useState<RevisionEntry[]>([]);
  const [loadingFiltered, setLoadingFiltered]     = useState(false);
  const [selectedRevIdM2, setSelectedRevIdM2]     = useState<string>("");

  // ── Export state ─────────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  // ── Load all revisions once ────────────────────────────────────────────────
  useEffect(() => {
    setLoadingRevisions(true);
    // Use queryClient so the result is cached and shared with other consumers
    queryClient
      .fetchQuery({
        queryKey: ["activeRevisions"],
        queryFn:  () => r2GetActiveRevisions(),
        staleTime: 5 * 60 * 1000,
      })
      .then((raw) => {
        const entries: RevisionEntry[] = Object.values(raw).map((r: any) => ({
          id:              r.id,
          revision:        r.revision,
          tests_serial_no: r.tests_serial_no,
          tests_name:      r.tests_name ?? r.tests_serial_no,
        }));
        entries.sort((a, b) =>
          a.tests_serial_no.localeCompare(b.tests_serial_no, undefined, {
            numeric: true, sensitivity: "base",
          })
        );
        setAllRevisions(entries);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load revisions.")
      )
      .finally(() => setLoadingRevisions(false));
  }, [queryClient]);

  // ── Load R2 modules when switching to Mode 2 ──────────────────────────────
  useEffect(() => {
    if (mode !== "with-results") return;
    setLoadingModules(true);
    queryClient
      .fetchQuery({
        queryKey: ["modules"],
        queryFn:  () => r2GetModules(),
        staleTime: 5 * 60 * 1000,
      })
      .then(setModules)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load modules.")
      )
      .finally(() => setLoadingModules(false));
  }, [mode, queryClient]);

  // ── Module selected in Mode 2 ─────────────────────────────────────────────
  const handleSelectModule = useCallback(async (moduleName: string) => {
    setSelectedModule(moduleName);
    setSelectedRevIdM2("");
    setFilteredRevisions([]);
    setError(null);
    if (!moduleName) return;

    setLoadingFiltered(true);
    try {
      const tests: TestOption[] = await queryClient.fetchQuery({
        queryKey: ["moduleTests", moduleName],
        queryFn:  () => fetchTestsForModule(moduleName),
        staleTime: 2 * 60 * 1000,
      });
      const serialNoSet = new Set(tests.map((t) => t.serial_no));
      setFilteredRevisions(allRevisions.filter((r) => serialNoSet.has(r.tests_serial_no)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to filter tests for module.");
    } finally {
      setLoadingFiltered(false);
    }
  }, [allRevisions, queryClient]);

  // ── Reset on tab switch ───────────────────────────────────────────────────
  const handleSetMode = (m: Mode) => {
    setMode(m);
    setSelectedRevId("");
    setSelectedModule("");
    setSelectedRevIdM2("");
    setFilteredRevisions([]);
    setError(null);
  };

  // ── Export ─────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    const isMode1    = mode === "no-results";
    const revId      = isMode1 ? selectedRevId : selectedRevIdM2;
    const moduleName = isMode1 ? null : selectedModule;

    if (!revId) return;
    if (!isMode1 && !moduleName) return;

    setExporting(true);
    setError(null);

    try {
      const rev = allRevisions.find((r) => r.id === revId);
      if (!rev) throw new Error("Revision not found.");

      // ── Cache-aware fetches — hits TanStack cache if warm ─────────────────
      const [stepOrder, r2Steps] = await Promise.all([
        queryClient.fetchQuery({
          queryKey: ["stepOrder", revId],
          queryFn:  () => r2GetStepOrder(revId),
          staleTime: 5 * 60 * 1000,
        }),
        queryClient.fetchQuery({
          queryKey: ["testSteps", revId],
          queryFn:  () => r2GetTestSteps(revId),
          staleTime: 5 * 60 * 1000,
        }),
      ]);

      if (!stepOrder.length || !r2Steps.length) {
        setError("No steps found for this revision.");
        return;
      }

      const stepMap = new Map<string, R2Step>(r2Steps.map((s) => [s.id, s]));

      const nonDividerSteps = stepOrder
        .map((id) => stepMap.get(id))
        .filter((s): s is R2Step => !!s && !s.is_divider)
        .map((s) => ({ id: s.id, serial_no: s.serial_no }));

      // ── Image URLs — matches key used by useStepImageUrls in hooks.ts ──────
      const imageUrlMap = nonDividerSteps.length
        ? await queryClient.fetchQuery({
            queryKey: ["r2StepImages", ...nonDividerSteps.map((s) => s.id).sort()],
            queryFn:  () => fetchBatchStepImageUrls(nonDividerSteps),
            staleTime: 30 * 60 * 1000,
          })
        : {};

      // ── Step result statuses (Mode 2 only) — always fresh ─────────────────
      let statusMap: Map<string, string> | undefined;
      if (!isMode1 && moduleName) {
        statusMap = await fetchStepResultStatuses(stepOrder, moduleName);
      }

      const steps = buildStepRows(stepOrder, stepMap, statusMap, imageUrlMap);
      if (!steps.length) {
        setError("No steps could be built for this revision.");
        return;
      }

      await exportTestDocx({
        moduleName: moduleName ?? "—",
        testName:   rev.tests_name ?? rev.tests_serial_no,
        steps,
      });

      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const activeRevId = mode === "no-results" ? selectedRevId : selectedRevIdM2;
  const canExport   =
    !exporting &&
    !!activeRevId &&
    (mode === "no-results" || !!selectedModule);

  // ── Shared sub-render: revision list ──────────────────────────────────────
  const renderRevisionList = (
    revisions: RevisionEntry[],
    selected:  string,
    onSelect:  (id: string) => void,
    loading:   boolean,
    emptyMsg:  string
  ) => {
    if (loading) {
      return (
        <div className="flex items-center gap-2 px-3 py-3 text-t-muted">
          <Loader2 size={14} className="animate-spin" />
          <span className="text-xs">Loading…</span>
        </div>
      );
    }
    if (!revisions.length) {
      return <p className="text-xs text-t-muted px-1">{emptyMsg}</p>;
    }
    return (
      <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto pr-1">
        {revisions.map((r) => {
          const active = selected === r.id;
          return (
            <button
              key={r.id}
              onClick={() => { onSelect(r.id); setError(null); }}
              className={`flex items-center justify-between px-4 py-3 rounded-2xl border text-left transition-all duration-150 ${
                active
                  ? "border-c-brand/50 bg-c-brand/10 text-c-brand"
                  : "border-(--border-color) bg-bg-card text-t-secondary hover:bg-bg-surface"
              }`}
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{r.tests_name ?? r.tests_serial_no}</span>
                <span className="text-[11px] opacity-60">rev {r.revision}</span>
              </div>
              {active && <ChevronRight size={14} className="opacity-60 shrink-0" />}
            </button>
          );
        })}
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <ModalShell
      title={
        <span className="flex items-center gap-2">
          <FileText size={17} className="text-c-brand" />
          Export Test as DOCX
        </span>
      }
      onClose={onClose}
    >
      <p className="text-xs text-t-muted -mt-1 mb-3">
        Choose a mode then select a revision to export.
      </p>

      {/* Mode toggle */}
      <div className="flex gap-2 mb-4">
        {(["no-results", "with-results"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => handleSetMode(m)}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all duration-150 ${
              mode === m
                ? "border-c-brand/50 bg-c-brand/10 text-c-brand"
                : "border-(--border-color) bg-bg-card text-t-secondary hover:bg-bg-surface"
            }`}
          >
            {m === "no-results" ? "Steps only" : "With results"}
          </button>
        ))}
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-fail/10 border border-fail/20 text-fail mb-3">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <p className="text-xs font-medium">{error}</p>
        </div>
      )}

      <div className="flex flex-col gap-4">

        {/* ── Mode 1: pick any revision ──────────────────────────────────────── */}
        {mode === "no-results" && (
          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-bold text-t-muted uppercase tracking-widest px-1">
              Select Revision
            </p>
            {renderRevisionList(
              allRevisions,
              selectedRevId,
              setSelectedRevId,
              loadingRevisions,
              "No revisions found."
            )}
          </div>
        )}

        {/* ── Mode 2: module → filtered revision ────────────────────────────── */}
        {mode === "with-results" && (
          <>
            <div className="flex flex-col gap-2">
              <p className="text-[10px] font-bold text-t-muted uppercase tracking-widest px-1">
                1 · Module
              </p>
              {loadingModules ? (
                <div className="flex items-center gap-2 px-3 py-3 text-t-muted">
                  <Loader2 size={14} className="animate-spin" />
                  <span className="text-xs">Loading modules…</span>
                </div>
              ) : modules.length === 0 ? (
                <p className="text-xs text-t-muted px-1">No modules found.</p>
              ) : (
                <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
                  {modules.map((m) => {
                    const active = selectedModule === m.name;
                    return (
                      <button
                        key={m.name}
                        onClick={() => handleSelectModule(m.name)}
                        className={`flex items-center justify-between px-4 py-3 rounded-2xl border text-left transition-all duration-150 ${
                          active
                            ? "border-c-brand/50 bg-c-brand/10 text-c-brand"
                            : "border-(--border-color) bg-bg-card text-t-secondary hover:bg-bg-surface"
                        }`}
                      >
                        <span className="text-sm font-medium">{m.name}</span>
                        {active && <ChevronRight size={14} className="opacity-60 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {selectedModule && (
              <div className="flex flex-col gap-2">
                <p className="text-[10px] font-bold text-t-muted uppercase tracking-widest px-1">
                  2 · Test / Revision
                </p>
                {renderRevisionList(
                  filteredRevisions,
                  selectedRevIdM2,
                  setSelectedRevIdM2,
                  loadingFiltered,
                  "No active revisions found for this module."
                )}
              </div>
            )}
          </>
        )}

        {/* Export button */}
        <button
          onClick={handleExport}
          disabled={!canExport}
          className={`mt-2 w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl text-sm font-semibold transition-all duration-150 ${
            canExport
              ? "bg-c-brand text-(--bg-surface) active:scale-[0.97]"
              : "bg-bg-card text-t-muted border border-(--border-color) opacity-50 cursor-not-allowed"
          }`}
        >
          {exporting ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              <span>Building DOCX…</span>
            </>
          ) : (
            <>
              <FileText size={15} />
              <span>Export DOCX</span>
            </>
          )}
        </button>
      </div>
    </ModalShell>
  );
};

export default ExportTestDocxModal;