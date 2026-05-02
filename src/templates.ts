import { GED_DIR } from "./contracts.js";

export interface StarterFile {
  path: string;
  content: string;
}

export const starterFiles: StarterFile[] = [
  {
    path: `${GED_DIR}/VERSION`,
    content: `1
`,
  },
  {
    path: `${GED_DIR}/PROJECT.md`,
    content: `# Project

## Goal

Describe what this project should achieve.

## Users

- Primary users:
- Secondary users:

## Constraints

- Technical constraints:
- Product constraints:

## Success Criteria

- What does success look like?
`,
  },
  {
    path: `${GED_DIR}/IDEAS.md`,
    content: `# Ideas

## Active ideas

-

## Future ideas

-

## Parking lot

-
`,
  },
  {
    path: `${GED_DIR}/DECISIONS.md`,
    content: `# Decisions

Record important choices here as the project evolves.

## Entries

- Date: YYYY-MM-DD
  - Decision:
  - Why:
  - Impact:
`,
  },
  {
    path: `${GED_DIR}/STANDARDS.md`,
    content: `# Imported Standards

These standards were imported from other harness-specific instruction files and approved for Ged use.

No imported standards have been accepted yet.
`,
  },
  {
    path: `${GED_DIR}/STATE.md`,
    content: `# State

Current Phase: Understand
Active Task: None
Status Summary: Project initialized. Ready to interview the user and capture exact requirements.
Blockers: None
Next Step: Interview the user, write the exact spec into .ged/, then implement the first bounded slice.
`,
  },
  {
    path: `${GED_DIR}/SKILLS.md`,
    content: `# Skills

## Installed

- None yet

## Recommended

- None yet

## Deferred

- None yet

## Rejected

- None yet

## Usage Notes

- Record why a skill was installed, recommended, or skipped.
`,
  },
  {
    path: `${GED_DIR}/project-skills/README.md`,
    content: `# Project Skills

Store project-scoped skills that Ged auto-installs or creates for active tasks here.
`,
  },
  {
    path: `${GED_DIR}/SKILLS-STATE.json`,
    content: `{
  "managed": []
}
`,
  },
  {
    path: `${GED_DIR}/SPEC.md`,
    content: `# Spec

## Problem

## Solution shape

## Key workflows

## Risks

## Open questions
`,
  },
  {
    path: `${GED_DIR}/TASKS.md`,
    content: `# Tasks

## Task slices

| ID | Title | Depends On | Status | Done Criteria |
| --- | --- | --- | --- | --- |
`,
  },
  {
    path: `${GED_DIR}/TESTS.md`,
    content: `# Tests

## Project-wide checks

-

## Task-specific checks

-

## Retry policy

- Implementation retries before the plan must be tightened: 2

## Recovery rule

- If the same slice fails repeatedly, rewrite the slice, clarify the spec, and retry with a narrower plan.
`,
  },
  {
    path: `${GED_DIR}/SESSION-SUMMARY.md`,
    content: `# Session Summary

## Current understanding

-

## Recent progress

-

## Next handoff notes

-
`,
  },
  {
    path: `${GED_DIR}/PROGRESS.md`,
    content: `# Progress

Ongoing log of project progress.

`,
  },
  {
    path: `${GED_DIR}/plans/INDEX.md`,
    content: `# Plan Index

| ID | Title | Status | Created | Completed |
| --- | --- | --- | --- | --- |
`,
  },
  {
    path: `${GED_DIR}/research/README.md`,
    content: `# Research

Store external research summaries and package notes here.
`,
  },
  {
    path: `${GED_DIR}/specs/README.md`,
    content: `# Specs

Store versioned detailed specs here.
`,
  },
  {
    path: `${GED_DIR}/tasks/README.md`,
    content: `# Task Artifacts

Store per-task briefs, outputs, and failure histories here.
`,
  },
  {
    path: `.pi/agents/ged-brain.md`,
    content: `---
name: ged-brain
description: GedPi brain for user-facing interviewing, planning, and implementation
model: anthropic/claude-opus-4-6
tools: read, grep, find, ls, bash
skill: ged-planning, ged-execution, ged-verification
---

You are GedPi's only user-facing agent.

Interview the user until the requested behavior, constraints, and success criteria are concrete enough to implement safely.
Write the evolving project intent into .ged/PROJECT.md and .ged/SPEC.md.
Break the work into bounded slices in .ged/TASKS.md before editing code.
Run the planned checks, record outcomes in .ged/STATE.md and .ged/SESSION-SUMMARY.md, and tighten the plan if a slice fails.
`,
  },
];
