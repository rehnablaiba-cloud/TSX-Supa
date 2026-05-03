// src/components/TestExecution/TestExecution.tsx
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  memo,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Lock, Upload, RotateCcw, User, Check, X, ArrowLeft,
  AlertTriangle, FileSpreadsheet, FileText, ChevronLeft,
  ChevronRight, GitBranch,
} from "lucide-react";
import { useAuth }       from "../../context/AuthContext";
import { useToast }      from "../../context/ToastContext";
import { useActiveLock } from "../../context/ActiveLockContext";
import { supabase }      from "../../supabase";
import Topbar      from "../Layout/Topbar";
import Spinner     from "../UI/Spinner";
import ExportModal from "../UI/ExportModal";
import { exportExecutionCSV, exportExecutionPDF } from "../../utils/export";
import type { FlatData } from "../../utils/export";
import {
  useTestExecutionData, useModuleLocks, useStepImageUrls,
  useAcquireLock, useReleaseLock, useForceReleaseLock,
  useHeartbeatLock, useUpdateStepResult, useResetAllStepResults,
  invalidateModuleLocks, insertTestFinished,
} from "../../lib/hooks";
import type { ActiveRevision, LockRow } from "../../lib/hooks";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Stable empty array so memo'd row components don't see a new reference. */
const EMPTY_URLS: string[] = [];

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  module_name:           string;
  initialmodule_test_id: string;
  isAdmin?:              boolean;
  onBack:                () => void;
}

type Filter = "all" | "pass" | "fail" | "pending";

interface ExecutionStep {
  stepId:            string;
  stepResultId:      string;
  module_test_id:    string;
  /** Computed from step_order position — shown in UI */
  serial_no:         number;
  /** Raw DB serial_no — used to build R2 image key prefix */
  originalSerialNo:  number;
  action:            string;
  expected_result:   string;
  action_image_urls:   string[];
  expected_image_urls: string[];
  is_divider:  boolean;
  status:      "pass" | "fail" | "pending";
  remarks:     string;
  display_name: string;
}

interface ModuleTestItem {
  id:         string;
  tests_name: string;
  test: { serial_no: string; name: string } | null;
}

interface ImagePreviewState {
  urls:  string[];
  idx:   number;
  label: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// computeDisplaySerials  — O(n), single backward pass for dividers
// ─────────────────────────────────────────────────────────────────────────────

function computeDisplaySerials(steps: { is_divider: boolean }[]): number[] {
  const result = new Array<number>(steps.length).fill(0);
  let counter  = 0;

  // Forward: assign incrementing serials to non-dividers
  for (let i = 0; i < steps.length; i++) {
    if (!steps[i].is_divider) result[i] = ++counter;
  }

  // Backward: each divider gets the serial of the next non-divider
  let nextSn = counter + 1;
  for (let i = steps.length - 1; i >= 0; i--) {
    if (!steps[i].is_divider) nextSn = result[i];
    else result[i] = nextSn;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Divider configs
// ─────────────────────────────────────────────────────────────────────────────

const DIVIDER_LEVELS: Record<number, {
  dot: string; text: string; bgStyle: React.CSSProperties;
  border: string; indent: string; size: string;
}> = {
  1: { dot: "bg-c-brand", text: "text-c-brand", bgStyle: { backgroundColor: "var(--color-brand-bg)" },      border: "border-l-[3px] border-c-brand", indent: "px-4",  size: "text-xs font-bold tracking-widest uppercase" },
  2: { dot: "bg-divider-2", text: "text-divider-2", bgStyle: { backgroundColor: "color-mix(in srgb, var(--color-divider-2) 5%, transparent)" }, border: "border-l-2 border-divider-2",  indent: "px-8",  size: "text-xs font-semibold tracking-wider uppercase" },
  3: { dot: "bg-divider-3", text: "text-divider-3", bgStyle: { backgroundColor: "color-mix(in srgb, var(--color-divider-3) 5%, transparent)" }, border: "border-l-2 border-divider-3",  indent: "px-12", size: "text-[11px] font-medium tracking-wide" },
};

const MOBILE_DIVIDER_LEVELS: Record<number, {
  bgStyle: React.CSSProperties; borderStyle: React.CSSProperties;
  textClass: string; dotClass: string; dotSize: number;
  fontSize: string; ml: string; py: string;
}> = {
  1: { bgStyle: { backgroundColor: "color-mix(in srgb, var(--color-divider-1) 10%, transparent)" }, borderStyle: { borderLeft: "3px solid var(--color-divider-1)" }, textClass: "text-divider-1", dotClass: "bg-divider-1", dotSize: 7, fontSize: "text-[14px] font-bold tracking-widest uppercase", ml: "ml-0", py: "py-2.5" },
  2: { bgStyle: { backgroundColor: "color-mix(in srgb, var(--color-divider-2) 10%, transparent)" }, borderStyle: { borderLeft: "2px solid var(--color-divider-2)" }, textClass: "text-divider-2", dotClass: "bg-divider-2", dotSize: 5, fontSize: "text-[12px] font-semibold tracking-wide uppercase",  ml: "ml-4", py: "py-2"   },
  3: { bgStyle: { backgroundColor: "color-mix(in srgb, var(--color-divider-3) 10%, transparent)" }, borderStyle: { borderLeft: "2px solid var(--color-divider-3)" }, textClass: "text-divider-3", dotClass: "bg-divider-3", dotSize: 4, fontSize: "text-[11px] font-medium tracking-wide",             ml: "ml-8", py: "py-1.5" },
};

const getDividerLevel   = (step: ExecutionStep) =>
  !step.is_divider ? 1 : Math.min(Math.max(parseInt(step.expected_result, 10) || 1, 1), 3);
const cleanDividerLabel = (action: string) =>
  action.replace(/^[^\p{L}\p{N}]+/u, "");

// ─────────────────────────────────────────────────────────────────────────────
// RevisionBadge
// ─────────────────────────────────────────────────────────────────────────────

const RevisionBadge: React.FC<{ revision: ActiveRevision; isReadOnly?: boolean }> = ({
  revision, isReadOnly = false,
}) => (
  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider select-none bg-[color-mix(in_srgb,var(--color-warn)_12%,transparent)] text-[color-mix(in_srgb,var(--color-warn),black_15%)] dark:text-[color-mix(in_srgb,var(--color-warn),white_35%)] border border-[color-mix(in_srgb,var(--color-warn)_30%,transparent)]">
    <GitBranch size={9} className="shrink-0" />
    {revision.revision}
    {isReadOnly && <span className="ml-0.5 opacity-70">· read-only</span>}
  </span>
);

// ─────────────────────────────────────────────────────────────────────────────
// UndoAllModal
// ─────────────────────────────────────────────────────────────────────────────

const UndoAllModal: React.FC<{
  doneCount: number; totalCount: number;
  onConfirm: () => void; onCancel: () => void;
}> = ({ doneCount, totalCount, onConfirm, onCancel }) => {
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = original; };
  }, []);

  return (
    <div role="dialog" aria-modal="true" aria-label="Reset all steps confirmation"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "color-mix(in srgb, var(--bg-base) 55%, transparent)", backdropFilter: "blur(var(--glass-blur))" }}
      onClick={onCancel}>
      <div className="relative w-full max-w-sm rounded-2xl border shadow-2xl p-6 flex flex-col gap-4"
        style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-color)" }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-14 h-14 rounded-full bg-[color-mix(in_srgb,var(--color-pend)_10%,transparent)] border-2 border-[color-mix(in_srgb,var(--color-pend)_30%,transparent)] flex items-center justify-center">
            <AlertTriangle size={26} className="text-pend" />
          </div>
          <div>
            <h2 className="text-base font-bold text-t-primary">Reset All Steps?</h2>
            <p className="text-sm text-t-muted mt-1">
              This will mark all{" "}
              <span className="font-semibold text-t-primary">{doneCount}</span>{" "}
              completed step{doneCount !== 1 ? "s" : ""} (out of{" "}
              <span className="font-semibold text-t-primary">{totalCount}</span>)
              back to <span className="font-semibold text-pend">pending</span>.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[color-mix(in_srgb,var(--color-pend)_8%,transparent)] border border-[color-mix(in_srgb,var(--color-pend)_25%,transparent)] text-xs text-[color-mix(in_srgb,var(--color-pend),black_15%)] dark:text-[color-mix(in_srgb,var(--color-pend),white_30%)]">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>All remarks and results will be cleared. <strong>This cannot be undone.</strong></span>
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onCancel} className="flex-1 px-4 py-2.5 rounded-xl border text-sm font-semibold text-t-secondary hover:text-t-primary hover:border-(--color-brand) border-(--border-color) bg-bg-card transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-(--bg-surface) bg-(--color-warn) hover:bg-[color-mix(in_srgb,var(--color-warn),black_10%)] active:bg-[color-mix(in_srgb,var(--color-warn),black_20%)] transition-colors flex items-center justify-center gap-1.5">
            <RotateCcw size={14} /> Yes, Reset All
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ImagePreviewModal
// ─────────────────────────────────────────────────────────────────────────────

const ImagePreviewModal: React.FC<{
  images: string[]; initialIndex: number; label: string; onClose: () => void;
}> = ({ images, initialIndex, label, onClose }) => {
  const [idx, setIdx] = useState(initialIndex);
  const total = images.length;

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape")      onClose();
      if (e.key === "ArrowRight")  setIdx((i) => (i + 1) % total);
      if (e.key === "ArrowLeft")   setIdx((i) => (i - 1 + total) % total);
    };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = original; document.removeEventListener("keydown", onKey); };
  }, [onClose, total]);

  return (
    <div role="dialog" aria-modal="true" aria-label={`${label} image preview`}
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: 100, background: "color-mix(in srgb, var(--bg-base) 92%, transparent)", backdropFilter: "blur(var(--glass-blur))" }}
      onClick={onClose}>
      <button onClick={onClose} aria-label="Close image preview"
        className="absolute top-4 right-4 w-9 h-9 rounded-full bg-t-primary/10 hover:bg-t-primary/20 border border-t-primary/20 flex items-center justify-center text-t-primary transition-colors z-10">
        <X size={16} />
      </button>
      <div className="absolute top-4 left-4 flex items-center gap-2 z-10">
        <span className="text-xs font-semibold text-t-muted uppercase tracking-wider">{label}</span>
        {total > 1 && <span className="text-xs text-t-muted/60">{idx + 1} / {total}</span>}
      </div>
      {total > 1 && (
        <button onClick={(e) => { e.stopPropagation(); setIdx((i) => (i - 1 + total) % total); }}
          aria-label="Previous image"
          className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-t-primary/10 hover:bg-t-primary/20 border border-t-primary/20 flex items-center justify-center text-t-primary transition-colors z-10">
          <ChevronLeft size={20} />
        </button>
      )}
      <div className="relative max-w-4xl max-h-[80vh] flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
        <img src={images[idx]} alt={`${label} ${idx + 1}`}
          className="max-w-full max-h-[80vh] rounded-xl object-contain shadow-2xl border border-t-primary/10" />
      </div>
      {total > 1 && (
        <button onClick={(e) => { e.stopPropagation(); setIdx((i) => (i + 1) % total); }}
          aria-label="Next image"
          className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-t-primary/10 hover:bg-t-primary/20 border border-t-primary/20 flex items-center justify-center text-t-primary transition-colors z-10">
          <ChevronRight size={20} />
        </button>
      )}
      {total > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-10" onClick={(e) => e.stopPropagation()}>
          {images.map((url, i) => (
            <button key={i} onClick={() => setIdx(i)} aria-label={`View image ${i + 1}`}
              className={`w-10 h-10 rounded-lg overflow-hidden border-2 transition-all ${i === idx ? "border-t-primary scale-110" : "border-t-primary/25 opacity-55 hover:opacity-90"}`}>
              <img src={url} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// LockedScreen
// ─────────────────────────────────────────────────────────────────────────────

const LockedScreen: React.FC<{
  locked_by_name: string; test_name: string; onBack: () => void;
}> = ({ locked_by_name, test_name, onBack }) => (
  <div className="flex flex-col flex-1 items-center justify-center gap-6 p-8 text-center">
    <div className="w-16 h-16 rounded-full bg-[color-mix(in_srgb,var(--color-pend)_10%,transparent)] border-2 border-[color-mix(in_srgb,var(--color-pend)_30%,transparent)] flex items-center justify-center">
      <Lock size={28} className="text-pend" />
    </div>
    <div>
      <h2 className="text-lg font-bold text-t-primary mb-1">Test In Progress</h2>
      <p className="text-t-secondary text-sm max-w-sm">
        <span className="text-[color-mix(in_srgb,var(--color-pend),black_15%)] dark:text-[color-mix(in_srgb,var(--color-pend),white_30%)] font-semibold">{locked_by_name}</span>{" "}
        is currently executing{" "}
        <span className="text-t-primary font-semibold">"{test_name}"</span>.
        You cannot enter until they finish.
      </p>
    </div>
    <div className="flex items-center gap-2 px-4 py-2 bg-[color-mix(in_srgb,var(--color-pend)_10%,transparent)] border border-[color-mix(in_srgb,var(--color-pend)_20%,transparent)] rounded-full">
      <span className="w-2 h-2 rounded-full bg-(--color-warn) animate-pulse inline-block" />
      <span className="text-xs text-[color-mix(in_srgb,var(--color-pend),black_15%)] dark:text-[color-mix(in_srgb,var(--color-pend),white_30%)] font-medium">
        You'll be unblocked instantly when they finish.
      </span>
    </div>
    <button onClick={onBack}
      className="flex items-center gap-1.5 px-6 py-2 rounded-xl border border-(--border-color) text-t-secondary hover:text-t-primary hover:border-(--color-brand) text-sm font-medium transition-colors">
      <ArrowLeft size={14} /> Go Back
    </button>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// TesterBadge
// ─────────────────────────────────────────────────────────────────────────────

const TesterBadge: React.FC<{ name: string; status: "pass" | "fail" | "pending" }> = ({ name, status }) => {
  if (!name) return null;
  const color = status === "pass"
    ? "text-[color-mix(in_srgb,var(--color-pass),white_30%)]"
    : status === "fail" ? "text-fail" : "text-t-muted";
  return (
    <span className={`flex items-center gap-1 text-[10px] font-medium ${color} opacity-80`}>
      <User size={10} />
      <span className="truncate max-w-[96px]">{name}</span>
    </span>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Desktop Table Row
// ─────────────────────────────────────────────────────────────────────────────

interface TableStepRowProps {
  step:              ExecutionStep;
  initialRemarks:    string;
  actionImageUrls:   string[];
  expectedImageUrls: string[];
  isFocused:   boolean;
  isUpdating:  boolean;
  isReadOnly:  boolean;
  onUpdate:       (stepId: string, status: "pass" | "fail" | "pending", remarks: string) => void;
  onFocus:        (stepId: string) => void;
  onRemarksChange:(stepId: string, val: string) => void;
  onImageClick:   (urls: string[], idx: number, label: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Desktop Table Row
// ─────────────────────────────────────────────────────────────────────────────

interface TableStepRowProps {
  step:              ExecutionStep;
  initialRemarks:    string;
  actionImageUrls:   string[];
  expectedImageUrls: string[];
  isFocused:   boolean;
  isUpdating:  boolean;
  isReadOnly:  boolean;
  onUpdate:       (stepId: string, status: "pass" | "fail" | "pending", remarks: string) => void;
  onFocus:        (stepId: string) => void;
  onRemarksChange:(stepId: string, val: string) => void;
  onImageClick:   (urls: string[], idx: number, label: string) => void;
}

const TableStepRow = memo(
  React.forwardRef<HTMLTableRowElement, TableStepRowProps & { "data-index"?: number }>(({
    step, initialRemarks, actionImageUrls, expectedImageUrls,
    isFocused, isUpdating, isReadOnly,
    onUpdate, onFocus, onRemarksChange, onImageClick,
    "data-index": dataIndex,
  }, ref) => {
    const [remarks, setRemarks] = useState(initialRemarks);
    useEffect(() => { setRemarks(initialRemarks); }, [initialRemarks]);

    const rowBg     = step.status === "pass" ? "bg-[color-mix(in_srgb,var(--color-pass)_5%,transparent)]" : step.status === "fail" ? "bg-fail/5" : "";
    const focusStyle = isFocused ? { outline: "2px solid var(--color-brand)", outlineOffset: "-2px" } : {};

    return (
      <tr ref={ref} data-index={dataIndex} onClick={() => onFocus(step.stepId)} style={focusStyle}
        className={`border-b border-(--border-color) hover:bg-bg-card transition-colors cursor-pointer ${rowBg}`}>
        <td className="px-2 py-3 text-center border-r border-(--border-color)">
          <span className="text-xs font-mono text-t-muted">{step.serial_no}</span>
        </td>
        <td className="px-4 py-3 border-r border-(--border-color) align-top">
          <p className="text-sm text-t-primary leading-snug wrap-break-word whitespace-pre-wrap">{step.action}</p>
          {!!actionImageUrls.length && (
            <div className="mt-2 flex flex-wrap gap-2">
              {actionImageUrls.map((url, i) => (
                <img key={url} src={url} alt={`Action ${i + 1}`}
                  onClick={(e) => { e.stopPropagation(); onImageClick(actionImageUrls, i, "Action"); }}
                  className="w-16 h-16 rounded-lg object-cover border border-(--border-color) cursor-zoom-in hover:opacity-90 hover:scale-105 transition-transform" />
              ))}
            </div>
          )}
        </td>
        <td className="px-4 py-3 border-r border-(--border-color) align-top">
          <p className="text-sm text-t-secondary leading-snug wrap-break-word whitespace-pre-wrap">{step.expected_result}</p>
          {!!expectedImageUrls.length && (
            <div className="mt-2 flex flex-wrap gap-2">
              {expectedImageUrls.map((url, i) => (
                <img key={url} src={url} alt={`Expected ${i + 1}`}
                  onClick={(e) => { e.stopPropagation(); onImageClick(expectedImageUrls, i, "Expected"); }}
                  className="w-16 h-16 rounded-lg object-cover border border-(--border-color) cursor-zoom-in hover:opacity-90 hover:scale-105 transition-transform" />
              ))}
            </div>
          )}
        </td>
        <td className="px-3 py-3 border-r border-(--border-color)">
          <textarea
            value={remarks}
            onChange={(e) => { if (isReadOnly) return; setRemarks(e.target.value); onRemarksChange(step.stepId, e.target.value); }}
            onFocus={() => onFocus(step.stepId)}
            onKeyDown={(e) => { if (isReadOnly) return; if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onUpdate(step.stepId, "pass", remarks); } }}
            placeholder={isReadOnly ? "Read-only" : "Remarks… (Enter to pass)"}
            rows={2} disabled={isReadOnly}
            className="input text-sm resize-none w-full disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </td>
        <td className="px-2 py-3 text-center border-r border-(--border-color)">
          <div className="flex flex-col items-center gap-1.5">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full capitalize ${
              step.status === "pass" ? "bg-[color-mix(in_srgb,var(--color-pass)_15%,transparent)] text-[color-mix(in_srgb,var(--color-pass),white_30%)]"
              : step.status === "fail" ? "bg-fail/15 text-fail"
              : "bg-(--border-color) text-t-muted"
            }`}>{step.status}</span>
            <TesterBadge name={step.display_name} status={step.status} />
          </div>
        </td>
        <td className="px-2 py-3">
          <div className="flex flex-col items-center gap-1">
            <div className="flex gap-1 w-full">
              <button onClick={(e) => { e.stopPropagation(); onUpdate(step.stepId, "pass", remarks); }}
                disabled={isUpdating || isReadOnly}
                className={`flex-1 h-7 rounded-md text-xs font-bold transition-colors flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed ${
                  step.status === "pass" ? "bg-pass text-(--bg-surface)"
                  : "bg-[color-mix(in_srgb,var(--color-pass)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-pass)_25%,transparent)] text-[color-mix(in_srgb,var(--color-pass),white_30%)] border border-[color-mix(in_srgb,var(--color-pass)_20%,transparent)]"
                }`}>
                <Check size={13} />
              </button>
              <button onClick={(e) => { e.stopPropagation(); onUpdate(step.stepId, "fail", remarks); }}
                disabled={isUpdating || isReadOnly}
                className={`flex-1 h-7 rounded-md text-xs font-bold transition-colors flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed ${
                  step.status === "fail" ? "bg-fail text-(--bg-surface)" : "bg-fail/10 hover:bg-fail/25 text-fail border border-fail/20"
                }`}>
                <X size={13} />
              </button>
            </div>
            {step.status !== "pending" && (
              <button onClick={(e) => { e.stopPropagation(); onUpdate(step.stepId, "pending", ""); }}
                disabled={isUpdating || isReadOnly}
                className="w-full h-7 rounded-md text-xs font-semibold text-t-muted hover:text-t-primary bg-bg-card hover:bg-bg-surface border border-(--border-color) transition-colors flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed">
                Undo
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  })
);// ─────────────────────────────────────────────────────────────────────────────
// Mobile Step Card
// ─────────────────────────────────────────────────────────────────────────────

interface MobileStepCardProps {
  step:              ExecutionStep;
  initialRemarks:    string;
  actionImageUrls:   string[];
  expectedImageUrls: string[];
  isFocused:   boolean;
  isUpdating:  boolean;
  isReadOnly:  boolean;
  onUpdate:       (stepId: string, status: "pass" | "fail" | "pending", remarks: string) => void;
  onFocus:        (stepId: string) => void;
  onRemarksChange:(stepId: string, val: string) => void;
  onImageClick:   (urls: string[], idx: number, label: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mobile Step Card
// ─────────────────────────────────────────────────────────────────────────────

interface MobileStepCardProps {
  step:              ExecutionStep;
  initialRemarks:    string;
  actionImageUrls:   string[];
  expectedImageUrls: string[];
  isFocused:   boolean;
  isUpdating:  boolean;
  isReadOnly:  boolean;
  onUpdate:       (stepId: string, status: "pass" | "fail" | "pending", remarks: string) => void;
  onFocus:        (stepId: string) => void;
  onRemarksChange:(stepId: string, val: string) => void;
  onImageClick:   (urls: string[], idx: number, label: string) => void;
}

const MobileStepCard = memo(
  React.forwardRef<HTMLDivElement, MobileStepCardProps & { "data-index"?: number }>(({
    step, initialRemarks, actionImageUrls, expectedImageUrls,
    isFocused, isUpdating, isReadOnly,
    onUpdate, onFocus, onRemarksChange, onImageClick,
    "data-index": dataIndex,
  }, ref) => {
    const [remarks,           setRemarks]           = useState(initialRemarks);
    const [showRemarksDialog, setShowRemarksDialog] = useState(false);
    const [draftRemarks,      setDraftRemarks]      = useState(initialRemarks);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => { setRemarks(initialRemarks); }, [initialRemarks]);

    const openDialog = (e: React.MouseEvent) => {
      if (isReadOnly) return;
      e.stopPropagation();
      setDraftRemarks(remarks);
      setShowRemarksDialog(true);
      requestAnimationFrame(() => textareaRef.current?.focus());
    };
    const saveRemarks    = () => { setRemarks(draftRemarks); onRemarksChange(step.stepId, draftRemarks); setShowRemarksDialog(false); };
    const discardRemarks = () => { setDraftRemarks(remarks); setShowRemarksDialog(false); };

    useEffect(() => {
      if (!showRemarksDialog) return;
      const original = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = original; };
    }, [showRemarksDialog]);

    const rowBg      = step.status === "pass" ? "bg-[color-mix(in_srgb,var(--color-pass)_5%,transparent)]" : step.status === "fail" ? "bg-fail/5" : "";
    const accentColor = isFocused ? "var(--color-brand)" : step.status === "pass" ? "var(--color-pass)" : step.status === "fail" ? "var(--color-fail)" : "var(--border-color)";

    return (
      <div ref={ref} data-index={dataIndex}>
        {showRemarksDialog && (
          <div role="dialog" aria-modal="true" aria-label={`Remarks for step ${step.serial_no}`}
            className="fixed inset-0 flex items-end justify-center"
            style={{ zIndex: 200, backgroundColor: "color-mix(in srgb, var(--bg-base) 55%, transparent)", backdropFilter: "blur(var(--glass-blur))" }}
            onClick={discardRemarks}>
            <div className="w-full max-w-lg rounded-t-2xl border border-(--border-color) shadow-2xl p-4 flex flex-col gap-3"
              style={{ backgroundColor: "var(--bg-surface)" }} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-t-muted uppercase tracking-wider">Remarks — Step #{step.serial_no}</span>
                <button onClick={discardRemarks} aria-label="Discard remarks"
                  className="w-7 h-7 rounded-full bg-(--border-color) flex items-center justify-center text-t-muted hover:text-t-primary transition-colors">
                  <X size={13} />
                </button>
              </div>
              <textarea ref={textareaRef} value={draftRemarks}
                onChange={(e) => setDraftRemarks(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveRemarks(); } if (e.key === "Escape") discardRemarks(); }}
                placeholder="Enter remarks… (Enter to save, Shift+Enter for new line)"
                rows={4} className="input text-sm resize-none w-full" />
              <div className="flex gap-2">
                <button onClick={discardRemarks} className="flex-1 px-4 py-2.5 rounded-xl border border-(--border-color) text-sm font-semibold text-t-secondary hover:text-t-primary transition-colors">Discard</button>
                <button onClick={saveRemarks}    className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-(--bg-surface) bg-c-brand hover:bg-c-brand/90 transition-colors">Save</button>
              </div>
            </div>
          </div>
        )}

        <div onClick={() => onFocus(step.stepId)}
          className={`rounded-xl overflow-hidden border w-full cursor-pointer transition-shadow ${rowBg} ${isFocused ? "ring-2 ring-[color-mix(in_srgb,var(--color-brand),white_30%)]" : ""}`}
          style={{
            backgroundColor: "var(--bg-surface)",
            borderLeftColor: accentColor,
            borderLeftWidth: 3,
            borderColor: "var(--border-color)",
            isolation: "isolate",
          }}>
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-(--border-color)"
            style={{ backgroundColor: "var(--bg-card)" }}>
            <span className="text-xs font-mono text-t-muted tracking-wide">#{step.serial_no}</span>
            <div className="flex items-center gap-2 min-w-0">
              {isFocused && !isReadOnly && (
                <span className="flex items-center gap-1.5 text-[10px] font-medium shrink-0">
                  <kbd className="px-1 py-0.5 rounded-sm bg-[color-mix(in_srgb,var(--color-pass)_10%,transparent)] text-[color-mix(in_srgb,var(--color-pass),white_30%)] border border-[color-mix(in_srgb,var(--color-pass)_20%,transparent)] font-mono text-[9px]">P</kbd>
                  <span className="text-[color-mix(in_srgb,var(--color-pass),white_30%)]">pass</span>
                  <span className="text-t-muted opacity-40">·</span>
                  <kbd className="px-1 py-0.5 rounded-sm bg-fail/10 text-fail border border-fail/20 font-mono text-[9px]">F</kbd>
                  <span className="text-fail">fail</span>
                </span>
              )}
              <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full capitalize ${
                step.status === "pass" ? "bg-[color-mix(in_srgb,var(--color-pass)_15%,transparent)] text-[color-mix(in_srgb,var(--color-pass),white_30%)]"
                : step.status === "fail" ? "bg-fail/15 text-fail" : "bg-(--border-color) text-t-muted"
              }`}>{step.status}</span>
              <TesterBadge name={step.display_name} status={step.status} />
            </div>
          </div>

          {/* Action */}
          <div className="grid grid-cols-[72px_1fr] border-b border-(--border-color)">
            <div className="px-3 py-2.5 border-r border-(--border-color) flex items-start"
              style={{ backgroundColor: "var(--bg-card)" }}>
              <span className="text-[10px] font-semibold text-t-muted uppercase tracking-wider mt-0.5">Action</span>
            </div>
            <div className="px-3 py-2.5 min-w-0" style={{ backgroundColor: "var(--bg-surface)" }}>
              <p className="text-sm leading-snug wrap-break-word text-t-primary whitespace-pre-wrap">{step.action}</p>
              {!!actionImageUrls.length && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {actionImageUrls.map((url, i) => (
                    <img key={url} src={url} alt={`Action ${i + 1}`}
                      onClick={(e) => { e.stopPropagation(); onImageClick(actionImageUrls, i, "Action"); }}
                      className="w-[72px] h-[72px] rounded-lg object-cover border border-(--border-color) cursor-zoom-in hover:opacity-90 hover:scale-105 transition-transform" />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Expected */}
          <div className="grid grid-cols-[72px_1fr] border-b border-(--border-color)">
            <div className="px-3 py-2.5 border-r border-(--border-color) flex items-start"
              style={{ backgroundColor: "var(--bg-card)" }}>
              <span className="text-[10px] font-semibold text-t-muted uppercase tracking-wider mt-0.5">Expected</span>
            </div>
            <div className="px-3 py-2.5 min-w-0" style={{ backgroundColor: "var(--bg-surface)" }}>
              <p className="text-sm leading-snug wrap-break-word text-t-secondary whitespace-pre-wrap">{step.expected_result}</p>
              {!!expectedImageUrls.length && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {expectedImageUrls.map((url, i) => (
                    <img key={url} src={url} alt={`Expected ${i + 1}`}
                      onClick={(e) => { e.stopPropagation(); onImageClick(expectedImageUrls, i, "Expected"); }}
                      className="w-[72px] h-[72px] rounded-lg object-cover border border-(--border-color) cursor-zoom-in hover:opacity-90 hover:scale-105 transition-transform" />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 px-3 py-2" style={{ backgroundColor: "var(--bg-card)" }}>
            <button onClick={openDialog} disabled={isUpdating || isReadOnly}
              className={`flex-1 min-w-0 flex items-center gap-1.5 px-3 h-8 rounded-full border text-xs font-medium transition-colors truncate disabled:opacity-40 disabled:cursor-not-allowed ${
                remarks ? "border-c-brand/40 bg-c-brand/8 text-t-primary hover:bg-c-brand/15"
                : "border-(--border-color) text-t-muted hover:border-c-brand/40 hover:text-t-primary"
              }`}>
              <span className="truncate">{isReadOnly && !remarks ? "No remarks" : remarks || "Add remarks…"}</span>
              {remarks && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-c-brand" />}
            </button>
            {step.status !== "pending" && (
              <button onClick={(e) => { e.stopPropagation(); onUpdate(step.stepId, "pending", ""); }}
                disabled={isUpdating || isReadOnly}
                className="shrink-0 px-2.5 h-8 rounded-md text-xs font-semibold text-t-muted hover:text-t-primary border border-(--border-color) transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: "var(--bg-surface)" }}>
                Undo
              </button>
            )}
            <button onClick={(e) => { e.stopPropagation(); onUpdate(step.stepId, "pass", remarks); }}
              disabled={isUpdating || isReadOnly}
              className={`shrink-0 w-8 h-8 rounded-md text-xs font-bold transition-colors flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed ${
                step.status === "pass" ? "bg-pass text-(--bg-surface)"
                : "bg-[color-mix(in_srgb,var(--color-pass)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-pass)_25%,transparent)] text-[color-mix(in_srgb,var(--color-pass),white_30%)] border border-[color-mix(in_srgb,var(--color-pass)_20%,transparent)]"
              }`}><Check size={14} /></button>
            <button onClick={(e) => { e.stopPropagation(); onUpdate(step.stepId, "fail", remarks); }}
              disabled={isUpdating || isReadOnly}
              className={`shrink-0 w-8 h-8 rounded-md text-xs font-bold transition-colors flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed ${
                step.status === "fail" ? "bg-fail text-(--bg-surface)" : "bg-fail/10 hover:bg-fail/25 text-fail border border-fail/20"
              }`}><X size={14} /></button>
          </div>
        </div>
      </div>
    );
  })
);// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

const TestExecution: React.FC<Props> = ({
  module_name, initialmodule_test_id, isAdmin = false, onBack,
}) => {
  const { user }                        = useAuth();
  const { addToast }                    = useToast();
  const { setActiveLock, clearActiveLock } = useActiveLock();

  const currentMtId = initialmodule_test_id;

  const userRef = useRef(user);
  useEffect(() => { if (user != null) userRef.current = user; }, [user]);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [filter,         setFilter]         = useState<Filter>("all");
  const [search,         setSearch]         = useState("");
  const [showExportModal, setShowExportModal] = useState(false);
  const [showUndoModal,   setShowUndoModal]   = useState(false);
  const [scrollTarget,    setScrollTarget]    = useState<string | null>(null);
  const [focusedStepId,   setFocusedStepId]   = useState<string | null>(null);
  const [imagePreview,    setImagePreview]    = useState<ImagePreviewState | null>(null);

  // ── Data state ────────────────────────────────────────────────────────────
  const [moduleTests,     setModuleTests]     = useState<ModuleTestItem[]>([]);
  const [steps,           setSteps]           = useState<ExecutionStep[]>([]);
  const [currentRevision, setCurrentRevision] = useState<ActiveRevision | null>(null);
  const [isVisible,       setIsVisible]       = useState<boolean>(true);

  // ── Loading gates ─────────────────────────────────────────────────────────
  const [dataInitialized,    setDataInitialized]    = useState(false);
  const [lockAcquireAttempted, setLockAcquireAttempted] = useState(false);

  // ── Mutation state ────────────────────────────────────────────────────────
  const [updatingStepIds, setUpdatingStepIds] = useState<Set<string>>(new Set());
  const [isUndoingAll,    setIsUndoingAll]    = useState(false);

  // ── TanStack Query: lock check ────────────────────────────────────────────
  const lockQuery     = useModuleLocks([currentMtId], module_name);
  const lockRecord: LockRow | null = lockQuery.data?.[currentMtId] ?? null;
  const isLockedByOther = !!(lockRecord && lockRecord.user_id !== user?.id);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const acquireLockMutation  = useAcquireLock();
  const releaseLockMutation  = useReleaseLock(module_name);
  const forceReleaseMutation = useForceReleaseLock(module_name);
  const heartbeatMutation    = useHeartbeatLock();
  const updateStepMutation   = useUpdateStepResult(currentMtId, module_name);
  const resetStepsMutation   = useResetAllStepResults(currentMtId);

  // Stable mutation refs to avoid stale closure issues in intervals/effects
  const heartbeatMutateRef    = useRef(heartbeatMutation.mutate);
  const releaseLockMutateRef  = useRef(releaseLockMutation.mutate);
  useEffect(() => { heartbeatMutateRef.current   = heartbeatMutation.mutate;   }, [heartbeatMutation.mutate]);
  useEffect(() => { releaseLockMutateRef.current = releaseLockMutation.mutate; }, [releaseLockMutation.mutate]);

  // ── Guard refs ────────────────────────────────────────────────────────────
  const hasInitializedForRef       = useRef<string | null>(null);
  const lockAcquireAttemptedForRef = useRef<string | null>(null);

  // ── 1. Reset all local state when the test changes ────────────────────────
  useEffect(() => {
    hasInitializedForRef.current       = null;
    lockAcquireAttemptedForRef.current = null;
    setDataInitialized(false);
    setLockAcquireAttempted(false);
    setFocusedStepId(null);
    setSteps([]);
    setSeenStepIds(new Set());
    remarksMap.current   = {};
  }, [currentMtId]);

  // ── 2. Acquire lock as soon as lock-check resolves (BEFORE data fetch) ────
  //
  // Previously this happened AFTER execData arrived (Effect 3 in old code),
  // meaning 5k steps were fetched before we even held the lock.
  // Now: lock check resolves → try to acquire → setLockAcquireAttempted
  //                                           → execQuery becomes enabled
  useEffect(() => {
    if (lockQuery.isLoading) return;
    if (lockAcquireAttemptedForRef.current === currentMtId) return;
    lockAcquireAttemptedForRef.current = currentMtId;

    // Someone else holds it — don't attempt, just open the gate
    if (isLockedByOther) {
      setLockAcquireAttempted(true);
      return;
    }

    const u = userRef.current;
    if (!u) return;

    acquireLockMutation.mutate(
      { module_test_id: currentMtId, user_id: u.id, display_name: u.display_name ?? u.email ?? "User" },
      {
        onSuccess: (result) => {
          if (result.success) setActiveLock(currentMtId, u.id);
          else addToast(`Locked by ${result.holder ?? "another user"}. View only.`, "warning");
        },
        onSettled: () => setLockAcquireAttempted(true),
      }
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockQuery.isLoading, currentMtId]);

  // ── TanStack Query: execution data ───────────────────────────────────────
  // Gated on lockAcquireAttempted — data never fetches before we hold the lock.
  const execQuery = useTestExecutionData(currentMtId, module_name, {
    enabled: lockAcquireAttempted && !isLockedByOther,
  });
  const execData = execQuery.data;

  // ── 3. Derive local steps from query data ─────────────────────────────────
  useEffect(() => {
    if (!execData || hasInitializedForRef.current === currentMtId) return;
    hasInitializedForRef.current = currentMtId;

    const ordered        = execData.step_results.filter((sr) => sr.step !== null);
    const displaySerials = computeDisplaySerials(ordered.map((sr) => ({ is_divider: sr.step!.is_divider })));

    const merged: ExecutionStep[] = ordered.map((sr, idx) => ({
      stepId:             sr.step!.id,
      stepResultId:       sr.id,
      module_test_id:     currentMtId,
      serial_no:          displaySerials[idx],
      originalSerialNo:   sr.step!.serial_no,
      action:             sr.step!.action,
      expected_result:    sr.step!.expected_result,
      action_image_urls:  sr.step!.action_image_urls  || [],
      expected_image_urls:sr.step!.expected_image_urls || [],
      is_divider:         sr.step!.is_divider,
      status:             sr.status,
      remarks:            sr.remarks,
      display_name:       sr.display_name ?? "",
    }));

    setModuleTests(execData.module_tests as unknown as ModuleTestItem[]);
    setCurrentRevision(execData.current_revision);

    const isVisibleNow = execData.is_visible ?? true;
    setIsVisible(isVisibleNow);
    setSteps(merged);
    setDataInitialized(true);

    // If the test is archived (read-only), release the lock we just acquired
    if (!isVisibleNow) {
      const u = userRef.current;
      if (u) releaseLockMutateRef.current({ module_test_id: currentMtId, user_id: u.id });
      clearActiveLock();
    }

    if (isVisibleNow) {
      const firstPending = merged.find((s) => !s.is_divider && s.status === "pending");
      if (firstPending) {
        setFocusedStepId(firstPending.stepId);
        setScrollTarget(firstPending.stepId);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [execData, currentMtId]);

  // ── Derived flags ─────────────────────────────────────────────────────────
  const isRevisionReadOnly = !isVisible;
  const isLockedRef        = useRef(false);
  const isReadOnlyRef      = useRef(false);
  isLockedRef.current      = isLockedByOther;
  isReadOnlyRef.current    = isRevisionReadOnly;

  // ── Stable refs ───────────────────────────────────────────────────────────
  const stepsRef      = useRef<ExecutionStep[]>([]);
  stepsRef.current    = steps;
  const updatingRef   = useRef<Set<string>>(new Set());
  updatingRef.current = updatingStepIds;
  const remarksMap    = useRef<Record<string, string>>({});

  const handleFocus         = useCallback((stepId: string) => setFocusedStepId(stepId), []);
  const handleRemarksChange = useCallback((stepId: string, val: string) => { remarksMap.current[stepId] = val; }, []);

  // ── 4. Heartbeat ──────────────────────────────────────────────────────────
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (heartbeatIntervalRef.current) { clearInterval(heartbeatIntervalRef.current); heartbeatIntervalRef.current = null; }
    if (isLockedByOther || isRevisionReadOnly || !lockAcquireAttempted) return;

    heartbeatIntervalRef.current = setInterval(() => {
      const u = userRef.current;
      if (!u) return;
      heartbeatMutateRef.current({ module_test_id: currentMtId, user_id: u.id });
    }, 90_000);

    return () => { if (heartbeatIntervalRef.current) { clearInterval(heartbeatIntervalRef.current); heartbeatIntervalRef.current = null; } };
  }, [currentMtId, isLockedByOther, isRevisionReadOnly, lockAcquireAttempted]);

  // ── 5. Realtime: lock changes ─────────────────────────────────────────────
  useEffect(() => {
    const uid = user?.id ?? "anon";
    const lockChannel = supabase
      .channel(`lock:${currentMtId}:${uid}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "test_locks", filter: `module_test_id=eq.${currentMtId}` }, () => invalidateModuleLocks(module_name))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "test_locks", filter: `module_test_id=eq.${currentMtId}` }, () => invalidateModuleLocks(module_name))
      .subscribe();
    return () => { supabase.removeChannel(lockChannel); };
  }, [module_name, currentMtId, user?.id]);

  // ── Filtered list (virtualizer input) ────────────────────────────────────
  const filtered = useMemo(
    () =>
      steps.filter((s) => {
        if (s.is_divider) return true;
        if (filter !== "all" && s.status !== filter) return false;
        if (search && !`${s.action} ${s.expected_result} ${s.remarks}`.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      }),
    [steps, filter, search]
  );

  // ── Virtualizer ───────────────────────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count:           filtered.length,
    getScrollElement:() => scrollRef.current,
    estimateSize:    (index) => {
      const step = filtered[index];
      if (!step) return 200;
      if (step.is_divider) return 36;
      // Mobile cards need larger estimates; desktop rows are more uniform
      const actionLines = Math.max(1, Math.ceil(step.action.length / 42));
      const expectedLines = Math.max(1, Math.ceil(step.expected_result.length / 42));
      const actionImgH = step.action_image_urls?.length ? 84 : 0;
      const expectedImgH = step.expected_image_urls?.length ? 84 : 0;
      // header(36) + action label(20) + text + images + expected label(20) + text + images + controls(44) + padding(20)
      return Math.max(200, 36 + 20 + actionLines * 20 + actionImgH + 20 + expectedLines * 20 + expectedImgH + 44 + 20);
    },
    overscan:        5,
    measureElement:  (el) => el.getBoundingClientRect().height,
  });

  // Stable ref to virtualizer for effects that shouldn't re-run on every render
  const virtualizerRef = useRef(rowVirtualizer);
  useEffect(() => { virtualizerRef.current = rowVirtualizer; }, [rowVirtualizer]);

  const virtualItems  = rowVirtualizer.getVirtualItems();
  const totalSize     = rowVirtualizer.getTotalSize();
  const paddingTop    = virtualItems.length > 0 ? (virtualItems[0]?.start ?? 0) : 0;
  const paddingBottom = virtualItems.length > 0
    ? totalSize - (virtualItems[virtualItems.length - 1]?.end ?? totalSize)
    : 0;

  // ── 6. Scroll to target via virtualizer ──────────────────────────────────
  useEffect(() => {
    if (!scrollTarget || !dataInitialized) return;
    const idx = filtered.findIndex((s) => s.stepId === scrollTarget);
    if (idx === -1) {
      setScrollTarget(null);
      return;
    }
    // Defer scroll so the virtualizer has time to measure elements first
    // (critical when measureElement is active). We use rAF + setTimeout
    // to ensure React has flushed the DOM and the virtualizer has measured.
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const raf = requestAnimationFrame(() => {
      timeout = setTimeout(() => {
        virtualizerRef.current.scrollToIndex(idx, { align: "center" });
        setScrollTarget(null);
      }, 50);
    });
    return () => {
      cancelAnimationFrame(raf);
      if (timeout) clearTimeout(timeout);
    };
    // NOTE: rowVirtualizer is intentionally omitted from deps to prevent
    // the effect from re-running (and cancelling its pending timeout) on
    // every render. We use virtualizerRef to always access the latest instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTarget, dataInitialized, filtered]);

  // ── Lazy image loading — only fetch for steps seen by the virtualizer ─────
  //
  // Each time new items scroll into view, add their IDs to the "seen" set.
  // The set only grows (never shrinks), so TanStack Query's cache is hit for
  // previously seen steps. On test change, reset clears the set.
  const [seenStepIds, setSeenStepIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSeenStepIds((prev) => {
      let changed = false;
      const next  = new Set(prev);
      for (const vItem of virtualItems) {
        const step = filtered[vItem.index];
        if (step && !step.is_divider && !next.has(step.stepId)) {
          next.add(step.stepId);
          changed = true;
        }
      }
      return changed ? next : prev;   // stable reference if nothing new
    });
  // virtualItems reference changes on scroll; that's intentional here
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [virtualItems, filtered]);

  const imageSteps = useMemo(
    () =>
      steps
        .filter((s) => !s.is_divider && seenStepIds.has(s.stepId))
        .map((s) => ({ id: s.stepId, serial_no: s.originalSerialNo })),
    [steps, seenStepIds]
  );

  const { data: stepImageUrls = {} } = useStepImageUrls(imageSteps);

  // ── Image preview ─────────────────────────────────────────────────────────
  const openImagePreview = useCallback(
    (urls: string[], clickedIdx: number, label: string) => {
      if (urls.length) setImagePreview({ urls, idx: clickedIdx, label });
    },
    []
  );

  // ── Handle step update (optimistic) ──────────────────────────────────────
  const handleStepUpdate = useCallback(
    (stepId: string, status: "pass" | "fail" | "pending", remarks: string) => {
      if (isLockedRef.current || isReadOnlyRef.current) return;
      if (updatingRef.current.has(stepId)) return;

      const currentSteps = stepsRef.current;
      const originalStep = currentSteps.find((s) => s.stepId === stepId) ?? null;
      const idx          = currentSteps.findIndex((s) => s.stepId === stepId);
      const nextPending  = currentSteps.slice(idx + 1).find((s) => !s.is_divider && s.status === "pending");
      const u            = userRef.current;
      const display_name = u?.display_name ?? u?.email ?? "User";

      setUpdatingStepIds((prev) => new Set(prev).add(stepId));
      setSteps((prev) => prev.map((s) => s.stepId === stepId ? { ...s, status, remarks, display_name } : s));

      if (status !== "pending") {
        if (nextPending) { setFocusedStepId(nextPending.stepId); setScrollTarget(nextPending.stepId); }
        else setFocusedStepId(null);
      } else {
        setFocusedStepId(stepId);
        setScrollTarget(stepId);
      }

      updateStepMutation.mutate(
        { test_steps_id: stepId, module_name, status, remarks, display_name },
        {
          onError: () => {
            if (originalStep) {
              setSteps((prev) => prev.map((s) =>
                s.stepId === stepId ? { ...s, status: originalStep.status, remarks: originalStep.remarks } : s
              ));
            }
            addToast("Failed to save step result. Please try again.", "error");
          },
          onSettled: () => {
            setUpdatingStepIds((prev) => { const next = new Set(prev); next.delete(stepId); return next; });
          },
        }
      );
    },
    [module_name, addToast, updateStepMutation]
  );

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "BUTTON") return;
      if (!focusedStepId || isLockedRef.current || isReadOnlyRef.current) return;
      const focused = stepsRef.current.find((s) => s.stepId === focusedStepId);
      if (!focused || focused.is_divider) return;
      if (e.key === "p" || e.key === "P" || e.key === "Enter") {
        e.preventDefault();
        handleStepUpdate(focusedStepId, "pass", remarksMap.current[focusedStepId] ?? focused.remarks ?? "");
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        handleStepUpdate(focusedStepId, "fail", remarksMap.current[focusedStepId] ?? focused.remarks ?? "");
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [focusedStepId, handleStepUpdate]);

  // ── Reset all steps ───────────────────────────────────────────────────────
  const handleUndoAll = useCallback(() => {
    if (isUndoingAll) return;
    setIsUndoingAll(true);
    setShowUndoModal(false);

    const currentSteps  = stepsRef.current;
    const u             = userRef.current;
    const display_name  = u?.display_name ?? u?.email ?? "User";
    const stepResultIds = currentSteps.filter((s) => !s.is_divider && s.stepResultId).map((s) => s.stepResultId);

    setSteps((prev) => prev.map((s) => s.is_divider ? s : { ...s, status: "pending", remarks: "", display_name }));
    remarksMap.current = {};
    const first = currentSteps.filter((s) => !s.is_divider)[0];
    if (first) { setFocusedStepId(first.stepId); setScrollTarget(first.stepId); }

    resetStepsMutation.mutate(
      { module_name, stepResultIds, display_name },
      {
        onSuccess: () => addToast("All steps reset to pending.", "info"),
        onError:   () => {
          setSteps((prev) => prev.map((s) => {
            if (s.is_divider) return s;
            const orig = currentSteps.find((os) => os.stepId === s.stepId);
            return orig ? { ...s, status: orig.status, remarks: orig.remarks } : s;
          }));
          addToast("Failed to reset steps. Please try again.", "error");
        },
        onSettled: () => setIsUndoingAll(false),
      }
    );
  }, [module_name, addToast, isUndoingAll, resetStepsMutation]);

  // ── Force release (admin) ─────────────────────────────────────────────────
  const handleForceRelease = useCallback(() => {
    if (!isAdmin) return;
    forceReleaseMutation.mutate(
      { module_test_id: currentMtId },
      {
        onSuccess: () => addToast("Lock force-released", "success"),
        onError:   (e: any) => addToast(e?.message ?? "Failed to force-release lock", "error"),
      }
    );
  }, [isAdmin, currentMtId, forceReleaseMutation, addToast]);

  // ── Finish test ───────────────────────────────────────────────────────────
  const currentMt   = moduleTests.find((mt) => mt.id === currentMtId);
  const currentTest = currentMt?.test;

  const handleFinish = useCallback(() => {
    const u = userRef.current;
    if (u && isVisible) {
      releaseLockMutation.mutate({ module_test_id: currentMtId, user_id: u.id });
      clearActiveLock();
      insertTestFinished(module_name, currentTest?.name ?? "Unknown", u.display_name ?? u.email ?? "User", "pending");
    }
    addToast(`Test "${currentTest?.name}" completed!`, "success");
    onBack();
  }, [isVisible, currentMtId, releaseLockMutation, clearActiveLock, currentTest?.name, module_name, addToast, onBack]);

  // ── Derived stats ─────────────────────────────────────────────────────────
  const { passCount, failCount, totalCount, doneCount, passPct, failPct, progressPct } = useMemo(() => {
    const nd    = steps.filter((s) => !s.is_divider);
    const pass  = nd.filter((s) => s.status === "pass").length;
    const fail  = nd.filter((s) => s.status === "fail").length;
    const total = nd.length;
    const done  = pass + fail;
    return {
      passCount: pass, failCount: fail, totalCount: total, doneCount: done,
      progressPct: total > 0 ? Math.round((done  / total) * 100) : 0,
      passPct:     total > 0 ? Math.round((pass  / total) * 100) : 0,
      failPct:     total > 0 ? Math.round((fail  / total) * 100) : 0,
    };
  }, [steps]);

  const flatData = useMemo<FlatData[]>(
    () => steps.map((s) =>
      s.is_divider
        ? { module: module_name, test: currentTest?.name ?? "", serial: 0, action: cleanDividerLabel(s.action), expected: s.expected_result, remarks: "", status: "", isdivider: true, dividerLevel: getDividerLevel(s) }
        : { module: module_name, test: currentTest?.name ?? "", serial: s.serial_no, action: s.action, expected: s.expected_result, remarks: s.remarks || "", status: s.status }
    ),
    [steps, module_name, currentTest?.name]
  );

  const exportStats    = useMemo(() => { const nd = flatData.filter((s) => !s.isdivider); return [{ label: "Total Steps", value: nd.length }, { label: "Pass", value: nd.filter((s) => s.status === "pass").length }, { label: "Fail", value: nd.filter((s) => s.status === "fail").length }]; }, [flatData]);
  const exportTestName = currentTest ? `${currentTest.serial_no}. ${currentTest.name}` : "test";

  // ── Loading gate ──────────────────────────────────────────────────────────
  const isGlobalLoading =
    lockQuery.isLoading ||
    (!isLockedByOther && (execQuery.isLoading || !dataInitialized || !lockAcquireAttempted));

  if (isGlobalLoading)
    return (
      <div className="flex flex-col items-center justify-center gap-3" style={{ height: "100dvh" }}>
        <Spinner />
        <p className="text-xs text-t-muted">
          {lockQuery.isLoading ? "Checking lock status…" : !lockAcquireAttempted ? "Acquiring lock…" : execQuery.isLoading || !dataInitialized ? "Loading test…" : "Checking lock status…"}
        </p>
      </div>
    );

  // ── Locked by another user ────────────────────────────────────────────────
  if (isLockedByOther)
    return (
      <div className="flex flex-col" style={{ height: "100dvh" }}>
        <Topbar title={currentTest?.name ?? "Test Execution"} subtitle={module_name} onBack={onBack} />
        <LockedScreen locked_by_name={lockRecord!.locked_by_name} test_name={currentTest?.name ?? "this test"} onBack={onBack} />
        {isAdmin && (
          <div className="p-4 flex justify-center">
            <button onClick={handleForceRelease} className="text-xs text-fail hover:text-[color-mix(in_srgb,var(--color-fail),white_50%)] underline underline-offset-2 transition-colors">
              Force-release lock (admin)
            </button>
          </div>
        )}
      </div>
    );

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col" style={{ height: "100dvh" }}>
      {imagePreview && (
        <ImagePreviewModal images={imagePreview.urls} initialIndex={imagePreview.idx} label={imagePreview.label} onClose={() => setImagePreview(null)} />
      )}
      {showUndoModal && (
        <UndoAllModal doneCount={doneCount} totalCount={totalCount} onConfirm={handleUndoAll} onCancel={() => setShowUndoModal(false)} />
      )}
      <ExportModal
        isOpen={showExportModal} onClose={() => setShowExportModal(false)}
        title="Export Test Results" subtitle={`${module_name} · ${currentTest?.name ?? ""}`}
        stats={exportStats}
        options={[
          { label: "CSV", icon: <FileSpreadsheet size={16} />, color: "bg-(--bg-card) border border-(--border-color) text-(--text-primary)", hoverColor: "hover:bg-(--bg-surface) hover:border-(--color-brand)", onConfirm: () => exportExecutionCSV(module_name, exportTestName, flatData) },
          { label: "PDF", icon: <FileText        size={16} />, color: "bg-(--bg-card) border border-(--border-color) text-(--text-primary)", hoverColor: "hover:bg-(--bg-surface) hover:border-(--color-brand)", onConfirm: () => exportExecutionPDF(module_name, exportTestName, flatData) },
        ]}
      />

      {/* ── Fixed header ───────────────────────────────────────────────── */}
      <div className="shrink-0">
        <Topbar
          title={currentTest ? `${currentTest.serial_no}. ${currentTest.name}` : "Test Execution"}
          subtitle={module_name} onBack={onBack}
          actions={
            <>
              <button onClick={() => setShowExportModal(true)} disabled={steps.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-bg-card hover:bg-bg-surface border border-(--border-color) text-t-primary transition disabled:opacity-40 disabled:cursor-not-allowed">
                <Upload size={13} /> Export
              </button>
              <button onClick={handleFinish} className="btn-primary text-sm">Finish Test</button>
            </>
          }
        />

        {/* Progress */}
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-3 text-xs text-t-muted flex-wrap">
              {currentRevision && <RevisionBadge revision={currentRevision} isReadOnly={isRevisionReadOnly} />}
              <span><span className="text-[color-mix(in_srgb,var(--color-pass),white_30%)] font-semibold">{passCount}</span> pass</span>
              <span><span className="text-fail font-semibold">{failCount}</span> fail</span>
              <span><span className="text-t-muted font-semibold">{totalCount - doneCount}</span> pending</span>
            </div>
            <div className="flex items-center gap-3">
              {focusedStepId && !isRevisionReadOnly && (
                <span className="hidden md:flex items-center gap-2 text-xs text-t-muted">
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 rounded-sm bg-[color-mix(in_srgb,var(--color-pass)_10%,transparent)] text-[color-mix(in_srgb,var(--color-pass),white_30%)] font-mono text-[10px] border border-[color-mix(in_srgb,var(--color-pass)_20%,transparent)]">P</kbd>
                    <span className="text-(--border-color) mx-0.5">/</span>
                    <kbd className="px-1.5 py-0.5 rounded-sm bg-[color-mix(in_srgb,var(--color-pass)_10%,transparent)] text-[color-mix(in_srgb,var(--color-pass),white_30%)] font-mono text-[10px] border border-[color-mix(in_srgb,var(--color-pass)_20%,transparent)]">Enter</kbd>
                    <span className="text-[color-mix(in_srgb,var(--color-pass),white_30%)] ml-1">pass</span>
                  </span>
                  <span className="text-(--border-color)">·</span>
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 rounded-sm bg-fail/10 text-fail font-mono text-[10px] border border-fail/20">F</kbd>
                    <span className="text-fail ml-1">fail</span>
                  </span>
                </span>
              )}
              <span className="text-xs text-t-muted font-medium">{progressPct}%</span>
            </div>
          </div>
          <div className="h-1.5 bg-(--border-color) rounded-full overflow-hidden flex">
            <div className="h-full bg-pass transition-all duration-500" style={{ width: `${passPct}%` }} />
            <div className="h-full bg-fail transition-all duration-500" style={{ width: `${failPct}%` }} />
          </div>
        </div>

        {/* Read-only banner */}
        {isRevisionReadOnly && (
          <div className="mx-4 mb-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-[color-mix(in_srgb,var(--color-warn)_8%,transparent)] border border-[color-mix(in_srgb,var(--color-warn)_25%,transparent)]">
            <GitBranch size={12} className="shrink-0 text-[color-mix(in_srgb,var(--color-warn),black_10%)] dark:text-[color-mix(in_srgb,var(--color-warn),white_30%)]" />
            <span className="text-xs text-[color-mix(in_srgb,var(--color-warn),black_10%)] dark:text-[color-mix(in_srgb,var(--color-warn),white_30%)]">
              This test is <strong>completed</strong> — results are view only.
            </span>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col border-b border-(--border-color)">
          <div className="flex items-center justify-end gap-1 px-4 py-2">
            {(["all", "pass", "fail", "pending"] as Filter[]).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                style={filter === f ? { color: "#ffffff" } : undefined}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors capitalize ${filter === f ? "bg-c-brand" : "text-t-muted hover:text-t-primary"}`}>
                {f}
              </button>
            ))}
          </div>
          <div className="px-4 pb-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search steps…" aria-label="Search steps"
              className="input text-xs py-1.5 w-full" />
          </div>
        </div>
      </div>

      {/* ── Virtualised scroll container ────────────────────────────────── */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="text-center text-t-muted py-20 text-sm">No steps match your filter.</div>
        ) : (
          <>
            {/* ── Desktop table (virtualised with spacer rows) ─────────── */}
            <table className="hidden md:table w-full text-sm border-collapse table-fixed">
              <thead className="sticky top-0 z-10">
                <tr className="bg-bg-surface border-b border-(--border-color)">
                  <th className="text-left px-2 py-2.5 text-xs font-semibold text-t-muted uppercase tracking-wider w-[6%]  border-r border-(--border-color)">S.No</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-t-muted uppercase tracking-wider w-[28%] border-r border-(--border-color)">Action</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-t-muted uppercase tracking-wider w-[28%] border-r border-(--border-color)">Expected Result</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-t-muted uppercase tracking-wider w-[13%] border-r border-(--border-color)">Remarks</th>
                  <th className="text-center px-2 py-2.5 text-xs font-semibold text-t-muted uppercase tracking-wider w-[11%] border-r border-(--border-color)">Status</th>
                  <th className="text-center px-2 py-2.5 text-xs font-semibold text-t-muted uppercase tracking-wider w-[14%]">Result</th>
                </tr>
              </thead>
              <tbody>
                {/* Top spacer */}
                {paddingTop > 0 && (
                  <tr aria-hidden><td colSpan={6} style={{ height: paddingTop, padding: 0 }} /></tr>
                )}

                {virtualItems.map((vItem) => {
                  const step = filtered[vItem.index];
                  if (!step) return null;

                  if (step.is_divider) {
                    const level = getDividerLevel(step);
                    const s     = DIVIDER_LEVELS[level] ?? DIVIDER_LEVELS[1];
                    return (
                      <tr
                        ref={rowVirtualizer.measureElement}
                        data-index={vItem.index}
                        key={step.stepId}
                        className="border-b border-(--border-color)"
                        style={s.bgStyle}>
                        <td colSpan={6} className={`py-2 ${s.indent} ${s.border}`}>
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full ${s.dot} inline-block shrink-0`}
                              style={{ width: level === 1 ? 6 : level === 2 ? 5 : 4, height: level === 1 ? 6 : level === 2 ? 5 : 4 }} />
                            <span className={`${s.size} ${s.text}`}>{cleanDividerLabel(step.action)}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <TableStepRow
                      ref={rowVirtualizer.measureElement}
                      data-index={vItem.index}
                      key={step.stepId}
                      step={step}
                      initialRemarks={remarksMap.current[step.stepId] ?? step.remarks ?? ""}
                      actionImageUrls={stepImageUrls[step.stepId]?.actionUrls   ?? EMPTY_URLS}
                      expectedImageUrls={stepImageUrls[step.stepId]?.expectedUrls ?? EMPTY_URLS}
                      isFocused={focusedStepId === step.stepId}
                      isUpdating={updatingStepIds.has(step.stepId)}
                      isReadOnly={isRevisionReadOnly}
                      onUpdate={handleStepUpdate}
                      onFocus={handleFocus}
                      onRemarksChange={handleRemarksChange}
                      onImageClick={openImagePreview}
                    />
                  );
                })}

                {/* Bottom spacer */}
                {paddingBottom > 0 && (
                  <tr aria-hidden><td colSpan={6} style={{ height: paddingBottom, padding: 0 }} /></tr>
                )}
              </tbody>
            </table>

                        {/* ── Mobile cards (virtualised with absolute positioning) ──── */}
            <div className="md:hidden flex flex-col">
              <div className="sticky top-0 z-10 grid grid-cols-[72px_1fr] border-b border-(--border-color)"
                style={{ backgroundColor: "var(--bg-surface)" }}>
                <div className="px-3 py-2 border-r border-(--border-color)">
                  <span className="text-[10px] font-semibold text-t-muted uppercase tracking-wider">S.No</span>
                </div>
                <div className="px-3 py-2">
                  <span className="text-[10px] font-semibold text-t-muted uppercase tracking-wider">Step Details</span>
                </div>
              </div>

              <div style={{ height: totalSize, position: "relative" }}>
                {virtualItems.map((vItem) => {
                  const step = filtered[vItem.index];
                  if (!step) return null;

                  if (step.is_divider) {
                    const level = getDividerLevel(step);
                    const ms    = MOBILE_DIVIDER_LEVELS[level] ?? MOBILE_DIVIDER_LEVELS[1];
                    return (
                      <div
                        ref={rowVirtualizer.measureElement}
                        data-index={vItem.index}
                        key={step.stepId}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          transform: `translateY(${vItem.start}px)`,
                          padding: "0 12px",
                          zIndex: 1,
                        }}>
                        <div className={`flex items-center gap-2 ${ms.py} pl-3 pr-3 rounded-r-lg ${ms.ml}`}
                          style={{ ...ms.bgStyle, ...ms.borderStyle, backgroundColor: "var(--bg-surface)" }}>
                          <span className={`rounded-full shrink-0 ${ms.dotClass}`} style={{ width: ms.dotSize, height: ms.dotSize }} />
                          <span className={`${ms.fontSize} ${ms.textClass}`}>{cleanDividerLabel(step.action)}</span>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      ref={rowVirtualizer.measureElement}
                      data-index={vItem.index}
                      key={step.stepId}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${vItem.start}px)`,
                        padding: "0 12px 8px",
                        zIndex: 2,
                      }}>
                      <MobileStepCard
                        step={step}
                        initialRemarks={remarksMap.current[step.stepId] ?? step.remarks ?? ""}
                        actionImageUrls={stepImageUrls[step.stepId]?.actionUrls   ?? EMPTY_URLS}
                        expectedImageUrls={stepImageUrls[step.stepId]?.expectedUrls ?? EMPTY_URLS}
                        isFocused={focusedStepId === step.stepId}
                        isUpdating={updatingStepIds.has(step.stepId)}
                        isReadOnly={isRevisionReadOnly}
                        onUpdate={handleStepUpdate}
                        onFocus={handleFocus}
                        onRemarksChange={handleRemarksChange}
                        onImageClick={openImagePreview}
                      />
                    </div>
                  );
                })}
              </div>
            </div>            {/* Undo All — admin only */}
            {isAdmin && doneCount > 0 && !isRevisionReadOnly && (
              <div className="flex items-center justify-center py-6 px-4">
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed border-[color-mix(in_srgb,var(--color-pend)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-pend)_5%,transparent)]">
                  <AlertTriangle size={14} className="text-pend shrink-0" />
                  <span className="text-xs text-t-muted">Admin action — resets all progress</span>
                  <button onClick={() => setShowUndoModal(true)} disabled={isUndoingAll}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-[color-mix(in_srgb,var(--color-pend),black_15%)] dark:text-[color-mix(in_srgb,var(--color-pend),white_30%)] bg-[color-mix(in_srgb,var(--color-pend)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-pend)_20%,transparent)] border border-[color-mix(in_srgb,var(--color-pend)_30%,transparent)] hover:border-[color-mix(in_srgb,var(--color-pend)_60%,transparent)] transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed">
                    <RotateCcw size={12} /> Undo All
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default TestExecution;