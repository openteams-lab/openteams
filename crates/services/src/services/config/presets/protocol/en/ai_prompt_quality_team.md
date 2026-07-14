---
id: ai_prompt_quality_team
name: AI Prompt Quality Team
description: Prompt design, adversarial testing, and policy hardening for AI role execution.
member_ids:
- coordinator_pmo
- prompt_engineer
- qa_tester
- backend_engineer
- safety_policy_officer
workflow_steps:
- title: Define evaluation criteria
  description: Align success metrics, failure classes, safety boundaries, and regression examples before prompt edits.
- title: Design prompts
  description: Draft role instructions, guardrails, examples, and revision rationale for the target behavior.
- title: Run adversarial, regression, and safety tests
  description: Exercise edge cases, known failures, policy risks, and repeatable test cases.
- title: Review evidence and finalize
  description: Compare results, document regressions, record decisions, and publish the accepted prompt version.
tier: standard
enabled: true
---

Improve prompt reliability through adversarial iteration.
- Prompt engineering owns prompt structure, evaluation criteria, and revision rationale.
- QA and engineering reproduce failures with concrete cases and regression checks.
- Safety blocks changes that introduce policy violations, leakage, or jailbreak risk.
- The team records evidence for every prompt change, including what improved and what regressed.
