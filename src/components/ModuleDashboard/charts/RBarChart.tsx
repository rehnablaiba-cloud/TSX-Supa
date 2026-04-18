// src/components/ModuleDashboard/charts/RBarChart.tsx
import React from 'react';
import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { ChartRow, ChartTheme, COLORS } from './types';
import CustomTooltip from './CustomTooltip';

interface Props { data: ChartRow[]; ct: ChartTheme; }

const RBarChart: React.FC<Props> = ({ data, ct }) => (
  <ResponsiveContainer width="100%" height={220}>
    <BarChart data={data} margin={{ top: 8, right: 16, left: -16, bottom: 8 }} barCategoryGap={28} barGap={3}>
      <CartesianGrid strokeDasharray="4 3" stroke={ct.grid} vertical={false} />
      <XAxis dataKey="name" tick={{ fill: ct.muted, fontSize: 11 }} axisLine={false} tickLine={false}
        tickFormatter={v => v.length > 10 ? v.slice(0, 9) + '…' : v} />
      <YAxis tick={{ fill: ct.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
      <Tooltip content={<CustomTooltip ct={ct} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
      <Legend iconType="square" iconSize={10}
        formatter={v => <span style={{ color: ct.muted, fontSize: 11, textTransform: 'capitalize' }}>{v}</span>} />
      <Bar dataKey="pass"    fill={COLORS.pass}    radius={[3,3,0,0]} maxBarSize={18} isAnimationActive={false} />
      <Bar dataKey="fail"    fill={COLORS.fail}    radius={[3,3,0,0]} maxBarSize={18} isAnimationActive={false} />
      <Bar dataKey="pending" fill={COLORS.pending} radius={[3,3,0,0]} maxBarSize={18} isAnimationActive={false} />
    </BarChart>
  </ResponsiveContainer>
);
export default RBarChart;
