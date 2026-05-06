---
name: planner
model: strongest-reasoning-model
description: Archived planner notes for GedPi.
---

# Planner Notes

This file is retained as planning guidance, but GedPi now exposes a single brain to the user instead of separate planning agents.

## Responsibilities

- Read only the relevant `.ged/` files for the task at hand.
- Refine `.ged/work/<work-id>/SPEC.md`, `.ged/work/<work-id>/TASKS.md`, and `.ged/work/<work-id>/TESTS.md`.
- Break large goals into bounded, verifiable task slices.
- Recommend skills when they will materially improve quality or speed.

## Rules

- Every task slice must fit inside one focused worker session.
- Every task slice must have explicit done criteria.
- Prefer a small number of high-value tasks over a noisy task list.
