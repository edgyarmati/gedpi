---
name: skill-creator
description: "Create a project-local skill when the skill-fit checkpoint finds no adequate existing skill. Use when find-skills returns nothing suitable, the task gap is reusable at the project level, and you need to capture domain knowledge, workflow patterns, or project-specific procedures as a SKILL.md. Triggers include \"create a skill\", \"new skill\", \"write a skill\", \"make a skill for\", \"capture this\", \"turn this into a skill\", \"project skill\", \"custom skill\""
---

# Skill Creator: Project-Local Skills for GedPi

Part of GedPi's skill-fit checkpoint. Use **after** `find-skills` returns nothing adequate and the missing capability is reusable enough to warrant a project-local skill.

With subagents enabled, `ged-explorer` may recommend creating a project-local skill during read-only skill-fit reconnaissance, but it must not write `.ged/project-skills/`, update `.ged/SKILLS.md`, or register dependencies. The main brain owns all project-skill creation and registration.

```
clarify → explorer read-only inventory/search (or main brain in solo mode) → main-agent skill creation decision → plan
```

## What Makes a Skill Worth Creating

A project-local skill is worth creating when:

- **Reusable pattern**: The same knowledge or procedure would help on multiple tasks in this project
- **Project-specific context**: The knowledge is specific to this codebase, domain, or team — not general-purpose
- **Non-obvious to the model**: The information isn't something a capable model would already know (API internals, project conventions, deployment quirks)

Don't create a skill for:
- A one-off task that won't recur
- General knowledge the model already has (standard library APIs, common design patterns)
- Something that's already covered by a bundled or user skill

## What GedPi Skills Look Like

A GedPi skill is just a directory with a `SKILL.md` file:

```
.ged/project-skills/<name>/
└── SKILL.md
```

Skills are scoped to the current project. They live in `.ged/project-skills/` and are tracked in `SKILLS-STATE.json`. When no open task depends on a project skill anymore, GedPi automatically cleans it up.

For reference, look at the bundled Ged skills in `skills/` — they follow the same structure:
- `skills/grill-me/SKILL.md` — concise, focused on one capability
- `skills/ged-planning/SKILL.md` — clear rules and output contract
- `skills/ged-execution/SKILL.md` — narrow scope, explicit goals

A skill directory can also include optional resources (`scripts/`, `references/`, `assets/`), but the default for project skills is **just SKILL.md**. Only add extras when the task genuinely needs them.

## The SKILL.md Structure

Every skill needs YAML frontmatter and markdown body:

```markdown
---
name: my-skill-name
description: "One or two sentences describing what the skill does and when to trigger it. Be specific about trigger phrases and use cases — this is the only thing the model sees before deciding to consult the skill. Triggers include \"phrase one\", \"phrase two\""
---

# Skill Title: Brief Description

## When to Use This Skill

Clear trigger conditions. When should a model reach for this skill vs. handling the task without it?

## Guidelines

- Concrete, actionable instructions
- Explain WHY things matter, not just WHAT to do
- Prefer concise examples over verbose explanations

## Output Format (if applicable)

What the skill produces and what it looks like.

## Reference

- `scripts/` — executable helpers for deterministic tasks
- `references/` — docs loaded into context as needed
- `assets/` — files for output (templates, icons)
```

### Writing the Description

The description field in the YAML frontmatter is the **triggering mechanism**. It's the only part always visible to the model. Make it specific:

```
Too vague: "Helps with React components"
Better: "React component patterns for this project's design system. Use when creating new UI components, converting designs to code, or fixing component bugs. Triggers include \"create component\", \"design system\", \"new page\""
```

### Writing the Body

Follow these principles:

- **Concise** — The model is already smart. Only add context it wouldn't already know. Challenge every paragraph: "does the model really need this explained?"
- **Explain the why** — Models have good theory of mind. When you explain why something matters, they can generalize beyond rote instructions. "Use PascalCase for component names" vs. "Use PascalCase for component names so Storybook auto-generates readable display names from the file path."
- **Prefer examples** — A concrete example is worth paragraphs of abstract description
- **Signal over ceremony** — If a section is straightforward, keep it short. Don't pad.

## Creation Process

### Step 1: Understand the Gap

Before writing anything, be clear about what the skill needs to cover. The task that triggered the skill-fit checkpoint already tells you most of this. Ask yourself:

- What specific domain knowledge does the model need?
- What workflow or procedure should it follow?
- What are the key decisions it needs to make?
- What should the output look like?

If the gap is unclear, ask the user one or two targeted questions. Don't spin — keep questions concrete.

### Step 2: Write the SKILL.md

Use the structure above. Write the YAML frontmatter first (name + description), then the body.

**Naming conventions:**
- Lowercase letters, digits, and hyphens only
- Short, verb-led phrases describing the action
- Namespace by tool where it improves clarity (e.g., `deploy-ecs`, `api-rate-limiting`)
- Keep names under 64 characters

**Reference existing skills** for tone and structure:
- `skills/grill-me/SKILL.md` — clean, minimal, one clear purpose
- `skills/ged-planning/SKILL.md` — explicit output contract
- `skills/ged-execution/SKILL.md` — narrow scope, no bloat

### Step 3: Place the Skill

Write the file to `.ged/project-skills/<name>/SKILL.md`. The directory must match the skill name:

```typescript
// Creates .ged/project-skills/<name>/SKILL.md
await writeFile(
  path.join(projectSkillsDir(rootDir), name, "SKILL.md"),
  content
);
```

### Step 4: Register the Skill

Update `.ged/SKILLS.md` to add the new skill under `## Installed`:

```markdown
- <name> [auto-install] - Project-local skill for <brief description>.
```

This ensures the skill is tracked and will be cleaned up when no longer needed.

### Step 5: Test and Iterate

Project-local skills are tested by using them — not through a separate eval harness:

1. **Use the skill** on the task that motivated its creation — does it help?
2. **Refine** based on what's missing, over-constrained, or confusing
3. **Repeat** until the skill guides the model effectively

Don't over-invest in testing. A project-local skill has one consumer (this project). Two or three rounds of refinement is usually enough. If the skill isn't working after a few iterations, the gap might not be skill-shaped — reconsider whether it's better handled as documentation or a script.

## When to Create vs. Not Create

| Situation | Action |
|---|---|
| Reusable project knowledge, no external skill exists | Create project-local skill |
| Reusable project knowledge, external skill exists | Use `find-skills` to install it |
| One-off task, won't recur | Handle directly, skip skill creation |
| General knowledge model already has | Don't create — just handle the task |
| Very narrow gap (< 10 lines of guidance) | Embed guidance in the task brief instead |
| Broad domain (e.g., "full-stack web dev") | Too big for a project skill — break into narrower skills or use ecosystem skills |

## Guiding Principles

- **Prefer ecosystem skills** — Only create project-local skills when `find-skills` turns up nothing adequate
- **Lean is better** — A focused 50-line skill beats a sprawling 500-line one every time
- **Project scope only** — Don't create global/user skills. Project-local skills are automatically cleaned up
- **Test by using** — No separate eval harness. Use the skill on real work and iterate
- **Delete when done** — Project skills are auto-cleaned. Don't fight the lifecycle — if a skill outlives its task, it shouldn't exist
