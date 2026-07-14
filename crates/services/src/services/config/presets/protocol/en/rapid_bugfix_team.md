---
id: rapid_bugfix_team
name: Rapid Bugfix Team
description: Fast incident response across implementation, testing, and review.
member_ids:
- coordinator_pmo
- backend_engineer
- frontend_engineer
- qa_tester
- code_reviewer
workflow_steps:
- title: Triage and reproduce
  description: Set severity, owner, affected scope, reproduction steps, and recovery target.
- title: Root cause and minimal fix
  description: Identify the cause and implement the smallest safe change for the affected path.
- title: Regression verification and review
  description: Verify the repro, fix, critical regressions, and code review requirements.
- title: Close and prevent recurrence
  description: Document outcome, root cause, safeguards, follow-up tasks, and remaining risks.
tier: standard
enabled: true
---

Resolve incidents fast without losing control.
- The coordinator sets severity, owner, repro status, and target recovery time.
- Engineers produce the smallest safe fix and state the affected scope and blast radius.
- QA verifies the repro, the fix, and the critical regression path before closure.
- Review documents root cause, follow-up tasks, and any safeguards needed to prevent recurrence.
