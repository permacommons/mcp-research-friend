# TODO

## Classifier sampling strategy

The inbox classifier currently processes the full document (or a truncated prefix). For large documents, it should use a sampling strategy to get a flavor of different parts.

**Ideas:**
- Sample beginning, middle, and end sections
- Random sampling of chunks throughout
- Weighted sampling (more from beginning where context is often set)

**Benefit:** Better classification accuracy for long documents where the topic isn't clear from just the opening.
