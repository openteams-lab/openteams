import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  GitPullRequest,
  Github,
  ListChecks,
  MessageSquare,
  ShieldCheck,
} from 'lucide-react';
import { useWorkspace } from '@/context/WorkspaceContext';
import { projectDisplayName } from '@/lib/projectDisplay';
import { ProjectDeliveryStats } from './ProjectDeliveryStats';
import { ProjectGitHubSettings } from './ProjectGitHubSettings';
import { ProjectIssuePanel } from './ProjectIssuePanel';
import { ProjectPrCreateFlow } from './ProjectPrCreateFlow';
import { ProjectWorkItemsView } from './ProjectWorkItemsView';

type ProjectGitHubTab = 'settings' | 'issues' | 'work-items' | 'pr' | 'delivery';

const tabs: Array<{
  id: ProjectGitHubTab;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'settings', label: 'Connection', Icon: Github },
  { id: 'issues', label: 'Issues', Icon: MessageSquare },
  { id: 'work-items', label: 'Work items', Icon: ListChecks },
  { id: 'pr', label: 'Create PR', Icon: GitPullRequest },
  { id: 'delivery', label: 'Delivery', Icon: BarChart3 },
];

export function ProjectShell() {
  const { projects, selectedProjectId } = useWorkspace();
  const [activeTab, setActiveTab] = useState<ProjectGitHubTab>('settings');
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId),
    [projects, selectedProjectId],
  );

  if (!selectedProjectId) {
    return (
      <div className="flex h-full min-h-[360px] items-center justify-center p-6">
        <div className="max-w-md rounded-md border border-[var(--hairline)] bg-[var(--surface-1)] p-5 text-center">
          <ShieldCheck className="mx-auto mb-3 h-6 w-6 text-[var(--ink-tertiary)]" />
          <h1 className="text-sm font-semibold text-[var(--ink)]">
            Select a project
          </h1>
          <p className="mt-1 text-xs leading-relaxed text-[var(--ink-subtle)]">
            GitHub integration is scoped to one OpenTeams project at a time.
          </p>
        </div>
      </div>
    );
  }

  const projectName = selectedProject
    ? projectDisplayName(selectedProject)
    : selectedProjectId;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--surface-2)]">
      <header className="shrink-0 border-b border-[var(--hairline)] bg-[var(--surface-1)] px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase text-[var(--ink-tertiary)]">
              Project GitHub
            </p>
            <h1 className="text-lg font-semibold tracking-tight text-[var(--ink)]">
              {projectName}
            </h1>
          </div>
          <div className="flex min-w-0 flex-wrap gap-1 rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] p-1">
            {tabs.map(({ id, label, Icon }) => {
              const active = id === activeTab;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-[12px] font-medium transition ${
                    active
                      ? 'bg-[var(--surface-1)] text-[var(--ink)] shadow-sm'
                      : 'text-[var(--ink-subtle)] hover:text-[var(--ink)]'
                  }`}
                >
                  <Icon
                    className={`h-3.5 w-3.5 ${
                      active ? 'text-[var(--primary)]' : 'text-[var(--ink-tertiary)]'
                    }`}
                  />
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-4">
        {activeTab === 'settings' && (
          <ProjectGitHubSettings projectId={selectedProjectId} />
        )}
        {activeTab === 'issues' && (
          <ProjectIssuePanel projectId={selectedProjectId} />
        )}
        {activeTab === 'work-items' && (
          <ProjectWorkItemsView projectId={selectedProjectId} />
        )}
        {activeTab === 'pr' && (
          <ProjectPrCreateFlow projectId={selectedProjectId} />
        )}
        {activeTab === 'delivery' && (
          <ProjectDeliveryStats projectId={selectedProjectId} />
        )}
      </main>
    </div>
  );
}
