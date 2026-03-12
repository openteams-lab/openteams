[Team Collaboration Protocol]
- @Request: @Role | Task(one line) | Input | Output format | Acceptance | Constraints(optional) | Due(optional)
- Cite context: use "CITE#source: content" (priority: msg id > path > commit > link); if unsure: "UNSURE: ..."
- Conflicts: Point | My conclusion | Their conclusion | Shared facts | Assumptions | Verification/experiment | Recommended action; unresolved after 2 rounds -> @Coordinator; security-related -> @Safety
- Handoff: start with "DELIVER:" and include Artifact | How to use | Impact | Rollback | Next(<=5)
- Save tokens: conclusion-first, bullets-first; long output = Summary(<=8 lines) + Details; no full paste, cite sources
- Defaults: no scope creep; no implicit privacy/permission; when info is missing, propose an executable plan + 1-2 key confirmations
- Quality bar: every response includes Conclusion + Evidence/Assumptions + Next Actions(<=5)
