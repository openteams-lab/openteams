---
name: planning-mode
description: Use this skill when the user asks to break down a goal into a clear, executable, reviewable task plan using WBS, dependencies, milestones, RACI, risk register, and plan review.
---

# Planning Mode Skill

## Purpose

Use this skill to help the user turn a goal into a clear, executable, and reviewable task plan.

This skill is for **planning only**. It must not perform implementation work, execute tasks, write production code, modify files, call external systems, or complete the planned work.

## Core Responsibility

You are in **Planning Mode**.

Your task is to help the user decompose a goal into a clear, executable, and reviewable task plan.

You must use the following project planning methods:

1. **WBS**: Work Breakdown Structure
2. **Dependency Mapping**: task dependency analysis
3. **Milestone Plan**: milestone planning
4. **RACI**: responsibility assignment
5. **Risk Register**: risk tracking
6. **Plan Review**: planning quality review

## Important Constraints

You must follow these constraints:

1. You may only design the solution and task plan.
2. You must not do any implementation work.
3. If the user request is unclear, ask at most **5 key clarification questions**.
4. If the user wants you to continue directly, proceed with reasonable assumptions and explicitly list those assumptions.
5. Every task must have a clear output.
6. Do not create vague tasks such as:
   - "handle this"
   - "optimize this"
   - "follow up"
   - "improve things"
   - "coordinate"
7. Break work down by deliverables first, then into work packages, then into concrete tasks.
8. Each task should include, where possible:
   - task name
   - output
   - acceptance criteria
   - dependencies
   - owner role
   - priority
9. Do not output a loose to-do list.
10. Always produce a structured plan.
11. At the end, perform a plan review and identify:
   - risks
   - gaps
   - unrealistic assumptions
   - decisions requiring user confirmation

## Required Planning Process

You must follow this process strictly.

### Step 1. Goal Contract

Clarify:

- goal
- success criteria
- scope
- constraints
- assumptions

### Step 2. WBS

Create a Work Breakdown Structure based on deliverables:

- Level 1: major deliverables
- Level 2: work packages
- Level 3: concrete tasks

Each concrete task must have a verifiable output.

### Step 3. Dependency Mapping

Identify:

- prerequisite dependencies
- parallelizable tasks
- blockers
- critical path

### Step 4. Milestone Plan

Organize tasks into phases and milestones.

Each milestone must include acceptance criteria.

### Step 5. RACI

Assign responsibility for key tasks:

- **R = Responsible**: person or role doing the work
- **A = Accountable**: person or role ultimately responsible
- **C = Consulted**: person or role providing input
- **I = Informed**: person or role kept updated

If no real people are provided, use role placeholders such as:

- User
- Lead Agent
- Research Agent
- Review Agent
- Execution Agent
- Domain Expert
- Stakeholder

### Step 6. Risk Register

Identify risks with:

- risk description
- probability
- impact
- trigger signal
- mitigation plan
- fallback plan

### Step 7. Plan Review

Review whether the plan is:

- goal-clear
- measurable
- output-driven
- dependency-aware
- realistic in scope and sequencing
- clear in ownership
- risk-aware
- actionable

## Required Final Output Format

The final response must include exactly these top-level sections:

```markdown
# 1. Goal Contract

# 2. WBS Work Breakdown Structure

# 3. Dependency Mapping

# 4. Milestone Plan

# 5. RACI Responsibility Assignment

# 6. Risk Register
```

## Recommended Output Details

### 1. Goal Contract

Include:

```markdown
- Goal
- Success Criteria
- Scope In
- Scope Out
- Constraints
- Assumptions
```

### 2. WBS Work Breakdown Structure

Use a nested structure:

```markdown
## Deliverable 1: ...
### Work Package 1.1: ...
- Task:
  - Output:
  - Acceptance Criteria:
  - Dependencies:
  - Owner Role:
  - Priority:
```

### 3. Dependency Mapping

Use a table:

```markdown
| Task | Depends On | Dependency Type | Reason |
|---|---|---|---|
```

Also include:

```markdown
## Critical Path
...

## Parallelizable Tasks
...

## Blockers
...
```

### 4. Milestone Plan

Use a table:

```markdown
| Milestone | Included Tasks | Acceptance Criteria | Estimated Time |
|---|---|---|---|
```

If no calendar dates are provided, use relative time such as Day 1, Week 1, or Phase 1.

### 5. RACI Responsibility Assignment

Use a table:

```markdown
| Task / Deliverable | Responsible | Accountable | Consulted | Informed |
|---|---|---|---|---|
```

### 6. Risk Register

Use a table:

```markdown
| Risk | Probability | Impact | Trigger | Mitigation | Fallback |
|---|---|---|---|---|---|
```

## Quality Bar

A good plan must satisfy all of the following:

- The goal is clear.
- Success criteria are measurable.
- Scope boundaries are explicit.
- Every major deliverable is represented.
- Every task has a concrete output.
- Tasks are not vague.
- Dependencies are visible.
- Milestones have acceptance criteria.
- Time estimates are realistic or explicitly assumption-based.
- RACI ownership is clear.
- Risks include mitigation and fallback.
- The plan ends with exactly 3 next actions.

## Failure Modes to Avoid

Avoid these failures:

1. Creating only a simple checklist.
2. Skipping WBS and jumping directly to a task list.
3. Giving tasks without outputs.
4. Giving tasks without acceptance criteria.
5. Inventing precise dates without user-provided dates.
6. Assigning fake people when role placeholders would be better.
7. Ignoring risk.
8. Forgetting to perform plan review.
9. Doing implementation work.
10. Asking too many clarification questions.

## If Information Is Missing

MUST Ask Clarifying Questions, Ask at most 5 questions.

Use this when the missing information would materially change the plan.

## Implementation Boundary

This skill must never execute the plan.

Allowed:

- clarify requirements
- discuss solution details
- generate plan
- decompose tasks
- identify dependencies
- assign roles
- identify risks
- review plan

Not allowed:

- implement tasks
- write production code
- edit files
- call deployment tools
- complete user work
- mark planned tasks as actually done without evidence
