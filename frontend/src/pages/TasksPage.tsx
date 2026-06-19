import React from 'react';
import { ModalsWorkspace } from '@/components/ModalsWorkspace';

export function TasksPage() {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="pb-4 mb-2 select-all">
        <h1 className="text-base font-bold tracking-tight text-[var(--ink)]">
          Action Center
        </h1>
        <p className="text-xs text-[var(--ink-subtle)] mt-1">
          Simulate key workspace dialog responses, task creations, and
          verification guidelines.
        </p>
      </div>
      <ModalsWorkspace />
    </div>
  );
}
