import type {
  AddProjectMemberRequest,
  ChatSession,
  CreateProjectRequest,
  Project,
  ProjectDetail,
  ProjectMemberWithRuntime,
  ProjectStats,
  ProjectStatsQuery,
  Repo,
  UpdateProject,
  UpdateProjectMemberRequest,
} from "../../../shared/types";
import type {
  BackendChatSession,
  ChatSessionStatus,
  UpdateChatSession,
} from "@/types";
import { readFileSync } from "node:fs";
import {
  chatSessionsApi,
  projectApi,
  type CreateProjectSessionRequest,
} from "./api";
import { paths } from "./paths";

type Equal<Actual, Expected> =
  (<T>() => T extends Actual ? 1 : 2) extends <T>() => T extends Expected
    ? 1
    : 2
    ? true
    : false;

type Expect<T extends true> = T;

export type ProjectApiListProjectsReturn = Expect<
  Equal<Awaited<ReturnType<typeof projectApi.listProjects>>, Project[]>
>;
export type ProjectApiCreateProjectArgs = Expect<
  Equal<
    Parameters<typeof projectApi.createProject>,
    [data: CreateProjectRequest]
  >
>;
export type ProjectApiCreateProjectReturn = Expect<
  Equal<Awaited<ReturnType<typeof projectApi.createProject>>, Project>
>;
export type ProjectApiGetProjectReturn = Expect<
  Equal<Awaited<ReturnType<typeof projectApi.getProject>>, ProjectDetail>
>;
export type ProjectApiGetProjectDetailSessionsReturn = Expect<
  Equal<
    Awaited<ReturnType<typeof projectApi.getProjectDetailSessions>>,
    ChatSession[]
  >
>;
export type ProjectApiUpdateProjectArgs = Expect<
  Equal<
    Parameters<typeof projectApi.updateProject>,
    [id: string, data: UpdateProject]
  >
>;
export type ProjectApiDeleteProjectArgs = Expect<
  Equal<Parameters<typeof projectApi.deleteProject>, [id: string]>
>;
export type ProjectApiDeleteProjectReturn = Expect<
  Equal<Awaited<ReturnType<typeof projectApi.deleteProject>>, void>
>;
export type ProjectApiListMembersReturn = Expect<
  Equal<
    Awaited<ReturnType<typeof projectApi.listMembers>>,
    ProjectMemberWithRuntime[]
  >
>;
export type ProjectApiAddMemberArgs = Expect<
  Equal<
    Parameters<typeof projectApi.addMember>,
    [projectId: string, data: AddProjectMemberRequest]
  >
>;
export type ProjectApiUpdateMemberArgs = Expect<
  Equal<
    Parameters<typeof projectApi.updateMember>,
    [projectId: string, memberId: string, data: UpdateProjectMemberRequest]
  >
>;
export type ProjectApiRemoveMemberReturn = Expect<
  Equal<Awaited<ReturnType<typeof projectApi.removeMember>>, void>
>;
export type ProjectApiListSessionsReturn = Expect<
  Equal<
    Awaited<ReturnType<typeof projectApi.listSessions>>,
    BackendChatSession[]
  >
>;
export type ProjectApiCreateSessionArgs = Expect<
  Equal<
    Parameters<typeof projectApi.createSession>,
    [projectId: string, data: CreateProjectSessionRequest]
  >
>;
export type ProjectApiCreateSessionReturn = Expect<
  Equal<
    Awaited<ReturnType<typeof projectApi.createSession>>,
    BackendChatSession
  >
>;
export type ProjectApiListReposReturn = Expect<
  Equal<Awaited<ReturnType<typeof projectApi.listRepos>>, Repo[]>
>;
export type ProjectApiGetStatsArgs = Expect<
  Equal<
    Parameters<typeof projectApi.getStats>,
    [projectId: string, params?: ProjectStatsQuery]
  >
>;
export type ProjectApiGetStatsReturn = Expect<
  Equal<Awaited<ReturnType<typeof projectApi.getStats>>, ProjectStats[]>
>;
export type ChatSessionsApiListArgs = Expect<
  Equal<
    Parameters<typeof chatSessionsApi.list>,
    [status?: ChatSessionStatus, projectId?: string]
  >
>;
export type ChatSessionsApiUpdateArgs = Expect<
  Equal<
    Parameters<typeof chatSessionsApi.update>,
    [sessionId: string, data: UpdateChatSession]
  >
>;
export type ChatSessionsApiDeleteArgs = Expect<
  Equal<Parameters<typeof chatSessionsApi.delete>, [sessionId: string]>
>;
export type ChatSessionsApiArchiveReturn = Expect<
  Equal<Awaited<ReturnType<typeof chatSessionsApi.archive>>, BackendChatSession>
>;
export type ChatSessionsApiRestoreReturn = Expect<
  Equal<Awaited<ReturnType<typeof chatSessionsApi.restore>>, BackendChatSession>
>;

export const projectPathExamples = [
  paths.projectList(),
  paths.projectDetail("project-1"),
  paths.projectMembers("project-1"),
  paths.projectSessions("project-1"),
];

let failures = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    // eslint-disable-next-line no-console
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    // eslint-disable-next-line no-console
    console.error(`  FAIL ${label}`, detail ?? "");
  }
};

const apiSource = readFileSync(new URL("./api.ts", import.meta.url), "utf8");

console.log("project session API contracts");
check(
  "project detail sessions come from data.sessions",
  apiSource.includes("return data.sessions;"),
  apiSource,
);
check(
  "standalone project session list uses project-scoped endpoint",
  apiSource.includes(
    "`/api/projects/${encodeURIComponent(projectId)}/sessions`",
  ),
  apiSource,
);
check(
  "chat session list filters with project_id query param",
  apiSource.includes("qs({ status, project_id: projectId })"),
  apiSource,
);
check(
  "chat session API exposes update delete archive and restore",
  apiSource.includes("update: async (") &&
    apiSource.includes("delete: async (sessionId: string)") &&
    apiSource.includes("archive: async (sessionId: string)") &&
    apiSource.includes("restore: async (sessionId: string)"),
  apiSource,
);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log("\nAll project session API contract assertions passed.");
}
