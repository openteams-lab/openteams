import React from 'react';
import { DropdownsWorkspace } from '@/components/DropdownsWorkspace';

export function RoutingPage() {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="pb-4 mb-2 select-all">
        <h1 className="text-base font-bold tracking-tight text-[var(--ink)]">
          Routing Engine
        </h1>
        <p className="text-xs text-[var(--ink-subtle)] mt-1">
          Evaluate specific routing logic thresholds and summon live agent
          profiles in real-time.
        </p>
      </div>
      <DropdownsWorkspace />
    </div>
  );
}
