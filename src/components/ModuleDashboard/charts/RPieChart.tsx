// src/components/ModuleDashboard/charts/RPieChart.tsx
// Phase 2.1-A6: added optional showLabel?: boolean prop
// When true, renders a centre label (used by TestReport).
// When false/undefined, renders the standard legend-only layout (used by ModuleDashboard).

import React from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { ChartRow, ChartTheme, COLORS } from './types';
import PieTooltip from './PieTooltip';

interface Props {
  data:       ChartRow[];
  ct:         ChartTheme;
  showLabel?: boolean;
  height?:    number;
}

const RPieChart: React.FC<Props> = ({ data, ct, showLabel = false, height = 220 }) => {
  const totals = data.reduce(
    (acc, d) => ({ pass: acc.pass + d.pass, fail: acc.fail + d.fail, pending: acc.pending + d.pending }),
    { pass: 0, fail: 0, pending: 0 }
  );
  const total = totals.pass + totals.fail + totals.pending;
  const pieData = (['pass','fail','pending'] as const)
    .map(k => ({ name: k, value: totals[k], ...totals }))
    .filter(d => d.value > 0);

  if (total === 0) return (
    <div className="flex items-center justify-center h-40">
      <span className="text-sm" style={{ color: ct.muted }}>No data to display</span>
    </div>
  );

  const passRate = Math.round((totals.pass / total) * 100);

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie data={pieData} cx="50%" cy="50%" innerRadius={46} outerRadius={72}
            paddingAngle={3} dataKey="value" nameKey="name" isAnimationActive={false}>
            {pieData.map(entry => (
              <Cell key={entry.name} fill={COLORS[entry.name as keyof typeof COLORS]} opacity={0.88} />
            ))}
          </Pie>
          <Tooltip content={<PieTooltip ct={ct} />} />
          <Legend iconType="circle" iconSize={10}
            formatter={v => (
              <span style={{ color: ct.muted, fontSize: 11, textTransform: 'capitalize' }}>
                {v} {totals[v as keyof typeof totals]}
              </span>
            )} />
        </PieChart>
      </ResponsiveContainer>

      {/* Centre pass-rate label — only rendered when showLabel=true */}
      {showLabel && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ paddingBottom: '28px' }}>
          <div className="text-center">
            <div className="text-xl font-bold" style={{ color: ct.text }}>{passRate}%</div>
            <div className="text-[10px] font-medium" style={{ color: ct.muted }}>pass</div>
          </div>
        </div>
      )}
    </div>
  );
};
export default RPieChart;
