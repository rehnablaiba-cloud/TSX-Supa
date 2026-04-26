// src/components/UI/ReviewRow.tsx
// Phase 2 — B2: Row + DiffRow display helpers extracted from MobileNav.tsx.
// Previously defined as inline sub-components in MobileNav's confirm-stage
// review panels. Now reusable across any confirm / diff UI.

import React from 'react';

// ── Row ───────────────────────────────────────────────────────────────────────
// Simple label + value display row used in confirm-before-import panels.
interface RowProps {
  label: string;
  value: string | number;
  mono?: boolean;   // render value in monospace bold
  brand?: boolean;  // tint value with brand colour
}

export const Row: React.FC<RowProps> = ({ label, value, mono, brand }) => (
  <div className="flex gap-2 text-xs">
    <span className="text-t-muted w-24 shrink-0">{label}</span>
    <span
      className={[
        mono  ? 'font-mono font-bold' : '',
        brand ? 'text-c-brand'        : 'text-t-primary',
        'break-all',
      ].filter(Boolean).join(' ')}
    >
      {value !== '' && value != null
        ? value
        : <em className="opacity-40">empty</em>}
    </span>
  </div>
);

// ── DiffRow ───────────────────────────────────────────────────────────────────
// Shows before/after values for a single field in an edit-confirm panel.
// Unchanged values display "unchanged" in muted italic.
interface DiffRowProps {
  label: string;
  before: string | number;
  after: string | number;
}

export const DiffRow: React.FC<DiffRowProps> = ({ label, before, after }) => {
  const changed = String(before) !== String(after);
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      <span className="text-t-muted font-medium">{label}</span>
      {changed ? (
        <div className="pl-3 flex flex-col gap-0.5">
          <span className="text-fail line-through break-all">
            {before !== '' ? before : <em>empty</em>}
          </span>
          <span className="text-[color-mix(in_srgb,var(--color-pass),white_30%)] break-all">
            {after !== '' ? after : <em>empty</em>}
          </span>
        </div>
      ) : (
        <span className="pl-3 text-t-muted italic">unchanged</span>
      )}
    </div>
  );
};
