# AGENTS.md

- Keep lint clean; run `npm run lint` after refactors and apply `npm run lint:fix` when safe.
- Prefer shared helpers to reduce duplication (e.g., LLM response parsing, stash paths, classification normalization).
- When updating classification behavior, also update tests and README tool docs.
- Use conventional commits; keep subject <= 50 chars and wrap body at ~72 chars.
- For new tools, add README entries describing parameters and return shape.
