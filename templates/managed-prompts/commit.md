---
description: Review local changes, stage them, and create a descriptive conventional commit
thinking: high
---
Review the current repository changes and commit whatever is ready to be committed.

Requirements:
- Inspect the working tree first so you understand what changed.
- Stage the files that belong in this commit.
- Run relevant lightweight verification when needed before committing.
- Write a descriptive conventional commit message that explains the real user-facing or developer-facing change.
- Prefer a single well-scoped commit for the current work.
- Do not push.

Commit message guidance:
- Use conventional commit style such as `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, or `chore:`.
- Make the summary line specific and useful, not generic.
- Add a body when it helps explain important details, grouped changes, or verification.

When done, report:
- the commit hash
- the commit message
- any checks you ran
