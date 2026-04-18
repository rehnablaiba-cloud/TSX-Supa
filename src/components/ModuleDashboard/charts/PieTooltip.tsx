// src/components/ModuleDashboard/charts/PieTooltip.tsx
import React from 'react';
import { ChartTheme, COLORS } from './types';

interface Props { active?: boolean; payload?: any[]; ct: ChartTheme; }

const PieTooltip: React.FC<Props> = ({ active, payload, ct }) => {
  if (!active || !payload?.length) return null;
  const { name, value, payload: inner } = payload[0];
  const total = (inner?.pass ?? 0) + (inner?.fail ?? 0) + (inner?.pending ?? 0);
  return (
    <div className="px-3 py-2 rounded-xl border shadow-xl text-xs"
      style={{ backgroundColor: ct.tooltipBg, borderColor: ct.border, color: ct.tooltipText }}>
      <div className="font-semibold capitalize mb-1">{name}</div>
      <div style={{ color: COLORS[name as keyof typeof COLORS], fontWeight: 700 }}>
        {total > 0 ? `${Math.round((value / total) * 100)}%` : 0}
      </div>
    </div>
  );
};
export default PieTooltip;
