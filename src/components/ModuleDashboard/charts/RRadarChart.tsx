// src/components/ModuleDashboard/charts/RRadarChart.tsx
import React from 'react';
import {
  ResponsiveContainer, RadarChart, Radar,
  PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Tooltip, Legend,
} from 'recharts';
import { ChartRow, ChartTheme, COLORS } from './types';
import CustomTooltip from './CustomTooltip';

interface Props { data: ChartRow[]; ct: ChartTheme; height?: number; }

const LEGEND_FMT = (ct: ChartTheme) => (v: string) => (
  <span style={{ color: ct.muted, fontSize: 11, textTransform: 'capitalize' }}>{v}</span>
);

const RRadarChart: React.FC<Props> = ({ data, ct, height = 220 }) => {
  if (data.length === 0) return (
    <div className="flex items-center justify-center" style={{ height }}>
      <span className="text-sm" style={{ color: ct.muted }}>No data to display</span>
    </div>
  );
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart cx="50%" cy="48%" outerRadius={68} data={data}>
        <PolarGrid stroke={ct.grid} />
        <PolarAngleAxis
          dataKey="name"
          tick={{ fill: ct.muted, fontSize: 11 }}
          tickFormatter={v => v.length > 12 ? v.slice(0, 11) + '…' : v}
        />
        <PolarRadiusAxis tick={{ fill: ct.muted, fontSize: 10 }} axisLine={false} tickCount={4} />
        <Tooltip content={<CustomTooltip ct={ct} />} />
        <Legend
          iconType="square"
          iconSize={8}
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          formatter={LEGEND_FMT(ct)}
        />
        <Radar name="pass"    dataKey="pass"    stroke={COLORS.pass}    fill={COLORS.pass}    fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} />
        <Radar name="fail"    dataKey="fail"    stroke={COLORS.fail}    fill={COLORS.fail}    fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} />
        <Radar name="pending" dataKey="pending" stroke={COLORS.pending} fill={COLORS.pending} fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} />
      </RadarChart>
    </ResponsiveContainer>
  );
};
export default RRadarChart;
