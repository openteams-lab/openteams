import React, { useEffect, useState } from 'react';
import { useWorkspace } from '@/context/WorkspaceContext';
import { 
  Plus, Folder, Rocket, Send, CreditCard, Bug, Package, FileText, Zap, 
  MessageSquare, GitBranch, CheckCircle, Loader2, Circle, GitPullRequest, 
  Trash, Edit, Palette, HelpCircle, Coins, Github, HelpCircle as HelpIcon, ArrowRight, Flame, ShieldCheck, Lock, Check, Sparkles
} from 'lucide-react';
import { Member } from '@/types';
import { ResourceStateNotice } from '@/components/ResourceState';
import { mockFrontendApi } from '@/lib/mockFrontendApi';
import type { OnboardType, OnboardingTeamMock } from '@/mockApiData';

export const OnboardingPro: React.FC = () => {
  const {
    t,
    selectedOnboardType,
    setSelectedOnboardType,
    setMembers,
    showToast,
    earlyBirdLeft,
    setEarlyBirdLeft,
    membersAsync,
    refreshMembers,
    skillsAsync,
    refreshSkills,
    configAsync,
    refreshConfig
  } = useWorkspace();

  const [subscribedPro, setSubscribedPro] = useState(false);
  const [onboardingTeams, setOnboardingTeams] =
    useState<Record<OnboardType, OnboardingTeamMock> | null>(null);

  useEffect(() => {
    void mockFrontendApi.getOnboardingTeams().then(setOnboardingTeams);
  }, []);

  const activeTeamData =
    onboardingTeams?.[selectedOnboardType] ?? { roles: [], tip: '' };

  const handleSetupTeam = () => {
    // Convert onboard roles to standard members state
    const mapped: Member[] = activeTeamData.roles.map(r => ({
      id: r.id,
      avatar: r.avatar,
      status: r.name === 'Frontend' || r.name === 'CLI core' ? 'run' : 'on',
      name: `@${r.name.replaceAll(' ', '').toLowerCase()}`,
      roleDetail: `${r.model} · active`,
      modelName: r.model
    }));

    setMembers(mapped);
    showToast(`Success! Your workspace is initialized for ${selectedOnboardType.toUpperCase()} creation!`);
  };

  const handleLockEarlyBird = () => {
    if (subscribedPro) {
      showToast("You are already subscribed to Pro!");
      return;
    }
    setSubscribedPro(true);
    setEarlyBirdLeft(prev => Math.max(1, prev - 1));
    showToast("Congratulations! You've locked the Early Bird rate. Pro insights are now unlocked!");
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 select-none">
      
      {/* First-Run Onboarding Flow */}
      <div className="flex flex-col">
        <div className="text-[10px] font-bold text-[var(--ink-tertiary)] uppercase tracking-wider mb-2.5 px-1">Interactive Setup</div>
        <div className="flex-1 rounded-xl border border-[var(--hairline)] bg-[var(--canvas)] p-6 space-y-6">
          
          <div className="flex items-center justify-center gap-2 text-xs font-semibold text-[var(--ink-subtle)]">
            <span className="h-3 w-3 rounded bg-[var(--primary)]" />
            <span>openteams</span>
          </div>

          <div className="text-center">
            <h2 className="text-base font-semibold text-[var(--ink)] tracking-tight">{t('whatAreYouBuilding')}</h2>
            <p className="mt-1 text-[11px] text-[var(--ink-subtle)]">
              {t('onboardSub')}
            </p>
          </div>

          {/* 2x2 Grid of project targets */}
          <div className="grid grid-cols-2 gap-2">
            <div 
              onClick={() => setSelectedOnboardType('saas')}
              className={`rounded-lg border p-3 cursor-pointer flex items-start gap-2.5 transition ${
                selectedOnboardType === 'saas' 
                  ? 'bg-[var(--surface-2)] border-[var(--primary)]' 
                  : 'bg-[var(--surface-1)] border-[var(--hairline)] hover:border-[var(--hairline-strong)]'
              }`}
            >
              <Rocket className="h-4.5 w-4.5 text-[var(--primary)] mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-[11px] text-[var(--ink)] leading-none">{t('saasTitle')}</p>
                <p className="text-[9px] font-mono text-[var(--ink-tertiary)] mt-1">{t('saasDesc')}</p>
              </div>
            </div>

            <div 
              onClick={() => setSelectedOnboardType('cli')}
              className={`rounded-lg border p-3 cursor-pointer flex items-start gap-2.5 transition ${
                selectedOnboardType === 'cli' 
                  ? 'bg-[var(--surface-2)] border-[var(--primary)]' 
                  : 'bg-[var(--surface-1)] border-[var(--hairline)] hover:border-[var(--hairline-strong)]'
              }`}
            >
              <Zap className="h-4.5 w-4.5 text-[var(--primary)] mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-[11px] text-[var(--ink)] leading-none">{t('devToolTitle')}</p>
                <p className="text-[9px] font-mono text-[var(--ink-tertiary)] mt-1">{t('devToolDesc')}</p>
              </div>
            </div>

            <div 
              onClick={() => setSelectedOnboardType('game')}
              className={`rounded-lg border p-3 cursor-pointer flex items-start gap-2.5 transition ${
                selectedOnboardType === 'game' 
                  ? 'bg-[var(--surface-2)] border-[var(--primary)]' 
                  : 'bg-[var(--surface-1)] border-[var(--hairline)] hover:border-[var(--hairline-strong)]'
              }`}
            >
              <Sparkles className="h-4.5 w-4.5 text-[var(--primary)] mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-[11px] text-[var(--ink)] leading-none">{t('gameTitle')}</p>
                <p className="text-[9px] font-mono text-[var(--ink-tertiary)] mt-1">{t('gameDesc')}</p>
              </div>
            </div>

            <div 
              onClick={() => setSelectedOnboardType('ai')}
              className={`rounded-lg border p-3 cursor-pointer flex items-start gap-2.5 transition ${
                selectedOnboardType === 'ai' 
                  ? 'bg-[var(--surface-2)] border-[var(--primary)]' 
                  : 'bg-[var(--surface-1)] border-[var(--hairline)] hover:border-[var(--hairline-strong)]'
              }`}
            >
              <MessageSquare className="h-4.5 w-4.5 text-[var(--primary)] mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-[11px] text-[var(--ink)] leading-none">{t('aiProductTitle')}</p>
                <p className="text-[9px] font-mono text-[var(--ink-tertiary)] mt-1">{t('aiProductDesc')}</p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-[var(--hairline)] bg-[var(--surface-1)] p-3">
            <p className="text-[10px] font-bold text-[var(--ink-tertiary)] uppercase tracking-wider mb-2">
              {t('recommendedTeamSaaS')}
            </p>
            <ResourceStateNotice
              resource={membersAsync}
              labels={{
                loading: 'Loading team roster...',
                empty: 'No team members are configured yet.',
                error: 'Team roster could not be refreshed.',
                fallback: 'Showing local team fallback.',
              }}
              onRetry={() => void refreshMembers()}
              compact
              className="mb-2"
            />
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {activeTeamData.roles.map(r => (
                <span key={r.id} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--hairline-strong)] bg-[var(--surface-3)] px-2 py-0.5 text-[10px] font-medium text-[var(--ink-muted)]">
                  <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--canvas)] border border-[var(--hairline)] text-[7px] font-mono">{r.avatar}</span>
                  {r.name}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-1.5 text-[10.5px] text-[var(--ink-subtle)] leading-relaxed">
              <GitBranch className="h-3.5 w-3.5 text-[var(--primary)]" />
              <span>{activeTeamData.tip}</span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-2">
            <button 
              onClick={() => showToast("Setup bypassed. Handover team configuration directly to defaults.")}
              className="text-xs text-[var(--ink-tertiary)] hover:text-[var(--ink)] cursor-pointer"
            >
              {t('skipOnboard')}
            </button>
            <button 
              onClick={handleSetupTeam}
              disabled={membersAsync.loading}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[var(--primary-hover)] cursor-pointer shadow-sm disabled:cursor-wait disabled:opacity-60"
            >
              <span>{t('setUpMyTeam')}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

        </div>
      </div>

      {/* Pro Upgrade Flow */}
      <div className="flex flex-col">
        <div className="text-[10px] font-bold text-[var(--ink-tertiary)] uppercase tracking-wider mb-2.5 px-1">Co-Pilot &amp; Membership tiers</div>
        <div className="flex-1 rounded-xl border border-[var(--hairline)] bg-[var(--canvas)] p-6 space-y-4">
          
          <div className="text-center">
            <h2 className="text-base font-semibold text-[var(--ink)] tracking-tight">{t('useTeamBetter')}</h2>
            <p className="mt-1 text-[11px] text-[var(--ink-subtle)]">
              {t('freeProSub')}
            </p>
          </div>

          <div className="space-y-2">
            <ResourceStateNotice
              resource={skillsAsync}
              labels={{
                loading: 'Loading skills catalog...',
                empty: 'No skills are installed yet.',
                error: 'Skills catalog could not be refreshed.',
              }}
              onRetry={() => void refreshSkills()}
              compact
            />
            <ResourceStateNotice
              resource={configAsync}
              labels={{
                loading: 'Loading workspace config...',
                empty: 'Workspace config is not available yet.',
                error: 'Workspace config could not be refreshed.',
              }}
              onRetry={() => void refreshConfig()}
              compact
            />
            {!skillsAsync.loading && !skillsAsync.empty && (
              <div className="rounded-lg border border-[var(--hairline)] bg-[var(--surface-1)] px-3 py-2 text-[10.5px] text-[var(--ink-subtle)]">
                <span className="font-mono text-[var(--primary)]">{skillsAsync.data.length}</span> skills available for this workspace.
              </div>
            )}
          </div>

          {/* Early Bird Scarcity element */}
          <div className="flex justify-center">
            <div 
              onClick={() => setEarlyBirdLeft(prev => Math.max(1, prev - 1))}
              className="flex items-center gap-2 rounded-full border border-[var(--hairline-strong)] bg-[var(--surface-1)] px-3.5 py-1.5 text-[11px]"
            >
              <Flame className="h-4 w-4 text-orange-500 fill-orange-500/30 animate-pulse" />
              <span>
                <strong className="text-[var(--primary)] font-semibold">{t('earlyBird')}</strong> · {t('earlyBirdText', { left: earlyBirdLeft })}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            
            {/* Free Tier */}
            <div className="rounded-xl border border-[var(--hairline)] bg-[var(--surface-1)] p-4 flex flex-col justify-between">
              <div>
                <span className="text-xs font-semibold text-[var(--ink)] tracking-tight">Free</span>
                <p className="text-[10px] text-[var(--ink-tertiary)] mt-0.5 font-mono">{t('freeForever')}</p>
                <div className="my-3 flex items-baseline gap-1">
                  <span className="text-xl font-bold font-mono tracking-tight text-[var(--ink)]">$0</span>
                  <span className="text-[10px] text-[var(--ink-tertiary)]">/month</span>
                </div>
                
                <div className="space-y-1.5 text-[10.5px] text-[var(--ink-muted)] border-t border-[var(--hairline)] pt-3">
                  <div className="flex gap-1.5 items-start">
                    <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                    <span><strong>Multi-model</strong> · Claude + Codex + Gemini</span>
                  </div>
                  <div className="flex gap-1.5 items-start">
                    <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                    <span>Dual Chat & Workflow</span>
                  </div>
                  <div className="flex gap-1.5 items-start">
                    <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                    <span>Cost dashboard</span>
                  </div>
                </div>
              </div>

              <button className="mt-4 w-full rounded border border-[var(--hairline-strong)] bg-[var(--surface-3)] py-1 text-[11px] text-[var(--ink-tertiary)] text-center cursor-not-allowed">
                {t('alreadyOnFree')}
              </button>
            </div>

            {/* Pro Tier */}
            <div className="rounded-xl border border-[var(--primary)] bg-[var(--surface-2)] p-4 flex flex-col justify-between relative overflow-hidden">
              {subscribedPro && (
                <div className="absolute top-2 right-2 bg-emerald-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded uppercase font-mono tracking-wider animate-bounce">
                  Active
                </div>
              )}
              <div>
                <span className="inline-block rounded-full bg-[var(--primary-tint)] px-2 py-0.5 text-[9px] font-medium text-[var(--primary)] mb-1">
                  {t('forDataDriven')}
                </span>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[var(--ink)] tracking-tight">Pro</span>
                </div>
                <p className="text-[10px] text-[var(--ink-tertiary)] mt-0.5 font-mono">$9 of insights, every month</p>
                <div className="my-3 flex items-baseline gap-1.5">
                  <span className="text-xl font-bold font-mono tracking-tight text-[var(--ink)]">$9</span>
                  <span className="text-[10px] text-[var(--ink-tertiary)]">/month</span>
                  <span className="text-[10px] text-[var(--ink-tertiary)] line-through">$19</span>
                </div>
                
                <div className="space-y-1.5 text-[10.5px] text-[var(--ink-muted)] border-t border-[var(--hairline)] pt-3">
                  <div className="font-semibold text-[10px] text-[var(--ink)]">{t('everythingInFreePlus')}</div>
                  <div className="flex gap-1.5 items-start">
                    <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                    <span>{t('ROIInsight')}</span>
                  </div>
                  <div className="flex gap-1.5 items-start">
                    <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                    <span>Smart routing v2</span>
                  </div>
                  <div className="flex gap-1.5 items-start">
                    <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                    <span>Config export/import</span>
                  </div>
                </div>
              </div>

              <button 
                onClick={handleLockEarlyBird}
                className={`mt-4 w-full flex items-center justify-center gap-1 rounded py-1.5 text-[11px] font-semibold text-white transition cursor-pointer ${
                  subscribedPro 
                    ? 'bg-emerald-600 hover:bg-emerald-700' 
                    : 'bg-[var(--primary)] hover:bg-[var(--primary-hover)]'
                }`}
              >
                <Flame className="h-3.5 w-3.5" />
                <span>{subscribedPro ? "Lock $9/mo — Active!" : t('lockNineEarlyBird')}</span>
              </button>
            </div>

          </div>

          {/* Trust assurances footer block */}
          <div className="rounded-lg border border-[var(--hairline)] bg-[var(--surface-1)] p-3 space-y-1.5 text-[10px] text-[var(--ink-subtle)] leading-none">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-500 flex-shrink-0" />
              <span>{t('moneyBackGuarantee')}</span>
            </div>
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-[var(--ink-tertiary)] flex-shrink-0" />
              <span>{t('codeLocalAlways')}</span>
            </div>
            <div className="flex items-center gap-2">
              <Github className="h-4 w-4 text-[var(--ink-tertiary)] flex-shrink-0" />
              <span>{t('freeNeverDowngraded')}</span>
            </div>
          </div>

        </div>
      </div>

    </div>
  );
};
