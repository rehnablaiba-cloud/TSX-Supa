/**
 * TestExecution.tsx
 * Fixed: channel names are user-scoped to prevent Web Lock collisions.
 * Lock acquire checks ownership before upsert — no stealing.
 * Heartbeat only runs when this user owns the lock.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Lock,
  Upload,
  RotateCcw,
  User,
  Check,
  X,
  ArrowLeft,
  AlertTriangle,
  FileSpreadsheet,
  FileText,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { supabase } from "../../supabase";
import Topbar from "../Layout/Topbar";
import Spinner from "../UI/Spinner";
import ExportModal from "../UI/ExportModal";
import MassImageUploadModal from "../UI/MassImageUploadModal";
import useaudit_log from "../../hooks/useAuditLog";
import { exportExecutionCSV, exportExecutionPDF } from "../../utils/export";
import type { FlatData } from "../../utils/export";
import {
  acquireLock,
  releaseLock,
  forceReleaseLock,
  heartbeatLock,
} from "../../lib/supabase/queries.testexecution";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  module_name: string;
  initialmodule_test_id: string;
  isAdmin?: boolean;
  onBack: () => void;
}

type Filter = "all" | "pass" | "fail" | "pending";

interface ExecutionStep {
  stepId: string;
  stepResultId: string;
  module_test_id: string;
  serial_no: number;
  action: string;
  expected_result: string;
  action_image_urls: string[];
  expected_image_urls: string[];
  is_divider: boolean;
  status: "pass" | "fail" | "pending";
  remarks: string;
  display_name: string;
}

interface ModuleTestItem {
  id: string;
  tests_name: string;
  test: { serial_no: string; name: string } | null;
}

type SignedImageMap = Record<string, string>;

interface ImagePreviewState {
  urls: string[];
  idx: number;
  label: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Divider configs
// ─────────────────────────────────────────────────────────────────────────────

const DIVIDER_LEVELS: Record<
  number,
  {
    dot: string;
    text: string;
    bg: string;
    border: string;
    indent: string;
    size: string;
  }
> = {
  1: {
    dot: "bg-c-brand",
    text: "text-c-brand",
    bg: "bg-c-brand-bg",
    border: "border-l-[3px] border-c-brand",
    indent: "px-4",
    size: "text-xs font-bold tracking-widest uppercase",
  },
  2: {
    dot: "bg-amber-400",
    text: "text-amber-400",
    bg: "bg-amber-500/5",
    border: "border-l-[2px] border-amber-400",
    indent: "px-8",
    size: "text-xs font-semibold tracking-wider uppercase",
  },
  3: {
    dot: "bg-sky-400",
    text: "text-sky-400",
    bg: "bg-sky-500/5",
    border: "border-l-[2px] border-sky-400",
    indent: "px-12",
    size: "text-[11px] font-medium tracking-wide",
  },
};

const MOBILE_DIVIDER_LEVELS: Record<
  number,
  {
    bg: string;
    border: string;
    textClass: string;
    dotClass: string;
    dotSize: number;
    fontSize: string;
    ml: string;
    py: string;
  }
> = {
  1: {
    bg: "bg-teal-500/10",
    border: "border-l-[3px] border-teal-500",
    textClass: "text-teal-400",
    dotClass: "bg-teal-500",
    dotSize: 7,
    fontSize: "text-[14px] font-bold tracking-widest uppercase",
    ml: "ml-0",
    py: "py-2.5",
  },
  2: {
    bg: "bg-amber-500/10",
    border: "border-l-[2px] border-amber-400",
    textClass: "text-amber-400",
    dotClass: "bg-amber-400",
    dotSize: 5,
    fontSize: "text-[12px] font-semibold tracking-wide uppercase",
    ml: "ml-4",
    py: "py-2",
  },
  3: {
    bg: "bg-sky-500/10",
    border: "border-l-[2px] border-sky-400",
    textClass: "text-sky-400",
    dotClass: "bg-sky-400",
    dotSize: 4,
    fontSize: "text-[11px] font-medium tracking-wide",
    ml: "ml-8",
    py: "py-1.5",
  },
};

const getDividerLevel = (expected_result: string): number =>
  Math.min(Math.max(parseInt(expected_result, 10) || 1, 1), 3);

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components (unchanged from original)
// ─────────────────────────────────────────────────────────────────────────────

const UndoAllModal: React.FC<{
  doneCount: number;
  totalCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ doneCount, totalCount, onConfirm, onCancel }) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center p-4"
    style={{ backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
    onClick={onCancel}
  >
    <div
      className="relative w-full max-w-sm rounded-2xl border shadow-2xl p-6 flex flex-col gap-4"
      style={{
        backgroundColor: "var(--bg-surface)",
        borderColor: "var(--border-color)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="w-14 h-14 rounded-full bg-amber-500/10 border-2 border-amber-500/30 flex items-center justify-center">
          <AlertTriangle size={26} className="text-amber-500" />
        </div>
        <div>
          <h2 className="text-base font-bold text-t-primary">
            Reset All Steps?
          </h2>
          <p className="text-sm text-t-muted mt-1">
            This will mark all{" "}
            <span className="font-semibold text-t-primary">{doneCount}</span>{" "}
            completed step{doneCount !== 1 ? "s" : ""} (out of{" "}
            <span className="font-semibold text-t-primary">{totalCount}</span>)
            back to{" "}
            <span className="font-semibold text-amber-500">pending</span>.
          </p>
        </div>
      </div>
      <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/8 border border-amber-500/25 text-xs text-amber-600 dark:text-amber-400">
        <AlertTriangle size={13} className="shrink-0 mt-0.5" />
        <span>
          All remarks and results will be cleared.{" "}
          <strong>This cannot be undone.</strong>
        </span>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={onCancel}
          className="flex-1 px-4 py-2.5 rounded-xl border text-sm font-semibold text-t-secondary hover:text-t-primary hover:border-[var(--color-brand)] border-[var(--border-color)] bg-bg-card transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-amber-500 hover:bg-amber-600 active:bg-amber-700 transition-colors flex items-center justify-center gap-1.5"
        >
          <RotateCcw size={14} /> Yes, Reset All
        </button>
      </div>
    </div>
  </div>
);

const ImagePreviewModal: React.FC<{
  images: string[];
  initialIndex: number;
  label: string;
  onClose: () => void;
}> = ({ images, initialIndex, label, onClose }) => {
  const [idx, setIdx] = useState(initialIndex);
  const total = images.length;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIdx((i) => (i + 1) % total);
      if (e.key === "ArrowLeft") setIdx((i) => (i - 1 + total) % total);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, total]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{
        backgroundColor: "rgba(0,0,0,0.88)",
        backdropFilter: "blur(8px)",
      }}
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center text-white transition-colors z-10"
      >
        <X size={16} />
      </button>
      <div className="absolute top-4 left-4 flex items-center gap-2 z-10">
        <span className="text-xs font-semibold text-white/70 uppercase tracking-wider">
          {label}
        </span>
        {total > 1 && (
          <span className="text-xs text-white/40">
            {idx + 1} / {total}
          </span>
        )}
      </div>
      {total > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIdx((i) => (i - 1 + total) % total);
          }}
          className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center text-white transition-colors z-10"
        >
          <ChevronLeft size={20} />
        </button>
      )}
      <div
        className="relative max-w-4xl max-h-[80vh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={images[idx]}
          alt={`${label} ${idx + 1}`}
          className="max-w-full max-h-[80vh] rounded-xl object-contain shadow-2xl border border-white/10"
        />
      </div>
      {total > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIdx((i) => (i + 1) % total);
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center text-white transition-colors z-10"
        >
          <ChevronRight size={20} />
        </button>
      )}
      {total > 1 && (
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-10"
          onClick={(e) => e.stopPropagation()}
        >
          {images.map((url, i) => (
            <button
              key={i}
              onClick={() => setIdx(i)}
              className={`w-10 h-10 rounded-lg overflow-hidden border-2 transition-all ${
                i === idx
                  ? "border-white scale-110"
                  : "border-white/25 opacity-55 hover:opacity-90"
              }`}
            >
              <img src={url} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const LockedScreen: React.FC<{
  locked_by_name: string;
  test_name: string;
  onBack: () => void;
}> = ({ locked_by_name, test_name, onBack }) => (
  <div className="flex flex-col flex-1 items-center justify-center gap-6 p-8 text-center">
    <div className="w-16 h-16 rounded-full bg-amber-500/10 border-2 border-amber-500/30 flex items-center justify-center">
      <Lock size={28} className="text-amber-500" />
    </div>
    <div>
      <h2 className="text-lg font-bold text-t-primary mb-1">
        Test In Progress
      </h2>
      <p className="text-t-secondary text-sm max-w-sm">
        <span className="text-amber-600 dark:text-amber-400 font-semibold">
          {locked_by_name}
        </span>{" "}
        is currently executing{" "}
        <span className="text-t-primary font-semibold">"{test_name}"</span>. You
        cannot enter until they finish.
      </p>
    </div>
    <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border border-amber-500/20 rounded-full">
      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse inline-block" />
      <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
        You'll be unblocked instantly when they finish.
      </span>
    </div>
    <button
      onClick={onBack}
      className="flex items-center gap-1.5 px-6 py-2 rounded-xl border border-[var(--border-color)] text-t-secondary hover:text-t-primary hover:border-[var(--color-brand)] text-sm font-medium transition-colors"
    >
      <ArrowLeft size={14} /> Go Back
    </button>
  </div>
);

const TesterBadge: React.FC<{
  name: string;
  status: "pass" | "fail" | "pending";
}> = ({ name, status }) => {
  if (!name) return null;
  const color =
    status === "pass"
      ? "text-green-400"
      : status === "fail"
      ? "text-red-400"
      : "text-t-muted";
  return (
    <span
      className={`flex items-center gap-1 text-[10px] font-medium ${color} opacity-80`}
    >
      <User size={10} />
      <span className="truncate max-w-[96px]">{name}</span>
    </span>
  );
};

const TableStepRow: React.FC<{
  step: ExecutionStep;
  signedImageUrls: Record<string, string>;
  isFocused: boolean;
  onUpdate: (
    stepId: string,
    status: "pass" | "fail" | "pending",
    remarks: string
  ) => void;
  onFocus: () => void;
  onRemarksChange: (val: string) => void;
  onImageClick: (paths: string[], idx: number, label: string) => void;
  rowRef?: (el: HTMLTableRowElement | null) => void;
}> = ({
  step,
  signedImageUrls,
  isFocused,
  onUpdate,
  onFocus,
  onRemarksChange,
  onImageClick,
  rowRef,
}) => {
  const [remarks, setRemarks] = useState(step.remarks || "");
  useEffect(() => {
    setRemarks(step.remarks || "");
  }, [step.remarks]);

  const rowBg =
    step.status === "pass"
      ? "bg-green-500/5"
      : step.status === "fail"
      ? "bg-red-500/5"
      : "";
  const focusStyle = isFocused
    ? { outline: "2px solid #38bdf8", outlineOffset: "-2px" }
    : {};

  return (
    <tr
      ref={rowRef}
      onClick={onFocus}
      style={focusStyle}
      className={`border-b border-[var(--border-color)] hover:bg-bg-card transition-colors cursor-pointer ${rowBg}`}
    >
      <td className="px-2 py-3 text-center border-r border-[var(--border-color)]">
        <span className="text-xs font-mono text-t-muted">{step.serial_no}</span>
      </td>
      <td className="px-4 py-3 border-r border-[var(--border-color)] align-top">
        <p className="text-sm text-t-primary leading-snug break-words whitespace-pre-wrap">
          {step.action}
        </p>
        {!!step.action_image_urls?.length && (
          <div className="mt-2 flex flex-wrap gap-2">
            {step.action_image_urls.map((path, i) =>
              signedImageUrls[path] ? (
                <img
                  key={path}
                  src={signedImageUrls[path]}
                  alt={`Action ${i + 1}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onImageClick(step.action_image_urls, i, "Action");
                  }}
                  className="w-16 h-16 rounded-lg object-cover border border-[var(--border-color)] cursor-zoom-in hover:opacity-90 hover:scale-105 transition-transform"
                />
              ) : null
            )}
          </div>
        )}
      </td>
      <td className="px-4 py-3 border-r border-[var(--border-color)] align-top">
        <p className="text-sm text-t-secondary leading-snug break-words whitespace-pre-wrap">
          {step.expected_result}
        </p>
        {!!step.expected_image_urls?.length && (
          <div className="mt-2 flex flex-wrap gap-2">
            {step.expected_image_urls.map((path, i) =>
              signedImageUrls[path] ? (
                <img
                  key={path}
                  src={signedImageUrls[path]}
                  alt={`Expected ${i + 1}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onImageClick(step.expected_image_urls, i, "Expected");
                  }}
                  className="w-16 h-16 rounded-lg object-cover border border-[var(--border-color)] cursor-zoom-in hover:opacity-90 hover:scale-105 transition-transform"
                />
              ) : null
            )}
          </div>
        )}
      </td>
      <td className="px-3 py-3 border-r border-[var(--border-color)]">
        <textarea
          value={remarks}
          onChange={(e) => {
            setRemarks(e.target.value);
            onRemarksChange(e.target.value);
          }}
          onFocus={onFocus}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onUpdate(step.stepId, "pass", remarks);
            }
          }}
          placeholder="Remarks… (Enter to pass)"
          rows={2}
          className="input text-sm resize-none w-full"
        />
      </td>
      <td className="px-2 py-3 text-center border-r border-[var(--border-color)]">
        <div className="flex flex-col items-center gap-1.5">
          <span
            className={`text-xs font-bold px-2 py-0.5 rounded-full capitalize ${
              step.status === "pass"
                ? "bg-green-500/15 text-green-400"
                : step.status === "fail"
                ? "bg-red-500/15 text-red-400"
                : "bg-[var(--border-color)] text-t-muted"
            }`}
          >
            {step.status}
          </span>
          <TesterBadge name={step.display_name} status={step.status} />
        </div>
      </td>
      <td className="px-2 py-3">
        <div className="flex flex-col items-center gap-1">
          <div className="flex gap-1 w-full">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUpdate(step.stepId, "pass", remarks);
              }}
              className={`flex-1 h-7 rounded-md text-xs font-bold transition-colors flex items-center justify-center ${
                step.status === "pass"
                  ? "bg-green-500 text-white"
                  : "bg-green-500/10 hover:bg-green-500/25 text-green-400 border border-green-500/20"
              }`}
            >
              <Check size={13} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUpdate(step.stepId, "fail", remarks);
              }}
              className={`flex-1 h-7 rounded-md text-xs font-bold transition-colors flex items-center justify-center ${
                step.status === "fail"
                  ? "bg-red-500 text-white"
                  : "bg-red-500/10 hover:bg-red-500/25 text-red-400 border border-red-500/20"
              }`}
            >
              <X size={13} />
            </button>
          </div>
          {step.status !== "pending" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUpdate(step.stepId, "pending", "");
              }}
              className="w-full h-7 rounded-md text-xs font-semibold text-t-muted hover:text-t-primary bg-bg-card hover:bg-bg-surface border border-[var(--border-color)] transition-colors flex items-center justify-center"
            >
              Undo
            </button>
          )}
        </div>
      </td>
    </tr>
  );
};

const MobileStepCard: React.FC<{
  step: ExecutionStep;
  signedImageUrls: Record<string, string>;
  isFocused: boolean;
  onUpdate: (
    stepId: string,
    status: "pass" | "fail" | "pending",
    remarks: string
  ) => void;
  onFocus: () => void;
  onRemarksChange: (val: string) => void;
  onImageClick: (paths: string[], idx: number, label: string) => void;
  cardRef?: (el: HTMLDivElement | null) => void;
}> = ({
  step,
  signedImageUrls,
  isFocused,
  onUpdate,
  onFocus,
  onRemarksChange,
  onImageClick,
  cardRef,
}) => {
  const [remarks, setRemarks] = useState(step.remarks || "");
  const [showRemarksDialog, setShowRemarksDialog] = useState(false);
  const [draftRemarks, setDraftRemarks] = useState(remarks);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setRemarks(step.remarks || "");
  }, [step.remarks]);

  const openDialog = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraftRemarks(remarks);
    setShowRemarksDialog(true);
    setTimeout(() => textareaRef.current?.focus(), 80);
  };
  const saveRemarks = () => {
    setRemarks(draftRemarks);
    onRemarksChange(draftRemarks);
    setShowRemarksDialog(false);
  };
  const discardRemarks = () => {
    setDraftRemarks(remarks);
    setShowRemarksDialog(false);
  };

  const rowBg =
    step.status === "pass"
      ? "bg-green-500/5"
      : step.status === "fail"
      ? "bg-red-500/5"
      : "";
  const accentColor = isFocused
    ? "#38bdf8"
    : step.status === "pass"
    ? "#22c55e"
    : step.status === "fail"
    ? "#ef4444"
    : "#374151";

  return (
    <>
      {showRemarksDialog && (
        <div
          className="fixed inset-0 z-[200] flex items-end justify-center"
          style={{
            backgroundColor: "rgba(0,0,0,0.55)",
            backdropFilter: "blur(4px)",
          }}
          onClick={discardRemarks}
        >
          <div
            className="w-full max-w-lg rounded-t-2xl border border-[var(--border-color)] shadow-2xl p-4 flex flex-col gap-3"
            style={{ backgroundColor: "var(--bg-surface)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-t-muted uppercase tracking-wider">
                Remarks — Step #{step.serial_no}
              </span>
              <button
                onClick={discardRemarks}
                className="w-7 h-7 rounded-full bg-[var(--border-color)] flex items-center justify-center text-t-muted hover:text-t-primary transition-colors"
              >
                <X size={13} />
              </button>
            </div>
            <textarea
              ref={textareaRef}
              value={draftRemarks}
              onChange={(e) => setDraftRemarks(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  saveRemarks();
                }
                if (e.key === "Escape") discardRemarks();
              }}
              placeholder="Enter remarks… (Enter to save, Shift+Enter for new line)"
              rows={4}
              className="input text-sm resize-none w-full"
            />
            <div className="flex gap-2">
              <button
                onClick={discardRemarks}
                className="flex-1 px-4 py-2.5 rounded-xl border border-[var(--border-color)] text-sm font-semibold text-t-secondary hover:text-t-primary transition-colors"
              >
                Discard
              </button>
              <button
                onClick={saveRemarks}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-c-brand hover:bg-c-brand/90 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        ref={cardRef}
        onClick={onFocus}
        className={`rounded-xl overflow-hidden border border-[var(--border-color)] w-full cursor-pointer transition-shadow ${rowBg} ${
          isFocused ? "ring-2 ring-sky-400" : ""
        }`}
        style={{ borderLeftColor: accentColor, borderLeftWidth: 3 }}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] bg-bg-card">
          <span className="text-xs font-mono text-t-muted tracking-wide">
            #{step.serial_no}
          </span>
          <div className="flex items-center gap-2 min-w-0">
            {isFocused && (
              <span className="flex items-center gap-1.5 text-[10px] font-medium shrink-0">
                <kbd className="px-1 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20 font-mono text-[9px]">
                  P
                </kbd>
                <span className="text-green-400">pass</span>
                <span className="text-t-muted opacity-40">·</span>
                <kbd className="px-1 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 font-mono text-[9px]">
                  F
                </kbd>
                <span className="text-red-400">fail</span>
              </span>
            )}
            <span
              className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full capitalize ${
                step.status === "pass"
                  ? "bg-green-500/15 text-green-400"
                  : step.status === "fail"
                  ? "bg-red-500/15 text-red-400"
                  : "bg-[var(--border-color)] text-t-muted"
              }`}
            >
              {step.status}
            </span>
            <TesterBadge name={step.display_name} status={step.status} />
          </div>
        </div>

        <div className="grid grid-cols-[80px_1fr] border-b border-[var(--border-color)]">
          <div className="px-3 py-2.5 border-r border-[var(--border-color)] bg-bg-card flex items-start">
            <span className="text-[10px] font-semibold text-t-muted uppercase tracking-wider mt-0.5">
              Action
            </span>
          </div>
          <div className="px-3 py-2.5 min-w-0">
            <p className="text-sm leading-snug break-words text-t-primary whitespace-pre-wrap">
              {step.action}
            </p>
            {!!step.action_image_urls?.length && (
              <div className="mt-2 flex flex-wrap gap-2">
                {step.action_image_urls.map((path, i) =>
                  signedImageUrls[path] ? (
                    <img
                      key={path}
                      src={signedImageUrls[path]}
                      alt={`Action ${i + 1}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onImageClick(step.action_image_urls, i, "Action");
                      }}
                      className="w-[72px] h-[72px] rounded-lg object-cover border border-[var(--border-color)] cursor-zoom-in hover:opacity-90 hover:scale-105 transition-transform"
                    />
                  ) : null
                )}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-[80px_1fr] border-b border-[var(--border-color)]">
          <div className="px-3 py-2.5 border-r border-[var(--border-color)] bg-bg-card flex items-start">
            <span className="text-[10px] font-semibold text-t-muted uppercase tracking-wider mt-0.5">
              Expected
            </span>
          </div>
          <div className="px-3 py-2.5 min-w-0">
            <p className="text-sm leading-snug break-words text-t-secondary whitespace-pre-wrap">
              {step.expected_result}
            </p>
            {!!step.expected_image_urls?.length && (
              <div className="mt-2 flex flex-wrap gap-2">
                {step.expected_image_urls.map((path, i) =>
                  signedImageUrls[path] ? (
                    <img
                      key={path}
                      src={signedImageUrls[path]}
                      alt={`Expected ${i + 1}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onImageClick(step.expected_image_urls, i, "Expected");
                      }}
                      className="w-[72px] h-[72px] rounded-lg object-cover border border-[var(--border-color)] cursor-zoom-in hover:opacity-90 hover:scale-105 transition-transform"
                    />
                  ) : null
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 bg-bg-card">
          <button
            onClick={openDialog}
            className={`flex-1 min-w-0 flex items-center gap-1.5 px-3 h-8 rounded-full border text-xs font-medium transition-colors truncate ${
              remarks
                ? "border-c-brand/40 bg-c-brand/8 text-t-primary hover:bg-c-brand/15"
                : "border-[var(--border-color)] bg-bg-surface text-t-muted hover:border-c-brand/40 hover:text-t-primary"
            }`}
          >
            <span className="truncate">{remarks || "Add remarks…"}</span>
            {remarks && (
              <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-c-brand" />
            )}
          </button>
          {step.status !== "pending" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUpdate(step.stepId, "pending", "");
              }}
              className="shrink-0 px-2.5 h-8 rounded-md text-xs font-semibold text-t-muted hover:text-t-primary bg-bg-surface hover:bg-bg-card border border-[var(--border-color)] transition-colors"
            >
              Undo
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUpdate(step.stepId, "pass", remarks);
            }}
            className={`shrink-0 w-8 h-8 rounded-md text-xs font-bold transition-colors flex items-center justify-center ${
              step.status === "pass"
                ? "bg-green-500 text-white"
                : "bg-green-500/10 hover:bg-green-500/25 text-green-400 border border-green-500/20"
            }`}
          >
            <Check size={14} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUpdate(step.stepId, "fail", remarks);
            }}
            className={`shrink-0 w-8 h-8 rounded-md text-xs font-bold transition-colors flex items-center justify-center ${
              step.status === "fail"
                ? "bg-red-500 text-white"
                : "bg-red-500/10 hover:bg-red-500/25 text-red-400 border border-red-500/20"
            }`}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

const TestExecution: React.FC<Props> = ({
  module_name,
  initialmodule_test_id,
  isAdmin = false,
  onBack,
}) => {
  const { user } = useAuth();
  const { addToast } = useToast();
  const log = useaudit_log();

  const currentMtId = initialmodule_test_id;
  const testsName = currentMtId.slice(module_name.length + 1);

  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [showExportModal, setShowExportModal] = useState(false);
  const [showUndoModal, setShowUndoModal] = useState(false);
  const [showMassImageUpload, setShowMassImageUpload] = useState(false);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const [focusedStepId, setFocusedStepId] = useState<string | null>(null);
  const [signedImageUrls, setSignedImageUrls] = useState<SignedImageMap>({});
  const [imagePreview, setImagePreview] = useState<ImagePreviewState | null>(
    null
  );
  const [moduleTests, setModuleTests] = useState<ModuleTestItem[]>([]);
  const [steps, setSteps] = useState<ExecutionStep[]>([]);
  const [lock, setLock] = useState<any>(null);
  const [ownsLock, setOwnsLock] = useState(false); // ✅ tracks if THIS user holds the lock
  const [loading, setLoading] = useState(true);
  const [lockLoading, setLockLoading] = useState(true);

  const stepsInitialized = useRef(false);
  const remarksMap = useRef<Record<string, string>>({});
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const trRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const openImagePreview = useCallback(
    (paths: string[], clickedIdx: number, label: string) => {
      const urls = paths.map((p) => signedImageUrls[p]).filter(Boolean);
      if (urls.length) setImagePreview({ urls, idx: clickedIdx, label });
    },
    [signedImageUrls]
  );

  // ── Heartbeat helpers ─────────────────────────────────────────────────────
  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    stopHeartbeat();
    if (!user?.id) return;
    heartbeatRef.current = setInterval(() => {
      heartbeatLock(currentMtId, user.id).catch(() => {});
    }, 20_000); // every 20s
  }, [currentMtId, user?.id, stopHeartbeat]);

  // ── Load data ─────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    setLockLoading(true);
    stepsInitialized.current = false;
    setFocusedStepId(null);
    remarksMap.current = {};

    (async () => {
      const [mtRes, srRes, lockRes] = await Promise.all([
        supabase
          .from("module_tests")
          .select("id, tests_name")
          .eq("module_name", module_name)
          .order("id"),
        supabase
          .from("step_results")
          .select(
            `id, status, remarks, display_name,
            step:test_steps(id, serial_no, action, expected_result, is_divider, action_image_urls, expected_image_urls, tests_name)`
          )
          .eq("module_name", module_name),
        supabase
          .from("test_locks")
          .select("module_test_id, user_id, locked_by_name")
          .eq("module_test_id", currentMtId),
      ]);

      const rawMts = (mtRes.data ?? []) as { id: string; tests_name: string }[];
      const rawSrs = (srRes.data ?? []) as any[];

      const testNames = Array.from(new Set(rawMts.map((m) => m.tests_name)));
      const testsRes = testNames.length
        ? await supabase
            .from("tests")
            .select("name, serial_no")
            .in("name", testNames)
        : { data: [] };
      const testsMap = Object.fromEntries(
        ((testsRes.data ?? []) as { name: string; serial_no: string }[]).map(
          (t) => [t.name, t]
        )
      );

      setModuleTests(
        rawMts.map((m) => ({
          id: m.id,
          tests_name: m.tests_name,
          test: testsMap[m.tests_name] ?? null,
        }))
      );

      const merged: ExecutionStep[] = rawSrs
        .filter((sr) => sr.step && sr.step.tests_name === testsName)
        .map((sr) => ({
          stepId: sr.step.id,
          stepResultId: sr.id,
          module_test_id: currentMtId,
          serial_no: sr.step.serial_no,
          action: sr.step.action,
          expected_result: sr.step.expected_result,
          action_image_urls: sr.step.action_image_urls || [],
          expected_image_urls: sr.step.expected_image_urls || [],
          is_divider: sr.step.is_divider,
          status: sr.status as "pass" | "fail" | "pending",
          remarks: sr.remarks,
          display_name: sr.display_name ?? "",
        }))
        .sort((a, b) =>
          a.serial_no !== b.serial_no
            ? a.serial_no - b.serial_no
            : (a.is_divider ? 0 : 1) - (b.is_divider ? 0 : 1)
        );

      setSteps(merged);
      setLock(lockRes.data?.[0] ?? null);
      setLoading(false);
      setLockLoading(false);
    })();

    // ✅ Channel names are user-scoped — prevents Web Lock collision between users
    const uid = user?.id ?? "anon";

    const lockChannel = supabase
      .channel(`lock:${currentMtId}:${uid}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "test_locks",
          filter: `module_test_id=eq.${currentMtId}`,
        },
        ({ eventType, new: newRow }: any) => {
          if (eventType === "DELETE") setLock(null);
          else setLock(newRow);
        }
      )
      .subscribe();

    const srChannel = supabase
      .channel(`sr:${module_name}:${testsName}:${uid}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "step_results",
          filter: `module_name=eq.${module_name}`,
        },
        ({ new: updated }: any) => {
          setSteps((prev) =>
            prev.map((s) =>
              s.stepResultId === updated.id
                ? {
                    ...s,
                    status: updated.status,
                    remarks: updated.remarks,
                    display_name: updated.display_name ?? "",
                  }
                : s
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(lockChannel);
      supabase.removeChannel(srChannel);
    };
  }, [module_name, currentMtId, testsName, user?.id]);

  // ── Acquire lock on mount ─────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id || lockLoading) return;
    let cancelled = false;

    (async () => {
      const acquired = await acquireLock(
        currentMtId,
        user.id,
        user.user_metadata?.display_name ?? user.email ?? "User"
      );
      if (cancelled) return;

      setOwnsLock(acquired);

      // ✅ Only start heartbeat if WE own the lock — not if lock was refused
      if (acquired) startHeartbeat();
    })();

    return () => {
      cancelled = true;
      stopHeartbeat();
      if (user?.id) releaseLock(currentMtId, user.id).catch(() => {});
      setOwnsLock(false);
    };
  }, [currentMtId, user?.id, lockLoading, startHeartbeat, stopHeartbeat]);

  // ── Signed image URLs ─────────────────────────────────────────────────────
  useEffect(() => {
    const allPaths = steps.flatMap((s) => [
      ...(s.action_image_urls || []),
      ...(s.expected_image_urls || []),
    ]);
    if (!allPaths.length) {
      setSignedImageUrls({});
      return;
    }
    let cancelled = false;
    (async () => {
      const unique = Array.from(new Set(allPaths.filter(Boolean)));
      const results = await Promise.all(
        unique.map(async (path) => {
          const { data } = await supabase.storage
            .from("test_steps")
            .createSignedUrl(path, 3600);
          return [path, data?.signedUrl ?? ""] as const;
        })
      );
      if (!cancelled)
        setSignedImageUrls(
          Object.fromEntries(results.filter(([, url]) => !!url))
        );
    })();
    return () => {
      cancelled = true;
    };
  }, [steps]);

  // ── Auto-focus first pending step ─────────────────────────────────────────
  useEffect(() => {
    if (steps.length === 0 || stepsInitialized.current) return;
    stepsInitialized.current = true;
    const firstPending = steps.find(
      (s) => !s.is_divider && s.status === "pending"
    );
    if (firstPending) {
      setFocusedStepId(firstPending.stepId);
      setScrollTarget(firstPending.stepId);
    }
  }, [steps]);

  // ── Clean up stale refs ───────────────────────────────────────────────────
  useEffect(() => {
    const live = new Set(steps.map((s) => s.stepId));
    for (const id of Object.keys(trRefs.current)) {
      if (!live.has(id)) delete trRefs.current[id];
    }
    for (const id of Object.keys(cardRefs.current)) {
      if (!live.has(id)) delete cardRefs.current[id];
    }
  }, [steps]);

  // ── Scroll to target ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!scrollTarget || loading) return;
    let r1: number, r2: number;
    r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => {
        const isDesktop = window.innerWidth >= 768;
        const el = isDesktop
          ? trRefs.current[scrollTarget]
          : cardRefs.current[scrollTarget];
        const container = scrollContainerRef.current;
        if (!el || !container) return;
        const elRect = el.getBoundingClientRect();
        const cRect = container.getBoundingClientRect();
        const theadH = isDesktop
          ? (container.querySelector("thead") as HTMLElement | null)
              ?.offsetHeight ?? 0
          : 0;
        const scrollTo =
          elRect.top -
          cRect.top +
          container.scrollTop -
          (cRect.height - theadH) / 2 +
          elRect.height / 2 +
          theadH;
        container.scrollTo({ top: Math.max(0, scrollTo), behavior: "smooth" });
        setScrollTarget(null);
      });
    });
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
  }, [scrollTarget, loading]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    if (!ownsLock) return; // ✅ Only handle keyboard if we own the lock
    const real = steps.filter((s) => !s.is_divider);
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const idx = real.findIndex((s) => s.stepId === focusedStepId);
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        const next = real[idx + 1];
        if (next) {
          setFocusedStepId(next.stepId);
          setScrollTarget(next.stepId);
        }
      }
      if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        const prev = real[idx - 1];
        if (prev) {
          setFocusedStepId(prev.stepId);
          setScrollTarget(prev.stepId);
        }
      }
      if (e.key === "p" || e.key === "P") {
        if (focusedStepId)
          handleUpdate(
            focusedStepId,
            "pass",
            remarksMap.current[focusedStepId] ?? ""
          );
      }
      if (e.key === "f" || e.key === "F") {
        if (focusedStepId)
          handleUpdate(
            focusedStepId,
            "fail",
            remarksMap.current[focusedStepId] ?? ""
          );
      }
      if (e.key === "u" || e.key === "U") {
        if (focusedStepId) handleUpdate(focusedStepId, "pending", "");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [focusedStepId, steps, ownsLock]);

  // ── Update step ───────────────────────────────────────────────────────────
  const handleUpdate = useCallback(
    async (
      stepId: string,
      status: "pass" | "fail" | "pending",
      remarks: string
    ) => {
      if (!ownsLock) {
        addToast("You don't have the lock for this test.", "error");
        return;
      }

      const step = steps.find((s) => s.stepId === stepId);
      if (!step) return;

      setSteps((prev) =>
        prev.map((s) => (s.stepId === stepId ? { ...s, status, remarks } : s))
      );

      const { error } = await supabase
        .from("step_results")
        .update({
          status,
          remarks,
          display_name: user?.user_metadata?.display_name ?? user?.email ?? "",
        })
        .eq("id", step.stepResultId);

      if (error) {
        addToast("Failed to update step", "error");
        setSteps((prev) =>
          prev.map((s) =>
            s.stepId === stepId
              ? { ...s, status: step.status, remarks: step.remarks }
              : s
          )
        );
        return;
      }

      const actionLabel =
        status === "pass" ? "Passed" : status === "fail" ? "Failed" : "Reset";
      log(
        `${actionLabel} step: ${step.action.slice(0, 60)}`,
        status === "pending" ? "info" : status
      );

      // Auto-advance to next pending after pass/fail
      if (status !== "pending") {
        const real = steps.filter((s) => !s.is_divider);
        const idx = real.findIndex((s) => s.stepId === stepId);
        const next = real.slice(idx + 1).find((s) => s.status === "pending");
        if (next) {
          setFocusedStepId(next.stepId);
          setScrollTarget(next.stepId);
        }
      }
    },
    [steps, ownsLock, user, addToast, log]
  );

  // ── Undo all ──────────────────────────────────────────────────────────────
  const handleUndoAll = async () => {
    if (!ownsLock) {
      addToast("You don't have the lock for this test.", "error");
      return;
    }
    const done = steps.filter((s) => !s.is_divider && s.status !== "pending");
    const ids = done.map((s) => s.stepResultId);
    if (!ids.length) return;

    setSteps((prev) =>
      prev.map((s) =>
        s.is_divider ? s : { ...s, status: "pending", remarks: "" }
      )
    );
    setShowUndoModal(false);

    const { error } = await supabase
      .from("step_results")
      .update({ status: "pending", remarks: "", display_name: "" })
      .in("id", ids);

    if (error) {
      addToast("Failed to reset steps", "error");
      return;
    }
    log(`Reset all steps for ${testsName} in ${module_name}`, "info");
    stepsInitialized.current = false;
  };

  // ── Export flat data ──────────────────────────────────────────────────────
  const buildFlatData = (): FlatData[] =>
    steps
      .filter((s) => !s.is_divider)
      .map((s) => ({
        module: module_name,
        test: testsName,
        serial: s.serial_no,
        action: s.action,
        expected: s.expected_result,
        remarks: s.remarks,
        status: s.status,
      }));

  // ── Filtered + searched steps ─────────────────────────────────────────────
  const visible = useMemo(() => {
    const q = search.toLowerCase();
    return steps.filter((s) => {
      if (s.is_divider) return true;
      if (filter !== "all" && s.status !== filter) return false;
      if (
        q &&
        !s.action.toLowerCase().includes(q) &&
        !s.expected_result.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [steps, filter, search]);

  const doneCount = steps.filter(
    (s) => !s.is_divider && s.status !== "pending"
  ).length;
  const totalReal = steps.filter((s) => !s.is_divider).length;

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading || lockLoading)
    return (
      <div className="flex-1 flex flex-col">
        <Topbar title={testsName} subtitle={module_name} onBack={onBack} />
        <div className="flex items-center justify-center flex-1">
          <Spinner />
        </div>
      </div>
    );

  // ── Locked by someone else ────────────────────────────────────────────────
  if (lock && lock.user_id !== user?.id)
    return (
      <div className="flex-1 flex flex-col">
        <Topbar
          title={testsName}
          subtitle={module_name}
          onBack={onBack}
          actions={
            isAdmin ? (
              <button
                onClick={() =>
                  forceReleaseLock(currentMtId).then(() => setLock(null))
                }
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 transition"
              >
                <Lock size={12} /> Force Unlock
              </button>
            ) : undefined
          }
        />
        <LockedScreen
          locked_by_name={lock.locked_by_name}
          test_name={testsName}
          onBack={onBack}
        />
      </div>
    );

  // ── Render ────────────────────────────────────────────────────────────────
  const currentTest = moduleTests.find((mt) => mt.id === currentMtId);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {showUndoModal && (
        <UndoAllModal
          doneCount={doneCount}
          totalCount={totalReal}
          onConfirm={handleUndoAll}
          onCancel={() => setShowUndoModal(false)}
        />
      )}
      {imagePreview && (
        <ImagePreviewModal
          images={imagePreview.urls}
          initialIndex={imagePreview.idx}
          label={imagePreview.label}
          onClose={() => setImagePreview(null)}
        />
      )}
      {showMassImageUpload && (
        <MassImageUploadModal
          module_test_id={currentMtId}
          onClose={() => setShowMassImageUpload(false)}
        />
      )}
      {showExportModal && (
        <ExportModal
          isOpen={showExportModal}
          onClose={() => setShowExportModal(false)}
          title="Export Execution"
          subtitle={testsName}
          stats={[
            { label: "Total", value: totalReal },
            { label: "Done", value: doneCount },
            { label: "Pending", value: totalReal - doneCount },
          ]}
          options={[
            {
              label: "CSV",
              icon: <FileSpreadsheet size={16} />,
              color: "bg-[var(--color-primary)]",
              hoverColor: "hover:bg-[var(--color-primary-hover)]",
              onConfirm: () => exportExecutionCSV(buildFlatData()),
            },
            {
              label: "PDF",
              icon: <FileText size={16} />,
              color: "bg-[var(--color-blue)]",
              hoverColor: "hover:bg-[var(--color-blue-hover)]",
              onConfirm: () => exportExecutionPDF(buildFlatData()),
            },
          ]}
        />
      )}

      <Topbar
        title={currentTest?.test?.name ?? testsName}
        subtitle={`${module_name} · ${doneCount}/${totalReal} done`}
        onBack={onBack}
        actions={
          <div className="flex items-center gap-2">
            {ownsLock && (
              <>
                <button
                  onClick={() => setShowUndoModal(true)}
                  disabled={doneCount === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 disabled:opacity-40 transition"
                >
                  <RotateCcw size={12} /> Reset
                </button>
                <button
                  onClick={() => setShowMassImageUpload(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-bg-card hover:bg-bg-surface border border-[var(--border-color)] text-t-primary transition"
                >
                  <Upload size={12} /> Images
                </button>
              </>
            )}
            <button
              onClick={() => setShowExportModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-bg-card hover:bg-bg-surface border border-[var(--border-color)] text-t-primary transition"
            >
              <FileSpreadsheet size={12} /> Export
            </button>
          </div>
        }
      />

      {/* Filter + Search bar */}
      <div className="px-4 pt-3 pb-2 flex flex-wrap items-center gap-2 border-b border-[var(--border-color)] bg-bg-surface shrink-0">
        <div className="flex items-center gap-1 bg-bg-base rounded-xl p-1">
          {(["all", "pass", "fail", "pending"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs font-semibold px-3 py-1 rounded-lg transition-colors capitalize ${
                filter === f
                  ? "bg-c-brand text-white"
                  : "text-t-muted hover:text-t-primary"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search steps…"
          className="input text-xs py-1.5 flex-1 min-w-[140px] max-w-xs"
        />
        {!ownsLock && lock && (
          <span className="flex items-center gap-1.5 text-xs text-amber-400 font-medium px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <Lock size={11} /> Read-only
          </span>
        )}
      </div>

      {/* Steps — Desktop table */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        <div className="hidden md:block">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-bg-surface border-b border-[var(--border-color)]">
              <tr>
                <th className="px-2 py-3 text-xs text-t-muted font-semibold border-r border-[var(--border-color)] w-10">
                  #
                </th>
                <th className="px-4 py-3 text-xs text-t-muted font-semibold text-left border-r border-[var(--border-color)]">
                  Action
                </th>
                <th className="px-4 py-3 text-xs text-t-muted font-semibold text-left border-r border-[var(--border-color)]">
                  Expected Result
                </th>
                <th className="px-3 py-3 text-xs text-t-muted font-semibold text-left border-r border-[var(--border-color)] w-44">
                  Remarks
                </th>
                <th className="px-2 py-3 text-xs text-t-muted font-semibold border-r border-[var(--border-color)] w-20">
                  Status
                </th>
                <th className="px-2 py-3 text-xs text-t-muted font-semibold w-24">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((step) => {
                if (step.is_divider) {
                  const lvl = getDividerLevel(step.expected_result);
                  const d = DIVIDER_LEVELS[lvl] ?? DIVIDER_LEVELS[1];
                  return (
                    <tr key={step.stepId} className={`${d.bg} ${d.border}`}>
                      <td colSpan={6} className={`${d.indent} py-2`}>
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${d.dot} shrink-0`}
                          />
                          <span className={`${d.size} ${d.text}`}>
                            {step.action}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <TableStepRow
                    key={step.stepId}
                    step={step}
                    signedImageUrls={signedImageUrls}
                    isFocused={focusedStepId === step.stepId}
                    onUpdate={
                      ownsLock
                        ? handleUpdate
                        : () =>
                            addToast(
                              "Read-only — you don't hold this lock.",
                              "error"
                            )
                    }
                    onFocus={() => setFocusedStepId(step.stepId)}
                    onRemarksChange={(val) => {
                      remarksMap.current[step.stepId] = val;
                    }}
                    onImageClick={openImagePreview}
                    rowRef={(el) => {
                      trRefs.current[step.stepId] = el;
                    }}
                  />
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Steps — Mobile cards */}
        <div className="md:hidden flex flex-col gap-2 p-3">
          {visible.map((step) => {
            if (step.is_divider) {
              const lvl = getDividerLevel(step.expected_result);
              const d = MOBILE_DIVIDER_LEVELS[lvl] ?? MOBILE_DIVIDER_LEVELS[1];
              return (
                <div
                  key={step.stepId}
                  className={`${d.bg} ${d.border} ${d.ml} ${d.py} px-3 rounded-r-lg`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full ${d.dotClass}`}
                      style={{ width: d.dotSize, height: d.dotSize }}
                    />
                    <span className={`${d.fontSize} ${d.textClass}`}>
                      {step.action}
                    </span>
                  </div>
                </div>
              );
            }
            return (
              <MobileStepCard
                key={step.stepId}
                step={step}
                signedImageUrls={signedImageUrls}
                isFocused={focusedStepId === step.stepId}
                onUpdate={
                  ownsLock
                    ? handleUpdate
                    : () =>
                        addToast(
                          "Read-only — you don't hold this lock.",
                          "error"
                        )
                }
                onFocus={() => setFocusedStepId(step.stepId)}
                onRemarksChange={(val) => {
                  remarksMap.current[step.stepId] = val;
                }}
                onImageClick={openImagePreview}
                cardRef={(el) => {
                  cardRefs.current[step.stepId] = el;
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default TestExecution;
