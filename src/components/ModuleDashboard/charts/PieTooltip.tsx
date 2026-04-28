// src/components/ModuleDashboard/charts/PieTooltip.tsx
import React from 'react';
import { ChartTheme, COLORS } from './types';

interface Props { active?: boolean; payload?: any[]; ct: ChartTheme; }

const PieTooltip: React.FC<Props> = ({ active, payload, ct }) => {
  if (!active || !payload?.length) return null;
  const { name, value, payload: inner } = payload[0];
  const total = (inner?.pass ?? 0) + (inner?.fail ?? 0) + (inner?.pending ?? 0);
  const pct   = total > 0 ? Math.round((value / total) * 100) : 0;
  const color = COLORS[name as keyof typeof COLORS];
  return (
    <div
      className="px-3 py-2 rounded-xl border shadow-xl text-xs"
      style={{ backgroundColor: ct.tooltipBg, borderColor: ct.border, color: ct.tooltipText }}
    >
      <div className="flex items-center gap-1.5 font-semibold capitalize mb-1">
        <span className="w-2 h-2 rounded-sm inline-block" style={{ background: color }} />
        {name}
      </div>
      <div className="flex items-center justify-between gap-6">
        <span style={{ color: ct.tooltipName }}>Count</span>
        <span style={{ color, fontWeight: 700 }}>{value}</span>
      </div>
      <div className="flex items-center justify-between gap-6">
        <span style={{ color: ct.tooltipName }}>Share</span>
        <span style={{ color, fontWeight: 700 }}>{pct}%</span>
      </div>
    </div>
  );
};
export default PieTooltip;
