import {
  mockDialogOptions,
  mockOnboardingTeams,
  mockSettingsOptions,
  mockShellOptions,
  mockWorkflowPresets,
  mockWorkspaceBootstrap,
  type DialogOptionsMock,
  type OnboardType,
  type OnboardingTeamMock,
  type SettingsOptionsMock,
  type ShellOptionsMock,
  type WorkflowPresetMock,
  type WorkspaceBootstrapMock,
} from '@/mockApiData';

const clone = <T>(value: T): T => structuredClone(value);

const respond = async <T>(value: T): Promise<T> => {
  await Promise.resolve();
  return clone(value);
};

export const mockFrontendApi = {
  getWorkspaceBootstrap: (): Promise<WorkspaceBootstrapMock> =>
    respond(mockWorkspaceBootstrap),

  getWorkflowPreset: async (
    id: WorkflowPresetMock['id'],
  ): Promise<WorkflowPresetMock | null> =>
    respond(mockWorkflowPresets.find((preset) => preset.id === id) ?? null),

  getOnboardingTeams: (): Promise<Record<OnboardType, OnboardingTeamMock>> =>
    respond(mockOnboardingTeams),

  getDialogOptions: (): Promise<DialogOptionsMock> =>
    respond(mockDialogOptions),

  getSettingsOptions: (): Promise<SettingsOptionsMock> =>
    respond(mockSettingsOptions),

  getShellOptions: (): Promise<ShellOptionsMock> =>
    respond(mockShellOptions),
};
