# API reference

An API reference is looked up, not read. The reader already knows what they want to do; they need one exact answer: the name, the signature, the parameters, the result, and the failure modes.

## Structure

Organise by the unit the reader looks up, and give every entry the same shape:

- **Name and one-line purpose.**
- **Signature** — the exact type or argument list.
- **Parameters** — a table: name, type, required, default, meaning.
- **Returns** — the type, and what each field means.
- **Errors** — every error or failure mode, with the condition that causes it and what to do.
- **Example** — one short, complete use.
- **Notes** — limits, side effects, version notes, deprecations.

## Rules

- Consistency beats prose. Every entry uses the same headings in the same order; the reader navigates by shape, not by reading.
- Completeness beats polish. Every parameter, field, and error appears, even the boring ones. Do not hide a parameter in an example.
- Document defaults and required-ness explicitly. "Optional" without a default is ambiguous.
- Document error semantics: what raises, what returns empty, what retries.
- Mark deprecations with the replacement and the version that removes the old form.
- State the version the docs describe, and keep it aligned with the released version.
- Where the docs are generated from source (docstrings, OpenAPI, schema), do not hand-write a second copy. Fix the source, or link to the generated output.
- Write examples that run against the documented version.

## Related skills

The `dev-code-documenter` skill covers docstrings, OpenAPI and JSDoc specs, and documentation portals.
