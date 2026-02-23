# Chat Presets Feature - Test Plan

## Overview
This test plan covers the Chat Presets feature implementation, which allows users to:
- Create and manage AI member preset templates
- Create and manage AI team preset templates
- Import presets into chat sessions via the AI Members Sidebar

## Test Categories

### 1. Backend Configuration Tests

#### 1.1 Config Version Migration (v8 -> v9)
- [ ] **TC-CONFIG-001**: Existing v8 config upgrades to v9 successfully
- [ ] **TC-CONFIG-002**: New installations have default v9 config with built-in presets
- [ ] **TC-CONFIG-003**: Config migration preserves all existing settings
- [ ] **TC-CONFIG-004**: Corrupted config falls back to default v9 config

#### 1.2 Chat Presets Structure
- [ ] **TC-STRUCT-001**: `chat_presets` field exists in Config v9
- [ ] **TC-STRUCT-002**: Member preset structure validates correctly
- [ ] **TC-STRUCT-003**: Team preset structure validates correctly
- [ ] **TC-STRUCT-004**: Built-in presets are marked with `is_builtin: true`
- [ ] **TC-STRUCT-005**: Default enabled state is `true` for new presets

#### 1.3 Built-in Presets Validation
- [ ] **TC-BUILTIN-001**: All 11 member presets exist:
  - solution_architect
  - backend_engineer
  - frontend_engineer
  - code_reviewer
  - qa_tester
  - devops_engineer
  - product_analyst
  - technical_writer
  - content_researcher
  - content_writer
  - content_editor
- [ ] **TC-BUILTIN-002**: All 5 team presets exist:
  - fullstack_development_team
  - content_production_team
  - codebase_audit_team
  - bugfix_strike_team
  - data_pipeline_team
- [ ] **TC-BUILTIN-003**: Built-in presets cannot be deleted
- [ ] **TC-BUILTIN-004**: Built-in presets can be disabled/enabled
- [ ] **TC-BUILTIN-005**: Built-in presets can be copied to custom presets

### 2. Frontend Settings Page Tests

#### 2.1 Navigation & UI
- [ ] **TC-NAV-001**: "Presets" section appears in Settings navigation
- [ ] **TC-NAV-002**: Member Templates view displays correctly
- [ ] **TC-NAV-003**: Team Templates view displays correctly
- [ ] **TC-NAV-004**: Navigation between views works smoothly
- [ ] **TC-NAV-005**: Mobile responsive design works correctly

#### 2.2 Member Template Management
- [ ] **TC-MEMBER-001**: Can create new custom member template
- [ ] **TC-MEMBER-002**: Can edit custom member template
- [ ] **TC-MEMBER-003**: Can disable/enable member template
- [ ] **TC-MEMBER-004**: Can copy built-in member template to custom
- [ ] **TC-MEMBER-005**: Cannot delete built-in member template
- [ ] **TC-MEMBER-006**: Can delete custom member template
- [ ] **TC-MEMBER-007**: Member list shows enabled/disabled status
- [ ] **TC-MEMBER-008**: Form validation works for required fields
- [ ] **TC-MEMBER-009**: Changes persist after page refresh
- [ ] **TC-MEMBER-010**: Unsaved changes warning appears on close

#### 2.3 Team Template Management
- [ ] **TC-TEAM-001**: Can create new custom team template
- [ ] **TC-TEAM-002**: Can edit custom team template
- [ ] **TC-TEAM-003**: Can add/remove members from team
- [ ] **TC-TEAM-004**: Member selection shows only enabled member templates
- [ ] **TC-TEAM-005**: Can disable/enable team template
- [ ] **TC-TEAM-006**: Can copy built-in team template to custom
- [ ] **TC-TEAM-007**: Cannot delete built-in team template
- [ ] **TC-TEAM-008**: Can delete custom team template
- [ ] **TC-TEAM-009**: Team list shows member count
- [ ] **TC-TEAM-010**: Changes persist after page refresh

### 3. AI Members Sidebar Tests

#### 3.1 Template Import UI
- [ ] **TC-SIDEBAR-001**: "Add from Template" section visible in sidebar
- [ ] **TC-SIDEBAR-002**: Member template quick-add buttons display
- [ ] **TC-SIDEBAR-003**: Team template import button displays
- [ ] **TC-SIDEBAR-004**: Templates list shows only enabled templates
- [ ] **TC-SIDEBAR-005**: Disabled session (no active session) shows appropriate message

#### 3.2 Member Template Import
- [ ] **TC-IMPORT-M-001**: Can add member template to active session
- [ ] **TC-IMPORT-M-002**: Member name conflict creates suffix (_2, _3, etc.)
- [ ] **TC-IMPORT-M-003**: Identical member (same runner_type + prompt + tools) reuses existing agent
- [ ] **TC-IMPORT-M-004**: Different member with same name creates new with suffix
- [ ] **TC-IMPORT-M-005**: Workspace path uses preset default or session default
- [ ] **TC-IMPORT-M-006**: Runner type follows priority: preset -> config -> first available

#### 3.3 Team Template Import
- [ ] **TC-IMPORT-T-001**: Team import shows preview dialog
- [ ] **TC-IMPORT-T-002**: Preview shows all members to be imported
- [ ] **TC-IMPORT-T-003**: Preview indicates conflict resolution (create/reuse/skip)
- [ ] **TC-IMPORT-T-004**: Can cancel import from preview
- [ ] **TC-IMPORT-T-005**: Can confirm and execute import
- [ ] **TC-IMPORT-T-006**: All members imported successfully on confirm
- [ ] **TC-IMPORT-T-007**: Members already in session are skipped (not modified)
- [ ] **TC-IMPORT-T-008**: workspace_path not modified for existing members

#### 3.4 Archived Session Handling
- [ ] **TC-ARCHIVE-001**: Template import disabled for archived sessions
- [ ] **TC-ARCHIVE-002**: Appropriate disabled state shown
- [ ] **TC-ARCHIVE-003**: Tooltip explains why disabled

### 4. Integration Tests

#### 4.1 Config Persistence
- [ ] **TC-PERSIST-001**: Template changes saved to config.json
- [ ] **TC-PERSIST-002**: Changes survive app restart
- [ ] **TC-PERSIST-003**: Multiple config updates don't corrupt data
- [ ] **TC-PERSIST-004**: Config API endpoints work correctly

#### 4.2 Session Integration
- [ ] **TC-SESSION-001**: Imported members appear in session immediately
- [ ] **TC-SESSION-002**: Imported members can send/receive messages
- [ ] **TC-SESSION-003**: Session state updates correctly after import
- [ ] **TC-SESSION-004**: Multiple imports to same session work correctly

#### 4.3 i18n Tests
- [ ] **TC-I18N-001**: English translations display correctly
- [ ] **TC-I18N-002**: Chinese translations display correctly
- [ ] **TC-I18N-003**: Language switching updates preset UI
- [ ] **TC-I18N-004**: All new keys are translated in both languages

### 5. Edge Cases & Error Handling

#### 5.1 Name Conflicts
- [ ] **TC-EDGE-001**: Multiple imports with same name create _2, _3, etc.
- [ ] **TC-EDGE-002**: Name conflict detection works across all sessions
- [ ] **TC-EDGE-003**: Special characters in names handled correctly

#### 5.2 Invalid States
- [ ] **TC-ERROR-001**: Import with no active session handled gracefully
- [ ] **TC-ERROR-002**: Missing template data shows error message
- [ ] **TC-ERROR-003**: Network error during save shows appropriate message
- [ ] **TC-ERROR-004**: Corrupted config doesn't crash app

#### 5.3 Performance
- [ ] **TC-PERF-001**: Large team import (10+ members) completes in reasonable time
- [ ] **TC-PERF-002**: Settings page loads quickly with many templates
- [ ] **TC-PERF-003**: No memory leaks after multiple imports/deletes

### 6. Build & Type Checking

#### 6.1 TypeScript Types
- [ ] **TC-BUILD-001**: `pnpm run generate-types` succeeds
- [ ] **TC-BUILD-002**: Generated types include ChatPresetsConfig
- [ ] **TC-BUILD-003**: Generated types include ChatMemberPreset
- [ ] **TC-BUILD-004**: Generated types include ChatTeamPreset
- [ ] **TC-BUILD-005**: `pnpm run check` passes without errors

#### 6.2 Linting
- [ ] **TC-LINT-001**: `pnpm run lint` passes for frontend
- [ ] **TC-LINT-002**: No TypeScript errors

#### 6.3 Rust Backend
- [ ] **TC-RUST-001**: `cargo check --workspace` passes
- [ ] **TC-RUST-002**: `cargo test --workspace` passes
- [ ] **TC-RUST-003**: `pnpm run backend:check` passes
- [ ] **TC-RUST-004**: Config serialization/deserialization works

### 7. User Acceptance Criteria

#### 7.1 Core Functionality
- [ ] **TC-UAT-001**: User can create and edit templates in Settings
- [ ] **TC-UAT-002**: User can add member template to session with one click
- [ ] **TC-UAT-003**: User can import team template with preview and confirm
- [ ] **TC-UAT-004**: Templates persist across app restarts
- [ ] **TC-UAT-005**: Built-in templates are protected from deletion

#### 7.2 User Experience
- [ ] **TC-UX-001**: Import flow is intuitive and clear
- [ ] **TC-UX-002**: Conflict resolution is transparent to user
- [ ] **TC-UX-003**: Error messages are helpful and actionable
- [ ] **TC-UX-004**: UI is responsive on different screen sizes

## Test Execution Order

### Phase 1: Backend Implementation
1. TC-CONFIG-* (Config migration)
2. TC-STRUCT-* (Data structures)
3. TC-BUILTIN-* (Built-in presets)
4. TC-RUST-* (Rust build/tests)

### Phase 2: Frontend Settings
1. TC-NAV-* (Navigation)
2. TC-MEMBER-* (Member management)
3. TC-TEAM-* (Team management)
4. TC-PERSIST-* (Persistence)

### Phase 3: Sidebar Import
1. TC-SIDEBAR-* (UI)
2. TC-IMPORT-M-* (Member import)
3. TC-IMPORT-T-* (Team import)
4. TC-ARCHIVE-* (Archived sessions)

### Phase 4: Integration & i18n
1. TC-SESSION-* (Session integration)
2. TC-I18N-* (Translations)
3. TC-EDGE-* (Edge cases)
4. TC-ERROR-* (Error handling)

### Phase 5: Final Verification
1. TC-BUILD-* (Build checks)
2. TC-LINT-* (Linting)
3. TC-PERF-* (Performance)
4. TC-UAT-* (User acceptance)
5. TC-UX-* (User experience)

## Defect Severity Levels

- **P0 (Critical)**: App crash, data loss, feature completely broken
- **P1 (High)**: Major functionality impaired, no workaround
- **P2 (Medium)**: Functionality impaired but workaround exists
- **P3 (Low)**: Minor UI issues, typos, cosmetic problems

## Exit Criteria

All tests must pass with:
- No P0 or P1 defects
- All P2 defects documented with workarounds
- P3 defects tracked for future fixes
- All build and lint checks passing
- Config migration verified on existing installations
