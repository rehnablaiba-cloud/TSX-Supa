// src/components/UI/SegmentedBar.tsx
// Phase 2.1-B1: extracted from Dashboard.tsx + TestReport.tsx
// Pure CSS progress bar with pass/fail/pending segments.

import React from 'react';

interface Props {
  passRate:   number;
  failPct:    number;
  pendingPct: number;
  total:      number;
}

const SegmentedBar: React.FC<Props> = ({ passRate, failPct, pendingPct, total }) => {
  if (total === 0) return <div className="h-1.5 w-full rounded-full bg-bg-card" />;
  return (
    <div className="h-1.5 w-full rounded-full overflow-hidden flex">
      {passRate   > 0 && <div className="h-full bg-green-500 transition-all duration-700" style={{ width: `${passRate}%`   }} />}
      {failPct    > 0 && <div className="h-full bg-red-500   transition-all duration-700" style={{ width: `${failPct}%`    }} />}
      {pendingPct > 0 && (
        <div className="h-full transition-all duration-700"
          style={{ width: `${pendingPct}%`, backgroundColor: 'var(--text-muted)', opacity: 0.3 }} />
      )}
    </div>
  );
};

export default SegmentedBar;
