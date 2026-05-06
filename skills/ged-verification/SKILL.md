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

For non-trivial Ged tasks, planning should happen after classification, any needed `grill-me` clarification, and the skill-fit checkpoint. Inventory available bundled/project/user skills first. If coverage is insufficient, use `find-skills`; if no adequate external skill exists and the missing capability is reusable, create a narrow project-local skill. Do not install global/user skills automatically.
