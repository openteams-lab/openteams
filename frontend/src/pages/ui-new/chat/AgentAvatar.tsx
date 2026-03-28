import type { CSSProperties } from 'react';
import { RobotIcon } from '@phosphor-icons/react';
import { BaseCodingAgent } from 'shared/types';
import { AgentIcon } from '@/components/agents/AgentIcon';
import { hashKey } from './utils';

type AvatarTone = {
  bg: string;
  border: string;
};

function hexToRgbChannels(hex: string): string {
  const normalized = hex.replace('#', '');
  const value =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : normalized;

  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);

  return `${red} ${green} ${blue}`;
}

const avatarPalette: AvatarTone[] = [
  { bg: '#fef4f0', border: '#f6d8cb' },
  { bg: '#fdf8ed', border: '#f2e1bf' },
  { bg: '#f5faef', border: '#d9e9bf' },
  { bg: '#eefaf6', border: '#c5e9db' },
  { bg: '#eef8ff', border: '#c9e1f6' },
  { bg: '#f2f5ff', border: '#d1daf5' },
  { bg: '#f7f3ff', border: '#ddd2f7' },
  { bg: '#fdf2fb', border: '#efd0ea' },
];

const knownBaseCodingAgents = new Set<string>(Object.values(BaseCodingAgent));

export function getAgentAvatarSeed(
  agentId: string | null | undefined,
  runnerType: string | null | undefined,
  agentName: string | null | undefined
): string {
  return `${runnerType ?? 'UNKNOWN'}:${agentId ?? agentName ?? 'agent'}`;
}

export function getAgentAvatarStyle(seed: string): CSSProperties {
  const paletteIndex = hashKey(seed) % avatarPalette.length;
  const tone = avatarPalette[paletteIndex];
  return {
    '--chat-agent-avatar-bg': tone.bg,
    '--chat-agent-avatar-bg-rgb': hexToRgbChannels(tone.bg),
    '--chat-agent-avatar-border': tone.border,
  } as CSSProperties;
}

function toBaseCodingAgent(
  runnerType: string | null | undefined
): BaseCodingAgent | null {
  if (!runnerType) return null;
  if (!knownBaseCodingAgents.has(runnerType)) return null;
  return runnerType as BaseCodingAgent;
}

interface AgentBrandIconProps {
  runnerType: string | null | undefined;
  className?: string;
}

export function AgentBrandIcon({ runnerType, className }: AgentBrandIconProps) {
  const baseCodingAgent = toBaseCodingAgent(runnerType);

  if (!baseCodingAgent) {
    return <RobotIcon className={className} weight="fill" />;
  }

  return <AgentIcon agent={baseCodingAgent} className={className} />;
}
