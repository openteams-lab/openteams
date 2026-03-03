import { useCallback, useEffect, useState } from 'react';
import {
  DownloadIcon,
  CheckIcon,
  MagnifyingGlassIcon,
  FolderIcon,
  XIcon,
  LightningIcon,
} from '@phosphor-icons/react';
import type {
  RemoteSkillMeta,
  RemoteSkillPackage,
  SkillCategory,
  ChatSkill,
} from 'shared/types';
import { chatApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { PrimaryButton } from '@/components/ui-new/primitives/PrimaryButton';

interface SkillMarketplaceProps {
  /** Whether the marketplace is in read-only mode */
  readOnly?: boolean;
  /** Callback when a skill is installed */
  onSkillInstalled?: (skill: ChatSkill) => void;
}

type ViewMode = 'marketplace' | 'installed';

export function SkillMarketplace({
  readOnly = false,
  onSkillInstalled,
}: SkillMarketplaceProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('marketplace');
  const [remoteSkills, setRemoteSkills] = useState<RemoteSkillMeta[]>([]);
  const [categories, setCategories] = useState<SkillCategory[]>([]);
  const [installedSkills, setInstalledSkills] = useState<ChatSkill[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [installingSkillId, setInstallingSkillId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<RemoteSkillMeta | null>(null);
  const [skillDetail, setSkillDetail] = useState<RemoteSkillPackage | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  const loadRemoteSkills = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [skills, cats] = await Promise.all([
        chatApi.listRegistrySkills(),
        chatApi.listRegistryCategories(),
      ]);
      setRemoteSkills(skills);
      setCategories(cats);
    } catch (err) {
      setError('Failed to load skill marketplace. Is the registry server running?');
      console.error('Failed to load remote skills:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadInstalledSkills = useCallback(async () => {
    try {
      const skills = await chatApi.listSkills();
      setInstalledSkills(skills);
    } catch (err) {
      console.error('Failed to load installed skills:', err);
    }
  }, []);

  useEffect(() => {
    if (isExpanded) {
      loadRemoteSkills();
      loadInstalledSkills();
    }
  }, [isExpanded, loadRemoteSkills, loadInstalledSkills]);

  const installedSkillIds = new Set(
    installedSkills
      .filter((s) => s.source === 'registry')
      .map((s) => s.source_url?.split('/').pop())
  );

  const filteredSkills = remoteSkills.filter((skill) => {
    const matchesSearch =
      !searchQuery ||
      skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      skill.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      skill.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCategory =
      !selectedCategory || skill.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handleInstallSkill = async (skillMeta: RemoteSkillMeta) => {
    setInstallingSkillId(skillMeta.id);
    setError(null);
    try {
      const installed = await chatApi.installRegistrySkill(
        skillMeta.id,
        undefined
      );
      await loadInstalledSkills();
      onSkillInstalled?.(installed);
    } catch (err) {
      setError(`Failed to install skill: ${skillMeta.name}`);
      console.error('Failed to install skill:', err);
    } finally {
      setInstallingSkillId(null);
    }
  };

  const handleViewSkillDetail = async (skill: RemoteSkillMeta) => {
    setSelectedSkill(skill);
    setIsLoadingDetail(true);
    try {
      const detail = await chatApi.getRegistrySkill(skill.id);
      setSkillDetail(detail);
    } catch (err) {
      console.error('Failed to load skill detail:', err);
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const isSkillInstalled = (skillId: string) => installedSkillIds.has(skillId);

  return (
    <div className="space-y-half">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="text-xs text-low flex items-center gap-1 hover:text-normal"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <LightningIcon size={12} />
          Skill Marketplace
          <span className="text-[10px]">{isExpanded ? '▾' : '▸'}</span>
        </button>
        {isExpanded && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setViewMode('marketplace')}
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded',
                viewMode === 'marketplace'
                  ? 'bg-accent text-white'
                  : 'text-low hover:text-normal'
              )}
            >
              Browse
            </button>
            <button
              type="button"
              onClick={() => setViewMode('installed')}
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded',
                viewMode === 'installed'
                  ? 'bg-accent text-white'
                  : 'text-low hover:text-normal'
              )}
            >
              Installed ({installedSkills.length})
            </button>
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="border border-border rounded p-1.5 space-y-1">
          {viewMode === 'marketplace' && (
            <>
              {/* Search and filter */}
              <div className="flex items-center gap-1">
                <div className="relative flex-1">
                  <MagnifyingGlassIcon
                    size={12}
                    className="absolute left-1.5 top-1/2 -translate-y-1/2 text-low"
                  />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search skills..."
                    className="w-full rounded-sm border bg-panel pl-6 pr-1.5 py-0.5 text-xs text-normal focus:outline-none"
                  />
                </div>
                {selectedCategory && (
                  <button
                    type="button"
                    onClick={() => setSelectedCategory(null)}
                    className="text-[10px] text-low hover:text-normal flex items-center gap-0.5"
                  >
                    <XIcon size={10} />
                    {selectedCategory}
                  </button>
                )}
              </div>

              {/* Categories */}
              {categories.length > 0 && !selectedCategory && (
                <div className="flex flex-wrap gap-0.5">
                  {categories.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSelectedCategory(cat.id)}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-panel hover:bg-border text-low hover:text-normal"
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              )}

              {/* Loading */}
              {isLoading && (
                <div className="text-xs text-low py-2 text-center">
                  Loading skills...
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="text-xs text-error py-1">
                  {error}
                  <button
                    type="button"
                    onClick={loadRemoteSkills}
                    className="ml-1 text-accent hover:underline"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Skill list */}
              {!isLoading && filteredSkills.length > 0 && (
                <div className="space-y-0.5 max-h-48 overflow-y-auto">
                  {filteredSkills.map((skill) => {
                    const installed = isSkillInstalled(skill.id);
                    const isInstalling = installingSkillId === skill.id;
                    return (
                      <div
                        key={skill.id}
                        className="flex items-center gap-1 px-1 py-0.5 rounded bg-panel hover:bg-border group"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-normal truncate">
                              {skill.name}
                            </span>
                            {skill.category && (
                              <span className="text-[10px] text-low shrink-0">
                                [{skill.category}]
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-low truncate">
                            {skill.description}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleViewSkillDetail(skill)}
                          className="text-low hover:text-normal shrink-0 opacity-0 group-hover:opacity-100"
                          title="View details"
                        >
                          <FolderIcon size={12} />
                        </button>
                        {!readOnly && (
                          installed ? (
                            <CheckIcon size={14} className="text-accent shrink-0" weight="bold" />
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleInstallSkill(skill)}
                              disabled={isInstalling}
                              className={cn(
                                'shrink-0',
                                isInstalling ? 'text-low' : 'text-low hover:text-accent'
                              )}
                              title="Install"
                            >
                              <DownloadIcon size={14} />
                            </button>
                          )
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {!isLoading && filteredSkills.length === 0 && (
                <div className="text-xs text-low py-2 text-center">
                  No skills found
                </div>
              )}
            </>
          )}

          {viewMode === 'installed' && (
            <>
              {installedSkills.length > 0 ? (
                <div className="space-y-0.5 max-h-48 overflow-y-auto">
                  {installedSkills.map((skill) => (
                    <div
                      key={skill.id}
                      className="flex items-center gap-1 px-1 py-0.5 rounded bg-panel"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-normal truncate">
                          {skill.name}
                        </div>
                        <p className="text-[10px] text-low truncate">
                          {skill.description || skill.content.slice(0, 50)}...
                        </p>
                      </div>
                      {skill.source === 'registry' && (
                        <span className="text-[10px] text-accent shrink-0">
                          Registry
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-low py-2 text-center">
                  No skills installed. Browse the marketplace to install skills.
                </div>
              )}
            </>
          )}

          {/* Skill Detail Modal */}
          {selectedSkill && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="bg-panel border border-border rounded-lg p-3 max-w-lg w-full mx-2 max-h-[80vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-normal">
                    {selectedSkill.name}
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSkill(null);
                      setSkillDetail(null);
                    }}
                    className="text-low hover:text-normal"
                  >
                    <XIcon size={16} />
                  </button>
                </div>

                {isLoadingDetail ? (
                  <div className="text-xs text-low py-2">Loading details...</div>
                ) : skillDetail ? (
                  <div className="space-y-2">
                    <p className="text-xs text-normal">
                      {skillDetail.description}
                    </p>

                    {skillDetail.author && (
                      <div className="text-[10px] text-low">
                        Author: {skillDetail.author}
                      </div>
                    )}

                    {skillDetail.tags.length > 0 && (
                      <div className="flex flex-wrap gap-0.5">
                        {skillDetail.tags.map((tag) => (
                          <span
                            key={tag}
                            className="text-[10px] px-1 py-0.5 rounded bg-border text-low"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {skillDetail.compatible_agents.length > 0 && (
                      <div className="text-[10px] text-low">
                        Compatible with:{' '}
                        {skillDetail.compatible_agents.join(', ')}
                      </div>
                    )}

                    <div className="border-t border-border pt-2 mt-2">
                      <div className="text-[10px] text-low mb-1">
                        Skill Instructions:
                      </div>
                      <pre className="text-xs text-normal bg-panel border border-border rounded p-2 whitespace-pre-wrap overflow-x-auto max-h-40">
                        {skillDetail.content}
                      </pre>
                    </div>

                    <div className="flex justify-end gap-1 pt-2">
                      <PrimaryButton
                        variant="tertiary"
                        value="Close"
                        onClick={() => {
                          setSelectedSkill(null);
                          setSkillDetail(null);
                        }}
                        className="!text-xs !px-2 !py-1"
                      />
                      {!readOnly && !isSkillInstalled(selectedSkill.id) && (
                        <PrimaryButton
                          value={installingSkillId === selectedSkill.id ? 'Installing...' : 'Install'}
                          onClick={() => {
                            handleInstallSkill(selectedSkill);
                            setSelectedSkill(null);
                            setSkillDetail(null);
                          }}
                          disabled={installingSkillId === selectedSkill.id}
                          className="!text-xs !px-2 !py-1"
                        />
                      )}
                      {isSkillInstalled(selectedSkill.id) && (
                        <span className="text-xs text-accent flex items-center gap-1">
                          <CheckIcon size={12} weight="bold" />
                          Installed
                        </span>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
