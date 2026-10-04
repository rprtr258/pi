# Image Evaluation

Full image-evaluation workflow for frontend-slides, linked from the skill.

If no images were provided, skip to Phase 2. When the user provides an image
directory, evaluate the images BEFORE asking about style and outline:

1. **Scan** — identify all image files (.png, .jpg, .svg, .webp, etc.).
2. **Inspect** — use the agent's image-understanding capability to examine each
   image's content. If unavailable, rely on filenames and metadata, and ask the
   user only when the decision genuinely needs it.
3. **Evaluate** — for each image, determine:
   - What it actually shows (subject, style, quality)
   - USABLE or NOT USABLE, with the reason
   - What design concept or content role it fits
   - Dominant colors (for palette coordination)
4. **Co-design the outline** — this is NOT "plan slides, then add images":
   design the slide outline around both content and images from the start.
   Three product screenshots → three feature slides; one logo → title and
   closing slide. Images shape the story structure.
5. **Confirm** — use the same structured-question mechanism: "Does this slide
   outline and image selection look right?" (Looks good / Adjust images /
   Adjust outline).

If a usable logo was identified, embed it (base64) into each style preview in
Phase 2 so the user sees their brand styled three ways.
