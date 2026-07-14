---
id: architecture_governance_team
name: Architecture Governance Team
description: Architecture review, implementation feasibility, security, and operational readiness.
member_ids:
- system_architect
- backend_engineer
- frontend_engineer
- code_reviewer
- devops_engineer
- safety_policy_officer
workflow_steps:
- title: Clarify constraints
  description: Capture goals, non-goals, dependencies, compliance limits, and operational constraints.
- title: Propose architecture options
  description: Describe target states, alternatives, interfaces, and the reasoning behind each option.
- title: Evaluate implementation, migration, safety, and operations
  description: Assess cost, rollout risk, maintainability, deployability, and security impact.
- title: Decide and set launch conditions
  description: Record the accepted direction, rejected alternatives, prerequisites, owners, and readiness checks.
tier: standard
enabled: true
---

Drive architecture decisions with explicit tradeoffs.
- The system architect owns the target-state proposal, constraints, and decision log.
- Engineers surface implementation cost, migration risk, and operational complexity early.
- Review, DevOps, and safety evaluate maintainability, deployability, and security impact before approval.
- Every decision ends with approved direction, rejected alternatives, and rollout prerequisites.
