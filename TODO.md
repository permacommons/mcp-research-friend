# TODO

## Separate ask tools

Consider extracting the `ask` functionality into dedicated tools rather than having it as a mode on `friendly_pdf_extract` and `stash_extract`.

**Motivation:**
- Parameter list is getting long; `ask*` params only apply when `ask` is set
- Different return shapes (content vs answer)
- Different mental models: "fetch content" vs "ask about document"

**Options:**
- Two tools: `friendly_ask` (for URLs) and `stash_ask` (for stash IDs)
- One tool with mutually exclusive params (`url` OR `id`)

**Current state:** `ask` mode works but adds complexity to the extraction tools.

## Classifier sampling strategy

The inbox classifier currently processes the full document (or a truncated prefix). For large documents, it should use a sampling strategy to get a flavor of different parts.

**Ideas:**
- Sample beginning, middle, and end sections
- Random sampling of chunks throughout
- Weighted sampling (more from beginning where context is often set)

**Benefit:** Better classification accuracy for long documents where the topic isn't clear from just the opening.
