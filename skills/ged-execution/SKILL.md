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

For non-trivial Ged tasks, planning should happen after classification, any needed `grill-me` clarification, and the skill-fit checkpoint. Inventory available bundled/project/user skills first. If coverage is insufficient, use `find-skills`; if no adequate external skill exists and the missing capability is reusable, create a narrow project-local skill. Do not install global/user skills automatically.
