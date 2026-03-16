import { CheckCircleIcon, FileTextIcon, FlagIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { ChatMarkdown } from '@/components/ui-new/primitives/conversation/ChatMarkdown';
import { formatDateShortWithTime } from '@/utils/date';
import {
  AgentBrandIcon,
  getAgentAvatarSeed,
  getAgentAvatarStyle,
} from '../AgentAvatar';
import type { ChatWorkItemGroup } from '../types';

export interface ChatWorkItemCardProps {
  group: ChatWorkItemGroup;
  senderLabel: string;
  senderRunnerType: string | null;
}

export function ChatWorkItemCard({
  group,
  senderLabel,
  senderRunnerType,
}: ChatWorkItemCardProps) {
  const { t } = useTranslation('chat');
  const { t: tCommon } = useTranslation('common');
  const agentAvatarSeed = getAgentAvatarSeed(
    group.agentId,
    senderRunnerType,
    senderLabel
  );
  const agentAvatarStyle = getAgentAvatarStyle(agentAvatarSeed);

  return (
    <div className="chat-session-work-item-row flex justify-start">
      <div className="chat-session-work-item-card">
        <div className="chat-session-work-item-header">
          <div
            className="chat-session-work-item-avatar"
            style={agentAvatarStyle}
          >
            <AgentBrandIcon
              runnerType={senderRunnerType}
              className="chat-session-agent-avatar-logo"
            />
          </div>
          <div className="chat-session-work-item-heading">
            <div className="chat-session-work-item-eyebrow">
              {tCommon('conversation.taskCompleted')}
            </div>
            <div className="chat-session-work-item-title-row">
              <div className="chat-session-work-item-title">{senderLabel}</div>
              {group.artifacts.length > 0 && (
                <span className="chat-session-work-item-pill">
                  {t('timeline.workItem.artifactCount', {
                    count: group.artifacts.length,
                  })}
                </span>
              )}
              {group.conclusions.length > 0 && (
                <span className="chat-session-work-item-pill is-muted">
                  {t('timeline.workItem.statusCount', {
                    count: group.conclusions.length,
                  })}
                </span>
              )}
            </div>
            <div className="chat-session-work-item-meta">
              {formatDateShortWithTime(group.createdAt)}
            </div>
          </div>
          <CheckCircleIcon
            className="chat-session-work-item-complete-icon"
            weight="fill"
          />
        </div>

        {group.artifacts.length > 0 && (
          <section className="chat-session-work-item-section">
            <div className="chat-session-work-item-section-label">
              <FileTextIcon className="size-icon-base" />
              <span>{t('timeline.workItem.artifacts')}</span>
            </div>
            <div className="chat-session-work-item-section-body">
              {group.artifacts.map((item) => (
                <div
                  key={item.id}
                  className="chat-session-work-item-entry is-artifact"
                >
                  <ChatMarkdown
                    content={item.content}
                    maxWidth="100%"
                    hideCopyButton
                    textClassName="text-sm"
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {group.conclusions.length > 0 && (
          <section className="chat-session-work-item-section">
            <div className="chat-session-work-item-section-label">
              <FlagIcon className="size-icon-base" />
              <span>{t('timeline.workItem.conclusion')}</span>
            </div>
            <div className="chat-session-work-item-section-body">
              {group.conclusions.map((item) => (
                <div
                  key={item.id}
                  className="chat-session-work-item-entry is-conclusion"
                >
                  <ChatMarkdown
                    content={item.content}
                    maxWidth="100%"
                    hideCopyButton
                    textClassName="text-sm"
                  />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
