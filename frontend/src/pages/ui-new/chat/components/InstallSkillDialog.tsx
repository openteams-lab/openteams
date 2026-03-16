import { useEffect, useMemo, useState } from 'react';
import { DownloadIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import {
  ConfirmationDialogChrome,
  getConfirmationButtonClasses,
} from '@/components/dialogs/shared/ConfirmationDialogChrome';
import { AgentInfo } from '@/lib/api';
import { cn } from '@/lib/utils';

interface InstallSkillDialogProps {
  isOpen: boolean;
  skillName: string;
  skillDescription?: string;
  defaultAgent: string;
  availableAgents: AgentInfo[];
  isLoading?: boolean;
  onConfirm: (selectedAgents: string[]) => void;
  onCancel: () => void;
}

export function InstallSkillDialog({
  isOpen,
  skillName,
  skillDescription,
  defaultAgent,
  availableAgents,
  isLoading = false,
  onConfirm,
  onCancel,
}: InstallSkillDialogProps) {
  const { t } = useTranslation(['chat', 'common']);
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isOpen) {
      setSelectedAgents(new Set([defaultAgent]));
    }
  }, [isOpen, defaultAgent]);

  const toggleAgent = (agentId: string) => {
    setSelectedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) {
        next.delete(agentId);
      } else {
        next.add(agentId);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    const agents = Array.from(selectedAgents);
    if (agents.length > 0) {
      onConfirm(agents);
    }
  };

  const agentsList = useMemo(() => {
    return availableAgents.filter((agent) => agent.id !== 'agents');
  }, [availableAgents]);

  return (
    <ConfirmationDialogChrome
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isLoading) {
          onCancel();
        }
      }}
      onClose={onCancel}
      title={t('skillLibrary.installDialog.title')}
      tone="default"
      showIndicator={false}
      closeLabel={t('common:buttons.close')}
      bodyExtra={
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium text-[#333333]">{skillName}</div>
            {skillDescription && (
              <div className="mt-1 text-xs text-[#8C8C8C] line-clamp-2">{skillDescription}</div>
            )}
          </div>
          <div>
            <div className="mb-2 text-xs font-medium text-[#8C8C8C]">
              {t('skillLibrary.installDialog.selectAgents')}
            </div>
            <div className="space-y-1.5 max-h-[240px] overflow-y-auto">
              {agentsList.map((agent) => {
                const isSelected = selectedAgents.has(agent.id);
                return (
                  <label
                    key={agent.id}
                    className={cn(
                      'flex items-center gap-2.5 px-3 py-2 rounded-xl cursor-pointer transition-colors',
                      isSelected
                        ? 'bg-[#EEF5FF] border border-[#D7E7FB]'
                        : 'bg-[#F8F9FA] border border-transparent hover:bg-[#F0F2F5]'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleAgent(agent.id)}
                      className="sr-only"
                    />
                    <span
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded-[4px] border text-[10px]',
                        isSelected
                          ? 'bg-[#4A90E2] border-[#4A90E2] text-white'
                          : 'border-[#D9D9D9] bg-white'
                      )}
                    >
                      {isSelected && '✓'}
                    </span>
                    <span className="text-sm text-[#333333]">{agent.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      }
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className={getConfirmationButtonClasses('default', 'cancel')}
          >
            {t('common:buttons.cancel')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isLoading || selectedAgents.size === 0}
            className={cn(
              getConfirmationButtonClasses('default', 'confirm'),
              'inline-flex items-center gap-2'
            )}
          >
            <DownloadIcon size={16} weight="bold" />
            {isLoading
              ? t('skillLibrary.installDialog.installing')
              : t('skillLibrary.installDialog.install')}
          </button>
        </>
      }
    />
  );
}