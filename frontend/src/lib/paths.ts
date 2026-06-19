export const paths = {
  projectList: () => '/projects',
  projectDetail: (projectId: string) => `/projects/${projectId}`,
  projectMembers: (projectId: string) => `/projects/${projectId}/members`,
  projectSessions: (projectId: string) => `/projects/${projectId}/sessions`,
};
