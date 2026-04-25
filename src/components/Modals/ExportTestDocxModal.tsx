// src/components/Modals/ExportTestDocxModal.tsx
// Admin-only modal: pick a module → pick a test → export DOCX

import React, { useEffect, useState, useCallback } from "react";
import { X, FileText, ChevronRight, Loader2, AlertCircle } from "lucide-react";
import { supabase } from "../../supabase";
import {
  fetchModuleOptions,
  fetchTestsForModule,
} from "../../lib/supabase/queries";
import { exportTestDocx, type StepRow } from "../../utils/exportTestDocx";

// ── Types ──────────────────────────────────────────────────────────────────
interface ModuleOption {
  name: string;
}

interface TestOption {
  id: string;
  tests_name: string;
}

interface Props {
  onClose: () => void;
}

// ── Steps fetcher ──────────────────────────────────────────────────────────
async function fetchStepsForTest(
  testsName: string,
  moduleName: string
): Promise<StepRow[]> {
  const { data: steps, error: stepsErr } = await supabase
    .from("test_steps")
    .select("id, action, expected_result, serial_no, is_divider")
    .eq("tests_name", testsName)
    .order("serial_no");

  if (stepsErr) throw stepsErr;
  if (!steps?.length) return [];

  const stepIds = steps.map((s) => s.id);
  const { data: results, error: resultsErr } = await supabase
    .from("step_results")
    .select("test_steps_id, status")
    .eq("module_name", moduleName)
    .in("test_steps_id", stepIds);

  if (resultsErr) throw resultsErr;

  const statusMap = new Map<string, string>(
    (results ?? []).map((r) => [r.test_steps_id, r.status])
  );

  return steps.map((s) => ({
    action: s.action,
    expected_result: s.expected_result,
    serial_no: s.serial_no,
    is_divider: s.is_divider
      ? parseInt(s.expected_result, 10) || 1
      : null,
    status: statusMap.get(s.id) ?? null,
  }));
}

// ── Component ──────────────────────────────────────────────────────────────
const ExportTestDocxModal: React.FC<Props> = ({ onClose }) => {
  const [modules, setModules] = useState<ModuleOption[]>([]);
  const [tests, setTests] = useState<TestOption[]>([]);
  const [selectedModule, setSelectedModule] = useState<string>("");
  const [selectedTest, setSelectedTest] = useState<TestOption | null>(null);

  const [loadingModules, setLoadingModules] = useState(true);
  const [loadingTests, setLoadingTests] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchModuleOptions()
      .then(setModules)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load modules.")
      )
      .finally(() => setLoadingModules(false));
  }, []);

  const handleSelectModule = useCallback(async (name: string) => {
    setSelectedModule(name);
    setSelectedTest(null);
    setTests([]);
    setError(null);
    if (!name) return;
    setLoadingTests(true);
    try {
      const data = await fetchTestsForModule(name);
      setTests(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load tests.");
    } finally {
      setLoadingTests(false);
    }
  }, []);

  const handleExport = async () => {
    if (!selectedModule || !selectedTest) return;
    setExporting(true);
    setError(null);
    try {
      const steps = await fetchStepsForTest(
        selectedTest.tests_name,
        selectedModule
      );
      if (!steps.length) {
        setError("No steps found for this test.");
        return;
      }
      await exportTestDocx({
        moduleName: selectedModule,
        testName: selectedTest.tests_name,
        steps,
      });
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  const canExport = !!selectedModule && !!selectedTest && !exporting;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center md:hidden">
      <div
        className="absolute inset-0 backdrop-dim"
        style={{ backdropFilter: "blur(2px)" }}
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        className="relative w-full rounded-t-[28px] glass-frost border-t border-l border-r border-[var(--border-color)]"
        style={{ maxHeight: "85vh", overflowY: "auto" }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-9 h-1 rounded-full bg-[var(--border-color)]" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-4">
          <div className="flex items-center gap-2.5">
            <FileText size={17} className="text-c-brand" />
            <div>
              <p className="text-sm font-bold text-t-primary tracking-tight">
                Export Test as DOCX
              </p>
              <p className="text-[11px] text-t-muted font-medium">
                Select a module and test
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center
              bg-bg-card border border-[var(--border-color)] text-t-muted hover:text-t-primary transition"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-4 pb-8 flex flex-col gap-4">
          {/* Error banner */}
          {error && (
            <div
              className="flex items-start gap-2 px-3 py-2.5 rounded-xl
              bg-red-500/10 border border-red-500/20 text-red-400"
            >
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <p className="text-xs font-medium">{error}</p>
            </div>
          )}

          {/* Step 1 — Module */}
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
              <div className="flex flex-col gap-1.5">
                {modules.map((m) => {
                  const active = selectedModule === m.name;
                  return (
                    <button
                      key={m.name}
                      onClick={() => handleSelectModule(m.name)}
                      className={`flex items-center justify-between px-4 py-3 rounded-2xl
                        border text-left transition-all duration-150
                        ${
                          active
                            ? "border-c-brand/50 bg-c-brand/10 text-c-brand"
                            : "border-[var(--border-color)] bg-bg-card text-t-secondary hover:bg-bg-surface"
                        }`}
                    >
                      <span className="text-sm font-medium">{m.name}</span>
                      {active && (
                        <ChevronRight
                          size={14}
                          className="opacity-60 shrink-0"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Step 2 — Test */}
          {selectedModule && (
            <div className="flex flex-col gap-2">
              <p className="text-[10px] font-bold text-t-muted uppercase tracking-widest px-1">
                2 · Test
              </p>

              {loadingTests ? (
                <div className="flex items-center gap-2 px-3 py-3 text-t-muted">
                  <Loader2 size={14} className="animate-spin" />
                  <span className="text-xs">Loading tests…</span>
                </div>
              ) : tests.length === 0 ? (
                <p className="text-xs text-t-muted px-1">
                  No tests found for this module.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {tests.map((t) => {
                    const active = selectedTest?.id === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => {
                          setSelectedTest(t);
                          setError(null);
                        }}
                        className={`flex items-center justify-between px-4 py-3 rounded-2xl
                          border text-left transition-all duration-150
                          ${
                            active
                              ? "border-c-brand/50 bg-c-brand/10 text-c-brand"
                              : "border-[var(--border-color)] bg-bg-card text-t-secondary hover:bg-bg-surface"
                          }`}
                      >
                        <span className="text-sm font-medium">
                          {t.tests_name}
                        </span>
                        {active && (
                          <ChevronRight
                            size={14}
                            className="opacity-60 shrink-0"
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Export button */}
          <button
            onClick={handleExport}
            disabled={!canExport}
            className={`mt-2 w-full flex items-center justify-center gap-2 px-4 py-3.5
              rounded-2xl text-sm font-semibold transition-all duration-150
              ${
                canExport
                  ? "bg-c-brand text-white active:scale-[0.97]"
                  : "bg-bg-card text-t-muted border border-[var(--border-color)] opacity-50 cursor-not-allowed"
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
      </div>
    </div>
  );
};

export default ExportTestDocxModal;