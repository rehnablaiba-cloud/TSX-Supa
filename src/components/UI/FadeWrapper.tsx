// src/components/UI/FadeWrapper.tsx
// Phase 2.1-A7: extracted from ModuleDashboard.tsx + TestReport.tsx
// Wraps children in a fadeSlideIn animation keyed by animKey.

import React from 'react';

interface Props {
  animKey: string | number;
  children: React.ReactNode;
}

const FadeWrapper: React.FC<Props> = ({ animKey, children }) => (
  <div key={animKey} style={{ animation: 'fadeSlideIn 0.28s cubic-bezier(0.22,1,0.36,1) both' }}>
    {children}
  </div>
);

export default FadeWrapper;
