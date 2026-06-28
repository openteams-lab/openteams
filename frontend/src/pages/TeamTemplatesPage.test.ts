// Smoke tests for the team templates page wiring.
//
// No test runner is installed. Run with:
//     pnpm exec tsx src/pages/TeamTemplatesPage.test.ts
// Exits non-zero if any assertion fails.

import { readFileSync } from 'node:fs';
import {
  addCustomMemberDraft,
  commitMemberSystemPromptDraft,
  commitTeamProtocolDraft,
  createTeamPresetDraft,
  teamPresetDraftToPayload,
  validateMemberToolsEnabledDraft,
  validateTeamPresetDraft,
} from './TeamTemplatesPage';

let failures = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    // eslint-disable-next-line no-console
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    // eslint-disable-next-line no-console
    console.error(`  FAIL ${label}`, detail ?? '');
  }
};

const source = readFileSync(new URL('./TeamTemplatesPage.tsx', import.meta.url), 'utf8');
const styleSource = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

console.log('TeamTemplatesPage');

const draft = createTeamPresetDraft();
check(
  'new entry creates an aggregate draft',
  draft.leadMemberId === 'lead' &&
    draft.id.startsWith('custom_') &&
    draft.members.length === 1 &&
    Array.isArray(draft.workflowSteps),
  draft,
);

const added = addCustomMemberDraft({
  ...draft,
  name: 'Custom team',
  workflowSteps: [
    { title: 'Plan', description: '' },
    { title: '  ', description: '  ' },
  ],
});
check(
  'add member updates draft and selects the new member',
  added.form.members.length === 2 &&
    added.selectedMemberId === added.form.members[1]?.id,
  added,
);

const markdownDraft = commitMemberSystemPromptDraft(
  commitTeamProtocolDraft(added.form, '## Review rules'),
  added.selectedMemberId,
  '### Role\nReview the delivery plan.',
);
check(
  'markdown edits write into the aggregate draft',
  markdownDraft.teamProtocol.includes('Review rules') &&
    markdownDraft.members[1]?.systemPrompt.includes('delivery plan'),
  markdownDraft,
);

const invalidMcpDraft = {
  ...markdownDraft,
  members: markdownDraft.members.map((member) =>
    member.id === added.selectedMemberId
      ? { ...member, toolsEnabledText: '{ invalid json' }
      : member,
  ),
};
const invalidMcpResult = validateTeamPresetDraft(invalidMcpDraft);
check(
  'invalid MCP JSON is reported against the edited member',
  invalidMcpResult.issue?.memberId === added.selectedMemberId &&
    invalidMcpResult.issue.message ===
      'Invalid JSON format. Please check your syntax.',
  invalidMcpResult,
);

const blankNameInvalidMcp = {
  ...draft,
  members: [{ ...draft.members[0]!, toolsEnabledText: '{ invalid json' }],
};
const memberOnlyMcpResult = validateMemberToolsEnabledDraft(
  blankNameInvalidMcp,
  'lead',
);
check(
  'MCP blur validation targets tools JSON before whole-form required fields',
  memberOnlyMcpResult?.memberId === 'lead' &&
    memberOnlyMcpResult.message ===
      'Invalid JSON format. Please check your syntax.',
  memberOnlyMcpResult,
);

const fixedMcpDraft = {
  ...markdownDraft,
  members: markdownDraft.members.map((member) =>
    member.id === added.selectedMemberId
      ? {
          ...member,
          toolsEnabledText: '{"mcpServers":{"filesystem":true}}',
          selectedSkillIdsText: 'review, planning',
        }
      : member,
  ),
};
const payload = teamPresetDraftToPayload(fixedMcpDraft);
check(
  'payload mapping filters blank workflow steps and parses MCP JSON',
    payload.workflow_steps.length === 1 &&
    payload.workflow_steps[0]?.title === 'Plan' &&
    Boolean(payload.members[1]?.tools_enabled) &&
    typeof payload.members[1].tools_enabled === 'object' &&
    !Array.isArray(payload.members[1].tools_enabled),
  payload,
);

const invalidMemberName = validateTeamPresetDraft({
  ...draft,
  name: 'Needs member name',
  members: [{ ...draft.members[0]!, name: '' }],
});
check(
  'member name validation runs before submit',
  invalidMemberName.issue?.message === 'Member name is required.',
  invalidMemberName,
);

check('loads templates through the real API adapter', source.includes('teamPresetsApi.list()'));
check('loads template details on selection', source.includes('teamPresetsApi.get('));
check('groups backend templates under my team templates', source.includes('myTeamTemplates') && source.includes('我的团队模板'));
check('renders advanced team templates from mock data', source.includes('advancedTeamTemplates') && source.includes('更多推荐模板'));
check('keeps the detail page in the Linear-style pipeline layout', source.includes('team-template-workflow-preview') && source.includes('PIPELINE /') && source.includes('MEMBERS /'));
check('shows recoverable loading errors', source.includes('loadError') && source.includes('loadTemplates()'));
check('shows an empty my-template state', source.includes('myTeamTemplates.length === 0'));
check('keeps built-in templates read-only', source.includes('selectedDetail.is_builtin') && source.includes('canEditSelected'));
check('supports create, update, and delete flows', source.includes('teamPresetsApi.create') && source.includes('teamPresetsApi.update') && source.includes('teamPresetsApi.delete'));
check('confirms deletion before mutating', source.includes('window.confirm'));
check('preserves form input on save failure', source.includes('setFormError(errorMessage') && source.includes('return;'));
check('confirms unsaved editor exit before leaving edit mode', source.includes('UnsavedEditorExitDialog') && source.includes('hasUnsavedEditorChanges') && source.includes('保存并退出') && source.includes('丢弃修改') && source.includes('{isEditing ? "退出" : "返回模板"}'));
check('auto-generates template ids and hides low-value toggles in the editor', source.includes('createUniqueTemplateId') && !source.includes('label="模板 ID"') && !source.includes('Enabled in picker'));
check('uses content-as-ui document header in edit mode', source.includes('team-template-document-head') && source.includes('team-template-document-title') && source.includes('team-template-document-description') && source.includes('absolute right-0 top-0') && !source.includes('label="团队名"') && !source.includes('label="描述"'));
check('uses edit-mode auto-save with a subtle saved status', source.includes('editorSaveStatus') && source.includes('autoSaveTemplate(form)') && source.includes('Saved') && source.includes('window.setTimeout'));
check('folds edit-mode delete into the more menu', source.includes('MoreHorizontal') && source.includes('Delete template') && source.includes('setMoreMenuOpen') && !source.includes('mt-8 flex flex-wrap items-center justify-end gap-3 border-t'));
check('shows member skills and role prompt details', source.includes('selected_skill_ids') && source.includes('system_prompt'));
check('uses shared DropdownSelect for member runtime and model picking', source.includes('DropdownSelect') && source.includes('runtimeOptions') && source.includes('modelOptions') && source.includes('setRuntimes(response.runners)'));
check('uses shared DropdownSelect for runtime-specific skill picking', source.includes('selectionMode="multiple"') && source.includes('listNative(effectiveRunnerType)') && source.includes('runtimeSkills') && source.includes('skillPlaceholder') && !source.includes('技能 ID（逗号分隔）'));
check('keeps Linear visual refinement hooks', source.includes('team-template-card') && source.includes('team-template-member-row') && source.includes('team-template-field'));
check('uses aggregate draft workflow steps', source.includes('workflowSteps') && source.includes('normalizeWorkflowSteps'));
check('supports editable markdown fields rendered with AgentMarkdown', source.includes('function MarkdownEditableField') && source.includes('<AgentMarkdown content={value}'));
check('edits member tool JSON through toolsEnabledText', source.includes('toolsEnabledText') && source.includes('parseToolsEnabled'));
check('validates required team and member fields before saving', source.includes('validateTeamPresetForm') && source.includes('Team name is required.') && source.includes('Member name is required.'));
check('blocks invalid MCP JSON before payload submission', source.includes('Invalid JSON format. Please check your syntax.'));
check('MCP blur validation sets visible member tool errors', source.includes('validateMemberToolsOnBlur') && source.includes('setFormError(issue.message)') && source.includes('setEditorSelectedMemberId(issue.memberId)'));
check('MCP blur uses member-scoped validation instead of whole-form validation', source.includes('{ validateTools: true }') && source.includes('onValidateMemberTools?.(nextForm, selectedFormMember.id)'));
check('workflow step edit keys stay stable while title changes', source.includes('key={`workflow-step-${index}`}') && !source.includes('key={`${index}-${step.title}`}'));
check('workflow edit fields use compact text-flow editing', source.includes('team-template-deboxed-workflow') && source.includes('team-template-compact-workflow-step') && source.includes('grid-cols-[24px_minmax(0,1fr)_24px]') && source.includes('team-template-workflow-step-title') && source.includes('team-template-workflow-step-description') && !source.includes('label="步骤标题"') && !source.includes('label="步骤描述"'));
check('edit detail uses compact Linear density and hover-revealed actions', source.includes('team-template-compact-editor') && source.includes('team-template-compact-field') && source.includes('variant="inline"') && source.includes('group-hover:pointer-events-auto') && source.includes('compact'));
check('edit detail removes the large title-to-content spacer but keeps title breathing room', source.includes('editable ? "pt-3"') && source.includes('isEditing ? "pt-3"') && source.includes('isEditing ? "gap-8" : "gap-12"') && !source.includes('mt-8 gap-8') && !source.includes('isEditing ? "pb-8"'));
check('workflow and member headings align on the same row height', source.includes('mb-3 flex min-h-7 items-center justify-between gap-3') && source.includes('mb-2 flex min-h-7 items-center justify-between gap-3'));
check('editable MCP JSON uses code editor visual treatment', source.includes('pl-10 pr-3 font-mono') && styleSource.includes('--team-template-code-surface: #070708'));
check('new/edit detail uses sharp field focus tokens', source.includes('focus:border-[var(--team-template-field-focus)]') && styleSource.includes('--team-template-field-surface'));
check('delete actions expose deleting state', source.includes('Deleting...') && source.includes('deleting={deleting}') && source.includes('setEditorMode(null);'));
check('reuses TemplateDetailView for create and edit mode', !source.includes('<TemplateEditor') && source.includes('editorMode={editorMode}'));
check('adds and auto-selects custom member drafts', source.includes('addCustomMember') && source.includes('setSelectedMemberId(nextMember.id)'));
check('keeps readonly detail rendering isolated from editable controls', source.includes('const isEditing = Boolean(editorMode && form)') && source.includes('canEdit && !isEditing'));

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console
  console.log('\nAll TeamTemplatesPage assertions passed.');
}
