import React from "react";

interface Props { label: string; value: number | string; color?: string; icon?: string; }

const StatCard: React.FC<Props> = ({ label, value, color = "text-white", icon }) => (
  <div className="card flex flex-col gap-1">
    {icon && <span className="text-2xl">{icon}</span>}
    <span className={`text-2xl font-bold ${color}`}>{value}</span>
    <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">{label}</span>
  </div>
);
export default StatCard;
