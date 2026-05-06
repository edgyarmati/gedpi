---
name: ged-planning
description: Produces or refines implementation plans in .ged/work/<work-id>/SPEC.md, task breakdowns in .ged/work/<work-id>/TASKS.md, and verification criteria in .ged/work/<work-id>/TESTS.md. Triggers include "plan", "break down", "what tasks", "how to implement", or when starting a new feature.
---

# Ged Planning

## Goals

- update `.ged/work/<work-id>/SPEC.md`
- decompose work into bounded slices in `.ged/work/<work-id>/TASKS.md`
- define verification criteria in `.ged/work/<work-id>/TESTS.md`
- recommend any missing skills that would help the planned work

## Rules

- tasks must stay small and concrete
- done criteria must be explicit
- only recommend skills when they materially help execution


## Ged skill-fit workflow

For non-trivial Ged tasks, planning should happen after classification, any needed `grill-me` clarification, and the skill-fit checkpoint. Inventory available bundled/project/user skills first. If coverage is insufficient, use `find-skills`; if no adequate external skill exists and the missing capability is reusable, create a narrow project-local skill. Do not install global/user skills automatically.
