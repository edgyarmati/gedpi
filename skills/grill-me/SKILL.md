---
name: grill-me
description: Use before planning or implementing a non-trivial change when the request is not fully clear. Clarifies goals, desired behavior, constraints, edge cases, non-goals, tests, rollout, and success criteria by asking one concise question at a time with a recommended answer/default.
---

# grill-me

Use this skill after task classification for non-trivial work **only when the request is not already fully clear**. If the user's request is concrete enough to plan safely without guessing, skip grilling and proceed to the skill-fit checkpoint.

## Goal

Make sure the agent and user share the same understanding before planning or implementation.

## Rules

- Ask exactly one unresolved question per turn in chat.
- Include `Recommended answer:` or `Default assumption:` when you have a sensible default.
- If a question can be answered by reading the codebase or durable `.ged/` memory, inspect those sources instead of asking.
- Walk the decision tree in dependency order: goal, users, current behavior, desired behavior, constraints, edge cases, non-goals, tests, rollout, success criteria.
- Stop as soon as behavior, constraints, and success criteria are concrete enough to update active work `SPEC.md`, `TASKS.md`, and `TESTS.md` safely.
- Do not implement during grilling.

## After grilling

Proceed to the skill-fit checkpoint:

1. Inventory available bundled, project, and user skills.
2. Select relevant skills if coverage is sufficient.
3. Use `find-skills` if coverage is insufficient.
4. Use `skill-creator` to create a narrow project-local skill when no adequate external skill exists and the gap is reusable.
