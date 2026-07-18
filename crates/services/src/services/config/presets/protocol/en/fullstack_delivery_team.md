---
id: fullstack_delivery_team
name: Full-stack Delivery Team
description: Planner-led web delivery across design, frontend, backend, QA, and review.
member_ids:
- coordinator_pmo
- backend_engineer
- frontend_engineer
- qa_tester
workflow_steps:
- title: Requirements and planning
  description: Clarify scope, acceptance criteria, owners, dependencies, and delivery order.
- title: Experience and technical design
  description: Shape user flows, interface contracts, data changes, and implementation risks.
- title: Frontend and backend implementation
  description: Build the agreed slices, keep interfaces aligned, and save deliverables in workspaces.
- title: Quality verification and code review
  description: Verify behavior, regressions, accessibility, performance, and maintainability.
- title: Delivery summary
  description: Report shipped changes, verification results, risks, and recommended follow-up work.
tier: standard
enabled: true
---

# Team Protocol
Purpose: define collaboration rules for the team, unify communication protocols across members, and preserve efficient shorthand for faster teamwork.

## Team Rules (Must Follow)
- The plan file is located at `.openteams/plan.md`. All members may read it, but only the Planner may edit it.
- When assigning tasks, the Planner must assign each task to a specific member. After completion, the member must notify the Planner, who then updates the task status.
- All results must be saved as files in each member's workspace. Do not send long text or code in the group chat.
- Messages in the group should contain only key information, stay brief, and preferably remain under 500 characters.
