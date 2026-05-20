---
name: ged-execution
description: Implements the next task from .ged/work/<work-id>/TASKS.md with narrow scope and concise handoff notes. Triggers include "do the next task", "implement", "execute", or when a task is ready for implementation.
---

# Ged Execution

## Goals

- read the next task brief
- complete the requested change with minimal context
- record concise implementation notes for verification and handoff

## Rules

- stay narrowly scoped
- do not rewrite the plan during execution
- leave reusable failure notes if the task cannot be completed


## Ged skill-fit workflow

For non-trivial Ged tasks, planning should happen after classification, any needed `grill-me` clarification, and skill-fit resolution. With subagents enabled, `ged-explorer` performs read-only skill inventory/evaluation/search and reports findings; the main brain then installs project-scoped external skills or creates narrow project-local skills when warranted. In solo/no-subagent mode, the main brain performs the skill-fit checkpoint itself. Do not install global/user skills automatically.
