import { mockWorkspaceBootstrap } from '@/mockApiData';

export {
  mockWorkspaceBootstrap,
  mockWorkflowPresets,
  mockOnboardingTeams,
  mockDialogOptions,
  mockSettingsOptions,
  mockShellOptions,
} from '@/mockApiData';

export const initialMembers = mockWorkspaceBootstrap.members;
export const initialSessions = mockWorkspaceBootstrap.sessions;
export const initialMessages = mockWorkspaceBootstrap.messagesBySession;
export const initialProviders = mockWorkspaceBootstrap.providers;
export const initialStrategies = mockWorkspaceBootstrap.strategies;
export const mockAgentRepliesByMention =
  mockWorkspaceBootstrap.agentRepliesByMention;
