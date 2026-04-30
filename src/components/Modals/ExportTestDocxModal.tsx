// src/components/Modals/ExportTestDocxModal.tsx
// Admin-only modal: pick a module → pick a test → export DOCX

import React, { useEffect, useState, useCallback } from "react";
import { FileText, ChevronRight, Loader2, AlertCircle } from "lucide-react";
import ModalShell from "../Layout/ModalShell";
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
    is_divider: s.is_divider ? parseInt(s.expected_result, 10) || 1 : null,
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
      setTests(data.map(t => ({ id: t.serial_no, tests_name: t.name })));
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
        Select a module and test
      </p>

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-fail/10 border border-fail/20 text-fail mb-3">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <p className="text-xs font-medium">{error}</p>
        </div>
      )}

      <div className="flex flex-col gap-4">
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
                    className={`flex items-center justify-between px-4 py-3 rounded-2xl border text-left transition-all duration-150 ${
                      active
                        ? "border-c-brand/50 bg-c-brand/10 text-c-brand"
                        : "border-(--border-color) bg-bg-card text-t-secondary hover:bg-bg-surface"
                    }`}
                  >
                    <span className="text-sm font-medium">{m.name}</span>
                    {active && (
                      <ChevronRight size={14} className="opacity-60 shrink-0" />
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
                      className={`flex items-center justify-between px-4 py-3 rounded-2xl border text-left transition-all duration-150 ${
                        active
                          ? "border-c-brand/50 bg-c-brand/10 text-c-brand"
                          : "border-(--border-color) bg-bg-card text-t-secondary hover:bg-bg-surface"
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
