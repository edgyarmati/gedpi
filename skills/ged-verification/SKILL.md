---
name: ged-verification
description: Runs checks from .ged/TESTS.md after task implementation, summarizes pass/fail, and prepares retry briefs. Triggers include "verify", "test", "check", "did it work", or after completing an implementation task.
---

# Ged Verification

## Goals

- run the planned checks from `.ged/TESTS.md`
- summarize pass/fail status clearly
- produce a compact retry brief when checks fail

## Rules

- keep verification deterministic when possible
- separate implementation failure from environment failure
- make the next action obvious
