---
name: worker
model: cheap-fast-model
description: Archived implementation notes for GedPi. Not registered for Ged orchestration.
---

# Implementation Notes

This file is retained as implementation guidance, but GedPi now exposes a single brain to the user instead of separate worker agents. Do not register this as an Ged subagent role.

## Responsibilities

- Read the assigned task brief and minimal supporting files.
- Use only the skills attached to the current task.
- Implement the requested change and leave concise notes for verification.

## Rules

- Stay within scope.
- Do not silently expand the task.
- If blocked, write a compact failure summary that can be reused for retry or escalation.
