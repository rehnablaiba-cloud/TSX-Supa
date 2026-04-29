// src/components/TestExecution/TestExecution.tsx
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
import { useActiveLock } from "../../context/ActiveLockContext";
import { supabase } from "../../supabase";
import Topbar from "../Layout/Topbar";
import Spinner from "../UI/Spinner";
import ExportModal from "../UI/ExportModal";
import MassImageUploadModal from "../UI/MassImageUploadModal";
import useAuditLog from "../../hooks/useAuditLog";
import { exportExecutionCSV, exportExecutionPDF } from "../../utils/export";
import type { FlatData } from "../../utils/export";
import {
  acquireLock,
  releaseLock,
  forceReleaseLock,
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

interface TestLock {
  module_test_id: string;
  user_id: string;
  locked_by_name: string;
}

type SignedImageMap = Record<string, string>;

interface ImagePreviewState {
  urls: string[];
  idx: number;
  label: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Divider configs  —  driven by CSS custom properties
// ─────────────────────────────────────────────────────────────────────────────

const DIVIDER_LEVELS: Record<
  number,
  {
    dot: string;
    text: string;
    bgStyle: React.CSSProperties;
    border: string;
    indent: string;
    size: string;
  }
> = {
  1: {
    dot: "bg-c-brand",
    text: "text-c-brand",
    bgStyle: { backgroundColor: "var(--color-brand-bg)" },
    border: "border-l-[3px] border-c-brand",
    indent: "px-4",
    size: "text-xs font-bold tracking-widest uppercase",
  },
  2: {
    dot: "bg-divider-2",
    text: "text-divider-2",
    bgStyle: {
      backgroundColor:
        "color-mix(in srgb, var(--color-divider-2) 5%, transparent)",
    },
    border: "border-l-2 border-divider-2",
    indent: "px-8",
    size: "text-xs font-semibold tracking-wider uppercase",
  },
  3: {
    dot: "bg-divider-3",
    text: "text-divider-3",
    bgStyle: {
      backgroundColor:
        "color-mix(in srgb, var(--color-divider-3) 5%, transparent)",
    },
    border: "border-l-2 border-divider-3",
    indent: "px-12",
    size: "text-[11px] font-medium tracking-wide",
  },
};

const MOBILE_DIVIDER_LEVELS: Record<
  number,
  {
    bgStyle: React.CSSProperties;
    borderStyle: React.CSSProperties;
    textClass: string;
    dotClass: string;
    dotSize: number;
    fontSize: string;
    ml: string;
    py: string;
  }
> = {
  1: {
    bgStyle: {
      backgroundColor:
        "color-mix(in srgb, var(--color-divider-1) 10%, transparent)",
    },
    borderStyle: { borderLeft: "3px solid var(--color-divider-1)" },
    textClass: "text-divider-1",
    dotClass: "bg-divider-1",
    dotSize: 7,
    fontSize: "text-[14px] font-bold tracking-widest uppercase",
    ml: "ml-0",
    py: "py-2.5",
  },
  2: {
    bgStyle: {
      backgroundColor:
        "color-mix(in srgb, var(--color-divider-2) 10%, transparent)",
    },
    borderStyle: { borderLeft: "2px solid var(--color-divider-2)" },
    textClass: "text-divider-2",
    dotClass: "bg-divider-2",
    dotSize: 5,
    fontSize: "text-[12px] font-semibold tracking-wide uppercase",
    ml: "ml-4",
    py: "py-2",
  },
  3: {
    bgStyle: {
      backgroundColor:
        "color-mix(in srgb, var(--color-divider-3) 10%, transparent)",
    },
    borderStyle: { borderLeft: "2px solid var(--color-divider-3)" },
    textClass: "text-divider-3",
    dotClass: "bg-divider-3",
    dotSize: 4,
    fontSize: "text-[11px] font-medium tracking-wide",
    ml: "ml-8",
    py: "py-1.5",
  },
};

const getDividerLevel = (step: ExecutionStep): number => {
  if (!step.is_divider) return 1;
  return Math.min(Math.max(parseInt(step.expected_result, 10) || 1, 1), 3);
};

const cleanDividerLabel = (action: string): string =>
  action.replace(/^[^\p{L}\p{N}]+/u, "");

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

const UndoAllModal: React.FC<{
  doneCount: number;
  totalCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ doneCount, totalCount, onConfirm, onCancel }) => {
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Reset all steps confirmation"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        backgroundColor: "color-mix(in srgb, var(--bg-base) 55%, transparent)",
        backdropFilter: `blur(var(--glass-blur))`,
      }}
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
          <div className="w-14 h-14 rounded-full bg-[color-mix(in_srgb,var(--color-pend)_10%,transparent)] border-2 border-[color-mix(in_srgb,var(--color-pend)_30%,transparent)] flex items-center justify-center">
            <AlertTriangle size={26} className="text-pend" />
          </div>
          <div>
            <h2 className="text-base font-bold text-t-primary">
              Reset All Steps?
            </h2>
            <p className="text-sm text-t-muted mt-1">
              This will mark all{" "}
              <span className="font-semibold text-t-primary">{doneCount}</span>{" "}
              completed step{doneCount !== 1 ? "s" : ""} (out of{" "}
              <span className="font-semibold text-t-primary">{totalCount}</span>
              ) back to <span className="font-semibold text-pend">pending</span>
              .
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[color-mix(in_srgb,var(--color-pend)_8%,transparent)] border border-[color-mix(in_srgb,var(--color-pend)_25%,transparent)] text-xs text-[color-mix(in_srgb,var(--color-pend),black_15%)] dark:text-[color-mix(in_srgb,var(--color-pend),white_30%)]">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>
            All remarks and results will be cleared.{" "}
            <strong>This cannot be undone.</strong>
          </span>
        </div>
        <div className="flex gap-2 pt-1">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-xl border text-sm font-semibold text-t-secondary hover:text-t-primary hover:border-(--color-brand) border-(--border-color) bg-bg-card transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-(--bg-surface) bg-(--color-warn) hover:bg-[color-mix(in_srgb,var(--color-warn),black_10%)] active:bg-[color-mix(in_srgb,var(--color-warn),black_20%)] transition-colors flex items-center justify-center gap-1.5"
          >
            <RotateCcw size={14} /> Yes, Reset All
          </button>
        </div>
      </div>
    </div>
  );
};

const ImagePreviewModal: React.FC<{
  images: string[];
  initialIndex: number;
  label: string;
  onClose: () => void;
}> = ({ images, initialIndex, label, onClose }) => {
  const [idx, setIdx] = useState(initialIndex);
  const total = images.length;

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIdx((i) => (i + 1) % total);
      if (e.key === "ArrowLeft") setIdx((i) => (i - 1 + total) % total);
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = original;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, total]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${label} image preview`}
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{
        zIndex: 100,
        background: "color-mix(in srgb, var(--bg-base) 92%, transparent)",
        backdropFilter: `blur(var(--glass-blur))`,
      }}
      onClick={onClose}
    >
      <button
        onClick={onClose}
        aria-label="Close image preview"
        className="absolute top-4 right-4 w-9 h-9 rounded-full bg-t-primary/10 hover:bg-t-primary/20 border border-t-primary/20 flex items-center justify-center text-t-primary transition-colors z-10"
      >
        <X size={16} />
      </button>
      <div className="absolute top-4 left-4 flex items-center gap-2 z-10">
        <span className="text-xs font-semibold text-t-muted uppercase tracking-wider">
          {label}
        </span>
        {total > 1 && (
          <span className="text-xs text-t-muted/60">
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
          aria-label="Previous image"
          className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-t-primary/10 hover:bg-t-primary/20 border border-t-primary/20 flex items-center justify-center text-t-primary transition-colors z-10"
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
          className="max-w-full max-h-[80vh] rounded-xl object-contain shadow-2xl border border-t-primary/10"
        />
      </div>
      {total > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIdx((i) => (i + 1) % total);
          }}
          aria-label="Next image"
          className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-t-primary/10 hover:bg-t-primary/20 border border-t-primary/20 flex items-center justify-center text-t-primary transition-colors z-10"
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
              aria-label={`View image ${i + 1}`}
              className={`w-10 h-10 rounded-lg overflow-hidden border-2 transition-all ${
                i === idx
                  ? "border-t-primary scale-110"
                  : "border-t-primary/25 opacity-55 hover:opacity-90"
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
    <div className="w-16 h-16 rounded-full bg-[color-mix(in_srgb,var(--color-pend)_10%,transparent)] border-2 border-[color-mix(in_srgb,var(--color-pend)_30%,transparent)] flex items-center justify-center">
      <Lock size={28} className="text-pend" />
    </div>
    <div>
      <h2 className="text-lg font-bold text-t-primary mb-1">
        Test In Progress
      </h2>
      <p className="text-t-secondary text-sm max-w-sm">
        <span className="text-[color-mix(in_srgb,var(--color-pend),black_15%)] dark:text-[color-mix(in_srgb,var(--color-pend),white_30%)] font-semibold">
          {locked_by_name}
        </span>{" "}
        is currently executing{" "}
        <span className="text-t-primary font-semibold">"{test_name}"</span>. You
        cannot enter until they finish.
      </p>
    </div>
    <div className="flex items-center gap-2 px-4 py-2 bg-[color-mix(in_srgb,var(--color-pend)_10%,transparent)] border border-[color-mix(in_srgb,var(--color-pend)_20%,transparent)] rounded-full">
      <span className="w-2 h-2 rounded-full bg-(--color-warn) animate-pulse inline-block" />
      <span className="text-xs text-[color-mix(in_srgb,var(--color-pend),black_15%)] dark:text-[color-mix(in_srgb,var(--color-pend),white_30%)] font-medium">
        You'll be unblocked instantly when they finish.
      </span>
    </div>
    <button
      onClick={onBack}
      className="flex items-center gap-1.5 px-6 py-2 rounded-xl border border-(--border-color) text-t-secondary hover:text-t-primary hover:border-(--color-brand) text-sm font-medium transition-colors"
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
      ? "text-[color-mix(in_srgb,var(--color-pass),white_30%)]"
      : status === "fail"
      ? "text-fail"
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

// ─────────────────────────────────────────────────────────────────────────────
// Desktop Table Row
// ─────────────────────────────────────────────────────────────────────────────

const TableStepRow: React.FC<{
  step: ExecutionStep;
  initialRemarks: string;
  signedImageUrls: Record<string, string>;
  isFocused: boolean;
  isUpdating?: boolean;
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
  initialRemarks,
  signedImageUrls,
  isFocused,
  isUpdating = false,
  onUpdate,
  onFocus,
  onRemarksChange,
  onImageClick,
  rowRef,
}) => {
  const [remarks, setRemarks] = useState(initialRemarks);

  useEffect(() => {
    setRemarks(initialRemarks);
  }, [initialRemarks]);

  const rowBg =
    step.status === "pass"
      ? "bg-[color-mix(in_srgb,var(--color-pass)_5%,transparent)]"
      : step.status === "fail"
      ? "bg-fail/5"
      : "";
  const focusStyle = isFocused
    ? { outline: "2px solid var(--color-brand)", outlineOffset: "-2px" }
    : {};

  return (
    <tr
      ref={rowRef}
      onClick={onFocus}
      style={focusStyle}
      className={`border-b border-(--border-color) hover:bg-bg-card transition-colors cursor-pointer ${rowBg}`}
    >
      <td className="px-2 py-3 text-center border-r border-(--border-color)">
        <span className="text-xs font-mono text-t-muted">{step.serial_no}</span>
      </td>
      <td className="px-4 py-3 border-r border-(--border-color) align-top">
        <p className="text-sm text-t-primary leading-snug wrap-break-word whitespace-pre-wrap">
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
                  className="w-16 h-16 rounded-lg object-cover border border-(--border-color) cursor-zoom-in hover:opacity-90 hover:scale-105 transition-transform"
                />
              ) : null
            )}
          </div>
        )}
      </td>
      <td className="px-4 py-3 border-r border-(--border-color) align-top">
        <p className="text-sm text-t-secondary leading-snug wrap-break-word whitespace-pre-wrap">
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
                  className="w-16 h-16 rounded-lg object-cover border border-(--border-color) cursor-zoom-in hover:opacity-90 hover:scale-105 transition-transform"
                />
              ) : null
            )}
          </div>
        )}
      </td>
      <td className="px-3 py-3 border-r border-(--border-color)">
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
      <td className="px-2 py-3 text-center border-r border-(--border-color)">
        <div className="flex flex-col items-center gap-1.5">
          <span
            className={`text-xs font-bold px-2 py-0.5 rounded-full capitalize ${
              step.status === "pass"
                ? "bg-[color-mix(in_srgb,var(--color-pass)_15%,transparent)] text-[color-mix(in_srgb,var(--color-pass),white_30%)]"
                : step.status === "fail"
                ? "bg-fail/15 text-fail"
                : "bg-(--border-color) text-t-muted"
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
              disabled={isUpdating}
              className={`flex-1 h-7 rounded-md text-xs font-bold transition-colors flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed ${
                step.status === "pass"
                  ? "bg-pass text-(--bg-surface)"
                  : "bg-[color-mix(in_srgb,var(--color-pass)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-pass)_25%,transparent)] text-[color-mix(in_srgb,var(--color-pass),white_30%)] border border-[color-mix(in_srgb,var(--color-pass)_20%,transparent)]"
              }`}
            >
              <Check size={13} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUpdate(step.stepId, "fail", remarks);
              }}
              disabled={isUpdating}
              className={`flex-1 h-7 rounded-md text-xs font-bold transition-colors flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed ${
                step.status === "fail"
                  ? "bg-fail text-(--bg-surface)"
                  : "bg-fail/10 hover:bg-fail/25 text-fail border border-fail/20"
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
              disabled={isUpdating}
              className="w-full h-7 rounded-md text-xs font-semibold text-t-muted hover:text-t-primary bg-bg-card hover:bg-bg-surface border border-(--border-color) transition-colors flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Undo
            </button>
          )}
        </div>
      </td>
    </tr>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Mobile Step Card
// ─────────────────────────────────────────────────────────────────────────────

const MobileStepCard: React.FC<{
  step: ExecutionStep;
  initialRemarks: string;
  signedImageUrls: Record<string, string>;
  isFocused: boolean;
  isUpdating?: boolean;
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
  initialRemarks,
  signedImageUrls,
  isFocused,
  isUpdating = false,
  onUpdate,
  onFocus,
  onRemarksChange,
  onImageClick,
  cardRef,
}) => {
  const [remarks, setRemarks] = useState(initialRemarks);
  const [showRemarksDialog, setShowRemarksDialog] = useState(false);
  const [draftRemarks, setDraftRemarks] = useState(initialRemarks);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setRemarks(initialRemarks);
  }, [initialRemarks]);

  const openDialog = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraftRemarks(remarks);
    setShowRemarksDialog(true);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
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

  useEffect(() => {
    if (!showRemarksDialog) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [showRemarksDialog]);

  const rowBg =
    step.status === "pass"
      ? "bg-[color-mix(in_srgb,var(--color-pass)_5%,transparent)]"
      : step.status === "fail"
      ? "bg-fail/5"
      : "";
  const accentColor = isFocused
    ? "var(--color-brand)"
    : step.status === "pass"
    ? "var(--color-pass)"
    : step.status === "fail"
    ? "var(--color-fail)"
    : "#374151";

  return (
    <>
      {showRemarksDialog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Remarks for step ${step.serial_no}`}
          className="fixed inset-0 flex items-end justify-center"
          style={{
            zIndex: 200,
            backgroundColor:
              "color-mix(in srgb, var(--bg-base) 55%, transparent)",
            backdropFilter: `blur(var(--glass-blur))`,
          }}
          onClick={discardRemarks}
        >
          <div
            className="w-full max-w-lg rounded-t-2xl border border-(--border-color) shadow-2xl p-4 flex flex-col gap-3"
            style={{ backgroundColor: "var(--bg-surface)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-t-muted uppercase tracking-wider">
                Remarks — Step #{step.serial_no}
              </span>
              <button
                onClick={discardRemarks}
                aria-label="Discard remarks"
                className="w-7 h-7 rounded-full bg-(--border-color) flex items-center justify-center text-t-muted hover:text-t-primary transition-colors"
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
                className="flex-1 px-4 py-2.5 rounded-xl border border-(--border-color) text-sm font-semibold text-t-secondary hover:text-t-primary transition-colors"
              >
                Discard
              </button>
              <button
                onClick={saveRemarks}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-(--bg-surface) bg-c-brand hover:bg-c-brand/90 transition-colors"
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
        className={`rounded-xl overflow-hidden border border-(--border-color) w-full cursor-pointer transition-shadow ${rowBg} ${
          isFocused
            ? "ring-2 ring-[color-mix(in_srgb,var(--color-brand),white_30%)]"
            : ""
        }`}
        style={{ borderLeftColor: accentColor, borderLeftWidth: 3 }}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-(--border-color) bg-bg-card">
          <span className="text-xs font-mono text-t-muted tracking-wide">
            #{step.serial_no}
          </span>
          <div className="flex items-center gap-2 min-w-0">
            {isFocused && (
              <span className="flex items-center gap-1.5 text-[10px] font-medium shrink-0">
                <kbd className="px-1 py-0.5 rounded-sm bg-[color-mix(in_srgb,var(--color-pass)_10%,transparent)] text-[color-mix(in_srgb,var(--color-pass),white_30%)] border border-[color-mix(in_srgb,var(--color-pass)_20%,transparent)] font-mono text-[9px]">
                  P
                </kbd>
                <span className="text-[color-mix(in_srgb,var(--color-pass),white_30%)]">
                  pass
                </span>
                <span className="text-t-muted opacity-40">·</span>
                <kbd className="px-1 py-0.5 rounded-sm bg-fail/10 text-fail border border-fail/20 font-mono text-[9px]">
                  F
                </kbd>
                <span className="text-fail">fail</span>
              </span>
            )}
            <span
              className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full capitalize ${
                step.status === "pass"
                  ? "bg-[color-mix(in_srgb,var(--color-pass)_15%,transparent)] text-[color-mix(in_srgb,var(--color-pass),white_30%)]"
                  : step.status === "fail"
                  ? "bg-fail/15 text-fail"
                  : "bg-(--border-color) text-t-muted"
              }`}
            >
              {step.status}
            </span>
            <TesterBadge name={step.display_name} status={step.status} />
          </div>
        </div>

        <div className="grid grid-cols-[80px_1fr] border-b border-(--border-color)">
          <div className="px-3 py-2.5 border-r border-(--border-color) bg-bg-card flex items-start">
            <span className="text-[10px] font-semibold text-t-muted uppercase tracking-wider mt-0.5">
              Action
            </span>
          </div>
          <div className="px-3 py-2.5 min-w-0">
            <p className="text-sm leading-snug wrap-break-word text-t-primary whitespace-pre-wrap">
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
                      className="w-[72px] h-[72px] rounded-lg object-cover border border-(--border-color) cursor-zoom-in hover:opacity-90 hover:scale-105 transition-transform"
                    />
                  ) : null
                )}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-[80px_1fr] border-b border-(--border-color)">
          <div className="px-3 py-2.5 border-r border-(--border-color) bg-bg-card flex items-start">
            <span className="text-[10px] font-semibold text-t-muted uppercase tracking-wider mt-0.5">
              Expected
            </span>
          </div>
          <div className="px-3 py-2.5 min-w-0">
            <p className="text-sm leading-snug wrap-break-word text-t-secondary whitespace-pre-wrap">
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
                      className="w-[72px] h-[72px] rounded-lg object-cover border border-(--border-color) cursor-zoom-in hover:opacity-90 hover:scale-105 transition-transform"
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
            disabled={isUpdating}
            className={`flex-1 min-w-0 flex items-center gap-1.5 px-3 h-8 rounded-full border text-xs font-medium transition-colors truncate disabled:opacity-40 disabled:cursor-not-allowed ${
              remarks
                ? "border-c-brand/40 bg-c-brand/8 text-t-primary hover:bg-c-brand/15"
                : "border-(--border-color) bg-bg-surface text-t-muted hover:border-c-brand/40 hover:text-t-primary"
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
              disabled={isUpdating}
              className="shrink-0 px-2.5 h-8 rounded-md text-xs font-semibold text-t-muted hover:text-t-primary bg-bg-surface hover:bg-bg-card border border-(--border-color) transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Undo
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUpdate(step.stepId, "pass", remarks);
            }}
            disabled={isUpdating}
            className={`shrink-0 w-8 h-8 rounded-md text-xs font-bold transition-colors flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed ${
              step.status === "pass"
                ? "bg-pass text-(--bg-surface)"
                : "bg-[color-mix(in_srgb,var(--color-pass)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-pass)_25%,transparent)] text-[color-mix(in_srgb,var(--color-pass),white_30%)] border border-[color-mix(in_srgb,var(--color-pass)_20%,transparent)]"
            }`}
          >
            <Check size={14} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUpdate(step.stepId, "fail", remarks);
            }}
            disabled={isUpdating}
            className={`shrink-0 w-8 h-8 rounded-md text-xs font-bold transition-colors flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed ${
              step.status === "fail"
                ? "bg-fail text-(--bg-surface)"
                : "bg-fail/10 hover:bg-fail/25 text-fail border border-fail/20"
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
  const { setActiveLock, clearActiveLock } = useActiveLock();
  const log = useAuditLog();

  const currentMtId = initialmodule_test_id;

  // testsName is still derived from the module_test_id suffix (module_tests.id
  // = module_name + '_' + tests_name, unchanged by migration).
  const testsName = useMemo(() => {
    const prefix = module_name + "_";
    if (!currentMtId.startsWith(prefix)) {
      console.warn(`Unexpected module_test_id format: ${currentMtId}`);
      return currentMtId;
    }
    return currentMtId.slice(prefix.length);
  }, [currentMtId, module_name]);

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
  const [lock, setLock] = useState<TestLock | null>(null);
  const [loading, setLoading] = useState(true);
  const [lockLoading, setLockLoading] = useState(true);
  const [updatingStepIds, setUpdatingStepIds] = useState<Set<string>>(
    new Set()
  );
  const [isUndoingAll, setIsUndoingAll] = useState(false);

  const stepsInitialized = useRef(false);
  const remarksMap = useRef<Record<string, string>>({});
  const trRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const isLockedByOther = !!(lock && lock.user_id !== user?.id);

  const openImagePreview = useCallback(
    (paths: string[], clickedIdx: number, label: string) => {
      const urls: string[] = [];
      let newIdx = 0;
      paths.forEach((p, i) => {
        const url = signedImageUrls[p];
        if (url) {
          if (i === clickedIdx) newIdx = urls.length;
          urls.push(url);
        }
      });
      if (urls.length) setImagePreview({ urls, idx: newIdx, label });
    },
    [signedImageUrls]
  );

  // ── Load data ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
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
            `
            id, status, remarks, display_name,
            step:test_steps(id, serial_no, action, expected_result, is_divider, action_image_urls, expected_image_urls, tests_serial_no)
          `
            // ── FIXED: was tests_name — column no longer exists after migration ──
          )
          .eq("module_name", module_name),
        supabase
          .from("test_locks")
          .select("module_test_id, user_id, locked_by_name")
          .eq("module_test_id", currentMtId),
      ]);

      if (cancelled) return;

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

      if (cancelled) return;

      setModuleTests(
        rawMts.map((m) => ({
          id: m.id,
          tests_name: m.tests_name,
          test: testsMap[m.tests_name] ?? null,
        }))
      );

      // ── FIXED: resolve the serial_no for the current test, then filter
      //           step_results by tests_serial_no instead of tests_name ──────
      const currentTestSerial = testsMap[testsName]?.serial_no ?? null;

      const merged: ExecutionStep[] = rawSrs
        .filter(
          (sr) =>
            sr.step && currentTestSerial !== null &&
            sr.step.tests_serial_no === currentTestSerial
        )
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

      if (cancelled) return;

      setSteps(merged);
      setLock(lockRes.data?.[0] ?? null);
      setLoading(false);
      setLockLoading(false);
    })();

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
      .channel(`step_results:${module_name}:${testsName}:${uid}`)
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
      cancelled = true;
      supabase.removeChannel(lockChannel);
      supabase.removeChannel(srChannel);
    };
  }, [module_name, currentMtId, testsName, user?.id]);

  // ── Acquire lock ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const result = await acquireLock(
        currentMtId,
        user.id,
        user.display_name ?? user.email ?? "User"
      );
      if (cancelled) return;
      if (result.success) {
        setActiveLock(currentMtId, user.id);
      } else {
        addToast(
          `Test is locked by ${result.holder ?? "another user"}. View only.`,
          "warning"
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentMtId, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
        const theadHeight = isDesktop
          ? (container.querySelector("thead") as HTMLElement | null)
              ?.offsetHeight ?? 0
          : 0;
        const scrollTo =
          elRect.top -
          cRect.top +
          container.scrollTop -
          (cRect.height - theadHeight) / 2 +
          elRect.height / 2 +
          theadHeight;
        container.scrollTo({ top: Math.max(0, scrollTo), behavior: "smooth" });
        setScrollTarget(null);
      });
    });
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
  }, [scrollTarget, loading]);

  // ── Update step ───────────────────────────────────────────────────────────
  const handleStepUpdate = useCallback(
    async (
      stepId: string,
      status: "pass" | "fail" | "pending",
      remarks: string
    ) => {
      if (isLockedByOther) return;
      if (updatingStepIds.has(stepId)) return;

      setUpdatingStepIds((prev) => new Set(prev).add(stepId));

      const idx = steps.findIndex((s) => s.stepId === stepId);
      const nextPending = steps
        .slice(idx + 1)
        .find((s) => !s.is_divider && s.status === "pending");
      const display_name = user?.display_name ?? user?.email ?? "User";

      setSteps((prev) =>
        prev.map((s) =>
          s.stepId === stepId ? { ...s, status, remarks, display_name } : s
        )
      );

      if (status !== "pending") {
        if (nextPending) {
          setFocusedStepId(nextPending.stepId);
          setScrollTarget(nextPending.stepId);
        } else {
          setFocusedStepId(null);
        }
      } else {
        setFocusedStepId(stepId);
        setScrollTarget(stepId);
      }

      try {
        const { error } = await supabase
          .from("step_results")
          .update({ status, remarks, display_name })
          .eq("test_steps_id", stepId)
          .eq("module_name", module_name);
        if (error) throw error;
      } catch {
        setSteps((prev) =>
          prev.map((s) => {
            if (s.stepId !== stepId) return s;
            const original = steps.find((os) => os.stepId === stepId);
            return original
              ? { ...s, status: original.status, remarks: original.remarks }
              : s;
          })
        );
        addToast("Failed to save step result. Please try again.", "error");
      } finally {
        setUpdatingStepIds((prev) => {
          const next = new Set(prev);
          next.delete(stepId);
          return next;
        });
      }
    },
    [steps, module_name, user, addToast, isLockedByOther, updatingStepIds]
  );

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "BUTTON") return;
      if (!focusedStepId || isLockedByOther) return;
      const focused = steps.find((s) => s.stepId === focusedStepId);
      if (!focused || focused.is_divider) return;
      if (e.key === "p" || e.key === "P" || e.key === "Enter") {
        e.preventDefault();
        handleStepUpdate(
          focusedStepId,
          "pass",
          remarksMap.current[focusedStepId] ?? focused.remarks ?? ""
        );
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        handleStepUpdate(
          focusedStepId,
          "fail",
          remarksMap.current[focusedStepId] ?? focused.remarks ?? ""
        );
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [focusedStepId, steps, isLockedByOther, handleStepUpdate]);

  // ── Reset all ─────────────────────────────────────────────────────────────
  const handleUndoAll = useCallback(async () => {
    if (isUndoingAll) return;
    setIsUndoingAll(true);
    setShowUndoModal(false);
    const display_name = user?.display_name ?? user?.email ?? "User";

    setSteps((prev) =>
      prev.map((s) =>
        s.is_divider
          ? s
          : { ...s, status: "pending", remarks: "", display_name }
      )
    );
    remarksMap.current = {};
    const first = steps.filter((s) => !s.is_divider)[0];
    if (first) {
      setFocusedStepId(first.stepId);
      setScrollTarget(first.stepId);
    }

    try {
      const stepResultIds = steps
        .filter((s) => !s.is_divider)
        .map((s) => s.stepResultId);
      const { error } = await supabase
        .from("step_results")
        .update({ status: "pending", remarks: "", display_name })
        .in("id", stepResultIds);
      if (error) throw error;
      addToast("All steps reset to pending.", "info");
      log("Undo all steps");
    } catch {
      setSteps((prev) =>
        prev.map((s) => {
          if (s.is_divider) return s;
          const original = steps.find((os) => os.stepId === s.stepId);
          return original
            ? { ...s, status: original.status, remarks: original.remarks }
            : s;
        })
      );
      addToast("Failed to reset steps. Please try again.", "error");
    } finally {
      setIsUndoingAll(false);
    }
  }, [steps, user, addToast, log, isUndoingAll]);

  // ── Force release (admin) ─────────────────────────────────────────────────
  const handleForceRelease = useCallback(async () => {
    if (!isAdmin) return;
    try {
      await forceReleaseLock(currentMtId);
      addToast("Lock force-released", "success");
    } catch (e: any) {
      addToast(e?.message ?? "Failed to force-release lock", "error");
    }
  }, [isAdmin, currentMtId, addToast]);

  // ── Finish ────────────────────────────────────────────────────────────────
  const handleFinish = async () => {
    if (user) await releaseLock(currentMtId, user.id).catch(() => {});
    clearActiveLock();
    log(`Finished test: ${currentTest?.name ?? "Unknown"}`);
    addToast(`Test "${currentTest?.name ?? "Unknown"}" completed!`, "success");
    onBack();
  };

  // ── Further derived state ─────────────────────────────────────────────────
  const currentMt = moduleTests.find((mt) => mt.id === currentMtId);
  const currentTest = currentMt?.test;

  const {
    passCount,
    failCount,
    totalCount,
    doneCount,
    passPct,
    failPct,
    progressPct,
  } = useMemo(() => {
    const nd = steps.filter((s) => !s.is_divider);
    const pass = nd.filter((s) => s.status === "pass").length;
    const fail = nd.filter((s) => s.status === "fail").length;
    const total = nd.length;
    const done = pass + fail;
    return {
      passCount: pass,
      failCount: fail,
      totalCount: total,
      doneCount: done,
      progressPct: total > 0 ? Math.round((done / total) * 100) : 0,
      passPct: total > 0 ? Math.round((pass / total) * 100) : 0,
      failPct: total > 0 ? Math.round((fail / total) * 100) : 0,
    };
  }, [steps]);

  const filtered = useMemo(
    () =>
      steps.filter((s) => {
        if (s.is_divider) return true;
        if (filter !== "all" && s.status !== filter) return false;
        if (
          search &&
          !`${s.action} ${s.expected_result} ${s.remarks}`
            .toLowerCase()
            .includes(search.toLowerCase())
        )
          return false;
        return true;
      }),
    [steps, filter, search]
  );

  const flatData = useMemo<FlatData[]>(
    () =>
      steps.map((s) =>
        s.is_divider
          ? {
              module: module_name,
              test: currentTest?.name ?? "",
              serial: 0,
              action: cleanDividerLabel(s.action),
              expected: s.expected_result,
              remarks: "",
              status: "",
              isdivider: true,
              dividerLevel: getDividerLevel(s),
            }
          : {
              module: module_name,
              test: currentTest?.name ?? "",
              serial: s.serial_no,
              action: s.action,
              expected: s.expected_result,
              remarks: s.remarks || "",
              status: s.status,
            }
      ),
    [steps, module_name, currentTest?.name]
  );

  const exportStats = useMemo(() => {
    const nd = flatData.filter((s) => !s.isdivider);
    return [
      { label: "Total Steps", value: nd.length },
      { label: "Pass", value: nd.filter((s) => s.status === "pass").length },
      { label: "Fail", value: nd.filter((s) => s.status === "fail").length },
    ];
  }, [flatData]);

  const exportTestName = currentTest
    ? `${currentTest.serial_no}. ${currentTest.name}`
    : "test";

  // ── Render ────────────────────────────────────────────────────────────────
  if (lockLoading)
    return (
      <div
        className="flex flex-col items-center justify-center gap-3"
        style={{ height: "100dvh" }}
      >
        <Spinner />
        <p className="text-xs text-t-muted">Checking lock status…</p>
      </div>
    );

  if (isLockedByOther)
    return (
      <div className="flex flex-col" style={{ height: "100dvh" }}>
        <Topbar
          title={currentTest?.name ?? "Test Execution"}
          subtitle={module_name}
          onBack={onBack}
        />
        <LockedScreen
          locked_by_name={lock.locked_by_name}
          test_name={currentTest?.name ?? "this test"}
          onBack={onBack}
        />
        {isAdmin && (
          <div className="p-4 flex justify-center">
            <button
              onClick={handleForceRelease}
              className="text-xs text-fail hover:text-[color-mix(in_srgb,var(--color-fail),white_50%)] underline underline-offset-2 transition-colors"
            >
              Force-release lock (admin)
            </button>
          </div>
        )}
      </div>
    );

  return (
    <div className="flex flex-col" style={{ height: "100dvh" }}>
      {imagePreview && (
        <ImagePreviewModal
          images={imagePreview.urls}
          initialIndex={imagePreview.idx}
          label={imagePreview.label}
          onClose={() => setImagePreview(null)}
        />
      )}
      {showUndoModal && (
        <UndoAllModal
          doneCount={doneCount}
          totalCount={totalCount}
          onConfirm={handleUndoAll}
          onCancel={() => setShowUndoModal(false)}
        />
      )}

      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        title="Export Test Results"
        subtitle={`${module_name} · ${currentTest?.name ?? ""}`}
        stats={exportStats}
        options={[
          {
            label: "CSV",
            icon: <FileSpreadsheet size={16} />,
            color:
              "bg-(--bg-card) border border-(--border-color) text-(--text-primary)",
            hoverColor: "hover:bg-(--bg-surface) hover:border-(--color-brand)",
            onConfirm: () =>
              exportExecutionCSV(module_name, exportTestName, flatData),
          },
          {
            label: "PDF",
            icon: <FileText size={16} />,
            color:
              "bg-(--bg-card) border border-(--border-color) text-(--text-primary)",
            hoverColor: "hover:bg-(--bg-surface) hover:border-(--color-brand)",
            onConfirm: () =>
              exportExecutionPDF(module_name, exportTestName, flatData),
          },
        ]}
      />

      <MassImageUploadModal
        isOpen={showMassImageUpload}
        onClose={() => setShowMassImageUpload(false)}
      />

      {/* ── Fixed header ─────────────────────────────────────────────────── */}
      <div className="shrink-0">
        <Topbar
          title={
            currentTest
              ? `${currentTest.serial_no}. ${currentTest.name}`
              : "Test Execution"
          }
          subtitle={module_name}
          onBack={onBack}
          actions={
            <>
              {isAdmin && (
                <button
                  onClick={() => setShowMassImageUpload(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-bg-card hover:bg-bg-surface border border-(--border-color) text-t-primary transition"
                >
                  Mass Upload Images
                </button>
              )}
              <button
                onClick={() => setShowExportModal(true)}
                disabled={steps.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-bg-card hover:bg-bg-surface border border-(--border-color) text-t-primary transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Upload size={13} />
                Export
              </button>
              <button onClick={handleFinish} className="btn-primary text-sm">
                Finish Test
              </button>
            </>
          }
        />

        {/* Progress bar */}
        <div className="px-4 pt-3 pb-2">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-4 text-xs text-t-muted">
              <span>
                <span className="text-[color-mix(in_srgb,var(--color-pass),white_30%)] font-semibold">
                  {passCount}
                </span>{" "}
                pass
              </span>
              <span>
                <span className="text-fail font-semibold">{failCount}</span>{" "}
                fail
              </span>
              <span>
                <span className="text-t-muted font-semibold">
                  {totalCount - doneCount}
                </span>{" "}
                pending
              </span>
            </div>
            <div className="flex items-center gap-3">
              {focusedStepId && (
                <span className="hidden md:flex items-center gap-2 text-xs text-t-muted">
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 rounded-sm bg-[color-mix(in_srgb,var(--color-pass)_10%,transparent)] text-[color-mix(in_srgb,var(--color-pass),white_30%)] font-mono text-[10px] border border-[color-mix(in_srgb,var(--color-pass)_20%,transparent)]">
                      P
                    </kbd>
                    <span className="text-(--border-color) mx-0.5">/</span>
                    <kbd className="px-1.5 py-0.5 rounded-sm bg-[color-mix(in_srgb,var(--color-pass)_10%,transparent)] text-[color-mix(in_srgb,var(--color-pass),white_30%)] font-mono text-[10px] border border-[color-mix(in_srgb,var(--color-pass)_20%,transparent)]">
                      Enter
                    </kbd>
                    <span className="text-[color-mix(in_srgb,var(--color-pass),white_30%)] ml-1">
                      pass
                    </span>
                  </span>
                  <span className="text-(--border-color)">·</span>
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 rounded-sm bg-fail/10 text-fail font-mono text-[10px] border border-fail/20">
                      F
                    </kbd>
                    <span className="text-fail ml-1">fail</span>
                  </span>
                </span>
              )}
              <span className="text-xs text-t-muted font-medium">
                {progressPct}%
              </span>
            </div>
          </div>
          <div className="h-1.5 bg-(--border-color) rounded-full overflow-hidden flex">
            <div
              className="h-full bg-pass transition-all duration-500"
              style={{ width: `${passPct}%` }}
            />
            <div
              className="h-full bg-fail transition-all duration-500"
              style={{ width: `${failPct}%` }}
            />
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col border-b border-(--border-color)">
          <div className="flex items-center justify-end gap-1 px-4 py-2">
            {(["all", "pass", "fail", "pending"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={filter === f ? { color: "#ffffff" } : undefined}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors capitalize ${
                  filter === f
                    ? "bg-c-brand"
                    : "text-t-muted hover:text-t-primary"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="px-4 pb-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search steps…"
              aria-label="Search steps"
              className="input text-xs py-1.5 w-full"
            />
          </div>
        </div>
      </div>

      {/* ── Scroll container ─────────────────────────────────────────────── */}
      <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Spinner />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-t-muted py-20 text-sm">
            No steps match your filter.
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <table className="hidden md:table w-full text-sm border-collapse table-fixed">
              <thead className="sticky top-0 z-10">
                <tr className="bg-bg-surface border-b border-(--border-color)">
                  <th className="text-left px-2 py-2.5 text-xs font-semibold text-t-muted uppercase tracking-wider w-[6%] border-r border-(--border-color)">
                    S.No
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-t-muted uppercase tracking-wider w-[28%] border-r border-(--border-color)">
                    Action
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-t-muted uppercase tracking-wider w-[28%] border-r border-(--border-color)">
                    Expected Result
                  </th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-t-muted uppercase tracking-wider w-[13%] border-r border-(--border-color)">
                    Remarks
                  </th>
                  <th className="text-center px-2 py-2.5 text-xs font-semibold text-t-muted uppercase tracking-wider w-[11%] border-r border-(--border-color)">
                    Status
                  </th>
                  <th className="text-center px-2 py-2.5 text-xs font-semibold text-t-muted uppercase tracking-wider w-[14%]">
                    Result
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((step) =>
                  step.is_divider ? (
                    (() => {
                      const level = getDividerLevel(step);
                      const s = DIVIDER_LEVELS[level] ?? DIVIDER_LEVELS[1];
                      return (
                        <tr
                          key={step.stepId}
                          className="border-b border-(--border-color)"
                          style={s.bgStyle}
                        >
                          <td
                            colSpan={6}
                            className={`py-2 ${s.indent} ${s.border}`}
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className={`rounded-full ${s.dot} inline-block shrink-0`}
                                style={{
                                  width: level === 1 ? 6 : level === 2 ? 5 : 4,
                                  height:
                                    level === 1 ? 6 : level === 2 ? 5 : 4,
                                }}
                              />
                              <span className={`${s.size} ${s.text}`}>
                                {cleanDividerLabel(step.action)}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })()
                  ) : (
                    <TableStepRow
                      key={step.stepId}
                      step={step}
                      initialRemarks={
                        remarksMap.current[step.stepId] ?? step.remarks ?? ""
                      }
                      signedImageUrls={signedImageUrls}
                      isFocused={focusedStepId === step.stepId}
                      isUpdating={updatingStepIds.has(step.stepId)}
                      onUpdate={handleStepUpdate}
                      onFocus={() => setFocusedStepId(step.stepId)}
                      onRemarksChange={(val: string) =>
                        (remarksMap.current[step.stepId] = val)
                      }
                      onImageClick={openImagePreview}
                      rowRef={(el: HTMLTableRowElement | null) =>
                        (trRefs.current[step.stepId] = el)
                      }
                    />
                  )
                )}
              </tbody>
            </table>

            {/* Mobile cards */}
            <div className="md:hidden flex flex-col">
              <div className="sticky top-0 z-10 grid grid-cols-[64px_1fr] border-b border-(--border-color) bg-bg-surface/80 backdrop-blur-md">
                <div className="px-3 py-2 border-r border-(--border-color)">
                  <span className="text-[10px] font-semibold text-t-muted uppercase tracking-wider">
                    S.No
                  </span>
                </div>
                <div className="px-3 py-2">
                  <span className="text-[10px] font-semibold text-t-muted uppercase tracking-wider">
                    Step Details
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-2 p-3">
                {filtered.map((step) =>
                  step.is_divider ? (
                    (() => {
                      const level = getDividerLevel(step);
                      const ms =
                        MOBILE_DIVIDER_LEVELS[level] ??
                        MOBILE_DIVIDER_LEVELS[1];
                      return (
                        <div
                          key={step.stepId}
                          className={`flex items-center gap-2 ${ms.py} pl-3 pr-3 rounded-r-lg ${ms.ml}`}
                          style={{ ...ms.bgStyle, ...ms.borderStyle }}
                        >
                          <span
                            className={`rounded-full shrink-0 ${ms.dotClass}`}
                            style={{ width: ms.dotSize, height: ms.dotSize }}
                          />
                          <span className={`${ms.fontSize} ${ms.textClass}`}>
                            {cleanDividerLabel(step.action)}
                          </span>
                        </div>
                      );
                    })()
                  ) : (
                    <MobileStepCard
                      key={step.stepId}
                      step={step}
                      initialRemarks={
                        remarksMap.current[step.stepId] ?? step.remarks ?? ""
                      }
                      signedImageUrls={signedImageUrls}
                      isFocused={focusedStepId === step.stepId}
                      isUpdating={updatingStepIds.has(step.stepId)}
                      onUpdate={handleStepUpdate}
                      onFocus={() => setFocusedStepId(step.stepId)}
                      onRemarksChange={(val: string) =>
                        (remarksMap.current[step.stepId] = val)
                      }
                      onImageClick={openImagePreview}
                      cardRef={(el: HTMLDivElement | null) =>
                        (cardRefs.current[step.stepId] = el)
                      }
                    />
                  )
                )}
              </div>
            </div>

            {/* Undo All — admin only */}
            {isAdmin && doneCount > 0 && (
              <div className="flex items-center justify-center py-6 px-4">
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed border-[color-mix(in_srgb,var(--color-pend)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-pend)_5%,transparent)]">
                  <AlertTriangle size={14} className="text-pend shrink-0" />
                  <span className="text-xs text-t-muted">
                    Admin action — resets all progress
                  </span>
                  <button
                    onClick={() => setShowUndoModal(true)}
                    disabled={isUndoingAll}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-[color-mix(in_srgb,var(--color-pend),black_15%)] dark:text-[color-mix(in_srgb,var(--color-pend),white_30%)] bg-[color-mix(in_srgb,var(--color-pend)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-pend)_20%,transparent)] border border-[color-mix(in_srgb,var(--color-pend)_30%,transparent)] hover:border-[color-mix(in_srgb,var(--color-pend)_60%,transparent)] transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
                  >
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