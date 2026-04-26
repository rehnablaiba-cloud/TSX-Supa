import React from "react";
import { Package, FlaskConical, Hash } from "lucide-react";
import type { ModuleOption, TestOption, StepOption } from "./types";

// ── Row — single label/value display ─────────────────────────────────────────
export const Row: React.FC<{
  label: string;
  value: string;
  mono?: boolean;
  brand?: boolean;
}> = ({ label, value, mono, brand }) => (
  <div className="flex gap-2">
    <span className="text-t-muted w-24 shrink-0">{label}</span>
    <span
      className={`${mono ? "font-mono font-bold" : ""} ${
        brand ? "text-c-brand" : "text-t-primary"
      } break-all`}
    >
      {value || <em className="opacity-40">empty</em>}
    </span>
  </div>
);

// ── DiffRow — before/after comparison ────────────────────────────────────────
export const DiffRow: React.FC<{
  label: string;
  before: string;
  after: string;
}> = ({ label, before, after }) => {
  const changed = before !== after;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-t-muted">{label}</span>
      {changed ? (
        <div className="pl-2 flex flex-col gap-0.5">
          <span className="text-fail line-through break-all">
            {before || <em>empty</em>}
          </span>
          <span className="text-[color-mix(in_srgb,var(--color-pass),white_30%)] break-all">
            {after || <em>empty</em>}
          </span>
        </div>
      ) : (
        <span className="pl-2 text-t-muted italic">unchanged</span>
      )}
    </div>
  );
};

// ── ContextStrip — breadcrumb showing module → test → step ───────────────────
export const ContextStrip: React.FC<{
  module?: ModuleOption | null;
  test?: TestOption | null;
  step?: StepOption | null;
}> = ({ module, test, step }) => {
  if (!module && !test && !step) return null;
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {module && (
        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-card border border-(--border-color)">
          <Package size={12} className="text-t-muted" />
          <span className="text-t-primary font-medium">{module.name}</span>
        </span>
      )}
      {test && (
        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-card border border-(--border-color)">
          <FlaskConical size={12} className="text-t-muted" />
          <span className="text-t-primary font-medium">{test.name}</span>
          <span className="text-t-muted">SN {test.serial_no}</span>
        </span>
      )}
      {step && (
        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-card border border-(--border-color)">
          <Hash size={12} className="text-t-muted" />
          <span className="font-mono font-bold text-c-brand">
            SN {step.serial_no}
          </span>
        </span>
      )}
    </div>
  );
};

// ── OpCard — reusable operation selector card ─────────────────────────────────
export const OpCard: React.FC<{
  id: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
  selected: boolean;
  onClick: () => void;
  danger?: boolean;
}> = ({ label, desc, icon, selected, onClick, danger }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-4 px-4 py-3.5 rounded-xl border transition-all text-left
      ${
        selected
          ? danger
            ? "border-fail/60 bg-fail/10"
            : "border-c-brand bg-c-brand-bg"
          : "border-(--border-color) bg-bg-card hover:bg-bg-base"
      }`}
  >
    <span
      className={
        selected ? (danger ? "text-fail" : "text-c-brand") : "text-t-muted"
      }
    >
      {icon}
    </span>
    <div className="flex-1">
      <p
        className={`text-sm font-semibold ${
          selected
            ? danger
              ? "text-fail"
              : "text-c-brand"
            : "text-t-primary"
        }`}
      >
        {label}
      </p>
      <p className="text-xs text-t-muted">{desc}</p>
    </div>
    {selected && (
      <span
        className={`w-4 h-4 rounded-full flex items-center justify-center text-(--bg-surface) shrink-0 ${
          danger ? "bg-fail" : "bg-c-brand"
        }`}
      >
        ✓
      </span>
    )}
  </button>
);

// ── LoadingList — spinner shown while fetching list items ─────────────────────
export const LoadingList: React.FC<{ label?: string }> = ({
  label = "Loading…",
}) => (
  <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-bg-card border border-(--border-color) text-t-muted text-sm">
    <span className="w-4 h-4 border-2 border-c-brand border-t-transparent rounded-full animate-spin shrink-0" />
    {label}
  </div>
);

// ── EmptyList — shown when query returns no rows ──────────────────────────────
export const EmptyList: React.FC<{ label?: string }> = ({
  label = "No items found.",
}) => (
  <div className="rounded-xl border border-pend/30 bg-pend/10 px-4 py-3 text-xs text-pend">
    {label}
  </div>
);

// ── ErrBanner — inline error display ─────────────────────────────────────────
export const ErrBanner: React.FC<{ msg: string }> = ({ msg }) => (
  <div className="rounded-xl border border-fail/30 bg-fail/10 px-4 py-3 text-xs text-fail flex items-start gap-2">
    <span className="shrink-0 mt-0.5">✕</span>
    <p>{msg}</p>
  </div>
);

// ── SuccessBanner — result message on done stage ──────────────────────────────
export const SuccessBanner: React.FC<{ msg: string }> = ({ msg }) => (
  <div className="rounded-xl border border-pass/30 bg-pass/10 p-4 text-sm flex items-start gap-3 text-pass">
    <span className="shrink-0 text-base">✓</span>
    <p className="font-medium">{msg}</p>
  </div>
);

// ── NavButtons — Back / Next (or custom label) footer pair ────────────────────
export const NavButtons: React.FC<{
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  nextDanger?: boolean;
}> = ({ onBack, onNext, nextLabel = "Next", nextDisabled, nextDanger }) => (
  <div className="flex gap-2 pt-1">
    <button
      onClick={onBack}
      className="flex-1 px-4 py-2.5 rounded-xl border border-(--border-color) text-t-secondary hover:text-t-primary text-sm font-medium transition-colors"
    >
      Back
    </button>
    <button
      onClick={onNext}
      disabled={nextDisabled}
      className={`flex-1 btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed
        ${nextDanger ? "bg-fail! hover:bg-[color-mix(in_srgb,var(--color-fail),black_20%)]!" : ""}`}
    >
      {nextLabel}
    </button>
  </div>
);
