export type TeamMemberInviteNavigationTarget = {
  projectId?: string;
};

export const TEAM_MEMBER_INVITE_NAVIGATION_EVENT =
  "openteams:navigate-team-member-invite";
export const TEAM_MEMBER_INVITE_TARGET_CHANGED_EVENT =
  "openteams:team-member-invite-target-updated";

const TEAM_MEMBER_INVITE_STORAGE_KEY =
  "openteams:team-member-invite-navigation-target";

function isTeamMemberInviteNavigationTarget(
  value: unknown,
): value is TeamMemberInviteNavigationTarget {
  if (!value || typeof value !== "object") return false;

  const target = value as Partial<TeamMemberInviteNavigationTarget>;
  return (
    target.projectId === undefined ||
    (typeof target.projectId === "string" && target.projectId.length > 0)
  );
}

export function readTeamMemberInviteTarget(): TeamMemberInviteNavigationTarget | null {
  if (typeof window === "undefined") return null;

  try {
    const rawTarget = window.sessionStorage.getItem(
      TEAM_MEMBER_INVITE_STORAGE_KEY,
    );
    if (!rawTarget) return null;

    const parsedTarget = JSON.parse(rawTarget);
    return isTeamMemberInviteNavigationTarget(parsedTarget)
      ? parsedTarget
      : null;
  } catch {
    return null;
  }
}

export function storeTeamMemberInviteTarget(
  target: TeamMemberInviteNavigationTarget,
): void {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(
      TEAM_MEMBER_INVITE_STORAGE_KEY,
      JSON.stringify(target),
    );
  } catch {
    // Ignore storage failures; the live event still opens the members page.
  }
}

export function clearTeamMemberInviteTarget(): void {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(TEAM_MEMBER_INVITE_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
}

export function requestTeamMemberInviteNavigation(
  target: TeamMemberInviteNavigationTarget,
): void {
  if (typeof window === "undefined") return;

  storeTeamMemberInviteTarget(target);
  window.dispatchEvent(
    new CustomEvent<TeamMemberInviteNavigationTarget>(
      TEAM_MEMBER_INVITE_NAVIGATION_EVENT,
      { detail: target },
    ),
  );
}
