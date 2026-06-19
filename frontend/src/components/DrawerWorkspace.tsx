import React, { useState } from 'react';
import { PanelRightClose, PanelRightOpen, X } from 'lucide-react';

export const DrawerWorkspace: React.FC = () => {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="flex flex-col h-[600px] border border-[var(--hairline)] rounded overflow-hidden">
      {/* Header controls to toggle the drawer for demo purposes */}
      <div className="p-3 border-b border-[var(--hairline)] bg-[var(--surface-1)] flex items-center justify-between">
        <div className="text-sm font-medium text-[var(--ink)]">Side Drawer Example</div>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="p-1.5 rounded hover:bg-[var(--surface-2)] text-[var(--ink-subtle)] transition-colors"
        >
          {isOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Main Content Area */}
        <div className="flex-1 p-6 bg-[var(--canvas)] overflow-y-auto">
          <h2 className="text-lg font-semibold text-[var(--ink)] mb-4">Main Content Area</h2>
          <p className="text-[var(--ink-subtle)] text-sm mb-4">
            This area represents the main content of the page. The drawer on the right can be toggled open or closed.
            Notice how the UI style of the drawer is unified with the rest of the application, utilizing the standard
            design tokens for background colors, text colors, and borders.
          </p>
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="p-4 border border-[var(--hairline)] rounded bg-[var(--surface-1)]">
                <div className="font-medium text-[var(--ink)] text-sm">Content Block {i}</div>
                <div className="text-xs text-[var(--ink-tertiary)] mt-1">Simulated main content item...</div>
              </div>
            ))}
          </div>
        </div>

        {/* Drawer Area */}
        <div 
          className={`
            border-l border-[var(--hairline)] bg-[var(--surface-1)] 
            transition-all duration-300 ease-in-out flex flex-col shrink-0
            ${isOpen ? 'w-80 translate-x-0' : 'w-0 translate-x-full opacity-0 overflow-hidden border-transparent'}
          `}
        >
          <div className="p-4 border-b border-[var(--hairline)] flex items-center justify-between shrink-0">
            <h3 className="font-semibold text-sm text-[var(--ink)]">Drawer Title</h3>
            <button 
              onClick={() => setIsOpen(false)}
              className="p-1 rounded-md text-[var(--ink-subtle)] hover:text-[var(--ink)] hover:bg-[var(--surface-2)] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-4 flex-1 overflow-y-auto">
            <div className="space-y-6">
              <div>
                <label className="block text-xs font-medium text-[var(--ink-subtle)] mb-1.5">Section 1</label>
                <div className="text-sm text-[var(--ink)] p-2.5 rounded bg-[var(--surface-2)] border border-[var(--hairline)]">
                  Drawer content related to the selected context.
                </div>
              </div>
              
              <div>
                <label className="block text-xs font-medium text-[var(--ink-subtle)] mb-1.5">Settings</label>
                <div className="space-y-2">
                  {[1, 2].map((i) => (
                    <label key={i} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" className="rounded border-[var(--hairline)] bg-[var(--canvas)] text-[var(--primary)] focus:ring-[var(--primary)] focus:ring-offset-0" />
                      <span className="text-sm text-[var(--ink)]">Option {i}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--ink-subtle)] mb-1.5">Actions</label>
                <div className="flex gap-2">
                  <button className="flex-1 py-1.5 px-3 rounded bg-[var(--surface-2)] border border-[var(--hairline)] text-xs font-medium text-[var(--ink)] hover:bg-[var(--surface-3)] transition-colors">
                    Secondary
                  </button>
                  <button className="flex-1 py-1.5 px-3 rounded bg-[var(--primary)] text-white text-xs font-medium hover:bg-[var(--primary-hover)] transition-colors">
                    Primary
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
