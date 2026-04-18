// src/components/ModuleDashboard/charts/RLineChart.tsx
import React from 'react';
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { ChartRow, ChartTheme, COLORS } from './types';
import CustomTooltip from './CustomTooltip';

interface Props { data: ChartRow[]; ct: ChartTheme; }

const RLineChart: React.FC<Props> = ({ data, ct }) => (
  <ResponsiveContainer width="100%" height={220}>
    <LineChart data={data} margin={{ top: 8, right: 16, left: -16, bottom: 8 }}>
      <CartesianGrid strokeDasharray="4 3" stroke={ct.grid} vertical={false} />
      <XAxis dataKey="name" tick={{ fill: ct.muted, fontSize: 11 }} axisLine={false} tickLine={false}
        tickFormatter={v => v.length > 10 ? v.slice(0, 9) + '…' : v} />
      <YAxis tick={{ fill: ct.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
      <Tooltip content={<CustomTooltip ct={ct} />} />
      <Legend iconType="square" iconSize={10}
        formatter={v => <span style={{ color: ct.muted, fontSize: 11, textTransform: 'capitalize' }}>{v}</span>} />
      <Line type="monotone" dataKey="pass"    stroke={COLORS.pass}    strokeWidth={2.5} dot={{ r: 3.5, strokeWidth: 1.5, fill: ct.panel }} activeDot={{ r: 5 }} isAnimationActive={false} />
      <Line type="monotone" dataKey="fail"    stroke={COLORS.fail}    strokeWidth={2.5} dot={{ r: 3.5, strokeWidth: 1.5, fill: ct.panel }} activeDot={{ r: 5 }} isAnimationActive={false} />
      <Line type="monotone" dataKey="pending" stroke={COLORS.pending} strokeWidth={2.5} dot={{ r: 3.5, strokeWidth: 1.5, fill: ct.panel }} activeDot={{ r: 5 }} isAnimationActive={false} />
    </LineChart>
  </ResponsiveContainer>
);
export default RLineChart;
