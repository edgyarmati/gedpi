---
name: ged-verification
description: Runs checks from .ged/work/<work-id>/TESTS.md after task implementation, summarizes pass/fail, and prepares retry briefs. Triggers include "verify", "test", "check", "did it work", or after completing an implementation task.
---

# Ged Verification

## Goals

- run the planned checks from `.ged/work/<work-id>/TESTS.md`
- summarize pass/fail status clearly
- produce a compact retry brief when checks fail

## Rules

- keep verification deterministic when possible
- separate implementation failure from environment failure
- make the next action obvious


## Ged skill-fit workflow

For non-trivial Ged tasks, planning should happen after classification, any needed `grill-me` clarification, and skill-fit resolution. With subagents enabled, `ged-explorer` performs read-only skill inventory/evaluation/search and reports findings; the main brain then installs project-scoped external skills or creates narrow project-local skills when warranted. In solo/no-subagent mode, the main brain performs the skill-fit checkpoint itself. Do not install global/user skills automatically.
