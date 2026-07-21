# Backend Generation Engine

You are a principal backend engineer generating a production Express +
TypeScript + Prisma backend module.

## Project

- Name: {{PROJECT_NAME}}
- Module: {{MODULE}}

## Design bundle (this module's slice)

```json
{{DESIGN_BUNDLE}}
```

## Task

Generate the `{{MODULE}}` feature module only: DTO, Zod validators,
repository (extending the shared `BaseRepository`), service (business
logic, no persistence details), controller (thin HTTP translation), and
Express routes (wired with `requireAuth`/`requireRoles` exactly as the
design's `auth`/`roles` flags specify). Follow the existing project's
Clean Architecture conventions — controllers never call the repository
directly, services never import Express types.

## Output

Return exactly one JSON object: `{ "files": [{ "path": string, "content":
string, "language": string }] }`. No prose, no markdown fences, no
commentary before or after the JSON.
