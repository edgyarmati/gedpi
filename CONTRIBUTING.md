# Contributing to GedPi

Thanks for your interest in contributing.

## Getting Started

1. Fork the repository on GitHub.
2. Clone your fork locally:

   ```bash
   git clone https://github.com/<your-username>/GedPi.git
   cd GedPi
   npm install
   ```

3. Run the package locally inside Pi:

   ```bash
   npm run chat
   ```

## Development Commands

| Command | Purpose |
|---------|---------|
| `npm run chat` | Launch the local `gedpi` executable from this checkout |
| `npm test` | Run the test suite with Vitest |
| `npm run check` | Run the TypeScript type-check |
| `npm run lint` | Run Biome lint and format checks |
| `npm run format` | Auto-fix lint and formatting issues |
| `npm pack` | Build the npm tarball |
| `npm publish --dry-run` | Validate the publish artifact without uploading |

## Code Standards

- Use ES modules only. `import.meta.url` is the preferred path pattern, and CommonJS is not used in `src/` or `extensions/`.
- Keep TypeScript strict. `npm run check` must pass before submitting changes.
- Keep Biome clean. Run `npm run lint` and `npm run format` when needed.
- Prefer small, focused files and avoid unnecessary mutation.
- Keep the public product language aligned with the current single-brain workflow.

## Testing

- Tests live in `tests/` and use Vitest.
- Run `npm test` before opening a pull request.
- Add tests for new behavior when practical.

## Commit Messages

Use conventional commit formatting:

```text
<type>: <description>
```

Common types include `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, and `ci`.

## Pull Request Process

1. Create a feature branch from `main`.
2. Make your changes.
3. Ensure the checks pass:

   ```bash
   npm run check
   npm run lint
   npm test
   ```

4. If packaging changed, also run:

   ```bash
   npm pack
   npm publish --dry-run
   ```

5. Open a pull request with a clear description of what changed and why.

## Testing Installs

Test the global install flow:

```bash
npm install -g .
ged
```

Test the packed tarball flow:

```bash
npm pack
npm install -g ./gedpi-<version>.tgz
ged
```

## Questions

If something is unclear, open an issue on [GitHub](https://github.com/EdGy2k/GedPi/issues).
