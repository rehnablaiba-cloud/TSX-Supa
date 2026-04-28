// src/components/ModuleDashboard/charts/CustomTooltip.tsx
import React from 'react';
import { ChartTheme } from './types';

interface Props { active?: boolean; payload?: any[]; label?: string; ct: ChartTheme; }

const CustomTooltip: React.FC<Props> = ({ active, payload, label, ct }) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="px-3 py-2 rounded-xl border shadow-xl text-xs"
      style={{ backgroundColor: ct.tooltipBg, borderColor: ct.border, color: ct.tooltipText }}
    >
      <div className="font-semibold mb-1.5" style={{ color: ct.tooltipText }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-6 leading-5">
          {/* p.color is always injected by recharts regardless of chart type (bar/line/area/radar) */}
          <span className="flex items-center gap-1.5 capitalize" style={{ color: ct.tooltipName }}>
            <span className="w-2 h-2 rounded-sm inline-block shrink-0" style={{ background: p.color }} />
            {p.dataKey}
          </span>
          <span style={{ color: p.color, fontWeight: 700 }}>{p.value}</span>
        </div>
      ))}
    </div>
  );
};
export default CustomTooltip;
