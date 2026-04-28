// src/components/ModuleDashboard/charts/RPieChart.tsx
import React from 'react';
import {
  ResponsiveContainer, PieChart, Pie, Cell,
  Tooltip, Legend, Label,
} from 'recharts';
import { ChartRow, ChartTheme, COLORS } from './types';
import PieTooltip from './PieTooltip';

interface Props {
  data:       ChartRow[];
  ct:         ChartTheme;
  showLabel?: boolean;
  height?:    number;
}

const LEGEND_FORMATTER = (ct: ChartTheme, totals: Record<string,number>) =>
  (v: string) => (
    <span style={{ color: ct.muted, fontSize: 11, textTransform: 'capitalize' }}>
      {v}&nbsp;
      <span style={{ color: ct.text, fontWeight: 700 }}>
        {totals[v as keyof typeof totals] ?? 0}
      </span>
    </span>
  );

const RPieChart: React.FC<Props> = ({ data, ct, showLabel = false, height = 220 }) => {
  const totals = data.reduce(
    (acc, d) => ({ pass: acc.pass + d.pass, fail: acc.fail + d.fail, pending: acc.pending + d.pending }),
    { pass: 0, fail: 0, pending: 0 }
  );
  const total = totals.pass + totals.fail + totals.pending;

  if (total === 0) return (
    <div className="flex items-center justify-center" style={{ height }}>
      <span className="text-sm" style={{ color: ct.muted }}>No data to display</span>
    </div>
  );

  const passRate = Math.round((totals.pass / total) * 100);

  const pieData = (['pass', 'fail', 'pending'] as const)
    .map(k => ({ name: k, value: totals[k], ...totals }))
    .filter(d => d.value > 0);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={pieData}
          cx="50%"
          cy="46%"
          innerRadius={48}
          outerRadius={74}
          paddingAngle={pieData.length > 1 ? 3 : 0}
          dataKey="value"
          nameKey="name"
          isAnimationActive={false}
          strokeWidth={0}
        >
          {pieData.map(entry => (
            <Cell
              key={entry.name}
              fill={COLORS[entry.name as keyof typeof COLORS]}
              opacity={0.9}
            />
          ))}

          {/* Center label — uses recharts Label so it always aligns with the donut */}
          {showLabel && (
            <Label
              content={({ viewBox }: any) => {
                const { cx, cy } = viewBox;
                return (
                  <g>
                    <text
                      x={cx} y={cy - 6}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={18}
                      fontWeight={700}
                      fill={ct.text}
                    >
                      {passRate}%
                    </text>
                    <text
                      x={cx} y={cy + 13}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={10}
                      fill={ct.muted}
                    >
                      pass
                    </text>
                  </g>
                );
              }}
            />
          )}
        </Pie>

        <Tooltip content={<PieTooltip ct={ct} />} />

        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          formatter={LEGEND_FORMATTER(ct, totals)}
        />
      </PieChart>
    </ResponsiveContainer>
  );
};
export default RPieChart;
