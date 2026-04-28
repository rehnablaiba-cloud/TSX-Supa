];
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

{isAdmin && doneCount > 0 && (
<div className="flex items-center justify-center py-6 px-4">
<div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed border-[color-mix(in_srgb,var(--color-pend)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-pend)_5%,transparent)]">
<AlertTriangle
size={14}
className="text-pend shrink-0"
/>
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