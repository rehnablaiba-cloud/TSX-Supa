// src/components/UI/SkeletonCard.tsx
// Phase 2.1-B3: extracted from Dashboard.tsx
// Generic animated skeleton card for loading states.

import React from 'react';

const SkeletonCard: React.FC = () => (
  <div className="card animate-pulse">
    <div className="flex items-start gap-3 mb-3">
      <span className="w-3 h-3 rounded-full mt-1.5 shrink-0 bg-bg-surface" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="h-4 w-[35%] rounded-sm bg-bg-surface" />
        <div className="h-3 w-[45%] rounded-sm bg-bg-surface" />
      </div>
      <div className="h-5 w-14 rounded-full bg-bg-surface shrink-0" />
    </div>
    <div className="flex items-center justify-between mb-3">
      <div className="h-3 w-16 rounded-sm bg-bg-surface" />
      <div className="h-4 w-8  rounded-sm bg-bg-surface" />
    </div>
    <div className="flex gap-2 mb-3">
      <div className="h-5 w-16 rounded-full bg-bg-surface" />
      <div className="h-5 w-14 rounded-full bg-bg-surface" />
      <div className="h-5 w-20 rounded-full bg-bg-surface" />
    </div>
    <div className="mt-1 space-y-1">
      <div className="flex justify-between">
        <div className="h-3 w-12 rounded-sm bg-bg-surface" />
        <div className="h-3 w-8  rounded-sm bg-bg-surface" />
      </div>
      <div className="h-1.5 w-full rounded-full bg-bg-surface" />
    </div>
  </div>
);

export default SkeletonCard;
