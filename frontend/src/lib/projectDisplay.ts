const LEGACY_MIGRATION_PROJECT_ID =
  "11111111-1111-4111-8111-111111111111";
const LEGACY_MIGRATION_PROJECT_MARKER = "__migrate__:legacy_chat_sessions";
const LEGACY_MIGRATION_PROJECT_LABEL = "旧版本会话";

type ProjectDisplaySource = {
  id: string;
  name: string;
  description?: string | null;
};

export const isLegacyMigrationProject = (
  project: ProjectDisplaySource,
): boolean =>
  project.id === LEGACY_MIGRATION_PROJECT_ID ||
  project.description === LEGACY_MIGRATION_PROJECT_MARKER;

export const projectDisplayName = (project: ProjectDisplaySource): string =>
  isLegacyMigrationProject(project)
    ? LEGACY_MIGRATION_PROJECT_LABEL
    : project.name;

export const projectDisplayDescription = (
  project: ProjectDisplaySource,
): string =>
  isLegacyMigrationProject(project) ? "" : project.description ?? "";
