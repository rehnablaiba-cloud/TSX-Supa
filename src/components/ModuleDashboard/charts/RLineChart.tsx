// src/components/ModuleDashboard/charts/RLineChart.tsx
import React from 'react';
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { ChartRow, ChartTheme, COLORS } from './types';
import CustomTooltip from './CustomTooltip';

interface Props { data: ChartRow[]; ct: ChartTheme; height?: number; }

const TICK   = (ct: ChartTheme) => ({ fill: ct.muted, fontSize: 11 });
const MARGIN = { top: 8, right: 12, left: -16, bottom: 4 };
const LEGEND_FMT = (ct: ChartTheme) => (v: string) => (
  <span style={{ color: ct.muted, fontSize: 11, textTransform: 'capitalize' }}>{v}</span>
);

const RLineChart: React.FC<Props> = ({ data, ct, height = 220 }) => (
  <ResponsiveContainer width="100%" height={height}>
    <LineChart data={data} margin={MARGIN}>
      <CartesianGrid strokeDasharray="4 3" stroke={ct.grid} vertical={false} />
      <XAxis
        dataKey="name"
        tick={TICK(ct)}
        axisLine={false}
        tickLine={false}
        tickFormatter={v => v.length > 12 ? v.slice(0, 11) + '…' : v}
      />
      <YAxis tick={TICK(ct)} axisLine={false} tickLine={false} allowDecimals={false} />
      <Tooltip content={<CustomTooltip ct={ct} />} />
      <Legend
        iconType="square"
        iconSize={8}
        wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
        formatter={LEGEND_FMT(ct)}
      />
      <Line type="monotone" dataKey="pass"    stroke={COLORS.pass}    strokeWidth={2.5}
        dot={{ r: 3.5, strokeWidth: 0, fill: COLORS.pass }}    activeDot={{ r: 5, strokeWidth: 0 }} isAnimationActive={false} />
      <Line type="monotone" dataKey="fail"    stroke={COLORS.fail}    strokeWidth={2.5}
        dot={{ r: 3.5, strokeWidth: 0, fill: COLORS.fail }}    activeDot={{ r: 5, strokeWidth: 0 }} isAnimationActive={false} />
      <Line type="monotone" dataKey="pending" stroke={COLORS.pending} strokeWidth={2.5}
        dot={{ r: 3.5, strokeWidth: 0, fill: COLORS.pending }} activeDot={{ r: 5, strokeWidth: 0 }} isAnimationActive={false} />
    </LineChart>
  </ResponsiveContainer>
);
export default RLineChart;
