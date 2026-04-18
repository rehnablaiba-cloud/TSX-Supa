// src/components/ModuleDashboard/charts/CustomTooltip.tsx
import React from 'react';
import { ChartTheme } from './types';

interface Props { active?: boolean; payload?: any[]; label?: string; ct: ChartTheme; }

const CustomTooltip: React.FC<Props> = ({ active, payload, label, ct }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="px-3 py-2 rounded-xl border shadow-xl text-xs"
      style={{ backgroundColor: ct.tooltipBg, borderColor: ct.border, color: ct.tooltipText }}>
      <div className="font-semibold mb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4">
          <span style={{ color: ct.tooltipName }} className="capitalize">{p.dataKey}</span>
          <span style={{ color: p.fill || p.stroke, fontWeight: 700 }}>{p.value}</span>
        </div>
      ))}
    </div>
  );
};
export default CustomTooltip;
