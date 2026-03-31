import React from "react";

const Spinner: React.FC<{ size?: number }> = ({ size = 40 }) => (
  <div className="flex items-center justify-center">
    <svg width={size} height={size} viewBox="0 0 40 40">
      <circle cx="20" cy="20" r="16" fill="none" stroke="#374151" strokeWidth="4" />
      <circle cx="20" cy="20" r="16" fill="none" stroke="#3b82f6" strokeWidth="4"
        strokeDasharray="60 44" strokeLinecap="round"
        style={{ transformOrigin:"center", animation:"spin 1s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  </div>
);
export default Spinner;
