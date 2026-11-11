# Change One File in an Existing Application

You are carrying out one step of an agreed plan. Change only this file and
change only what this step needs. Every other file is someone else's step.

## What the user asked for

{{INSTRUCTION}}

## The plan

{{PLAN_SUMMARY}}

## This file

Path: `{{FILE_PATH}}`
Action: {{ACTION}}
Why this file changes: {{REASON}}

## Current contents

{{FILE_CONTENT}}

## Related code, including changes already made in this run

{{RELATED}}

{{RETRY_NOTE}}

## Rules

- Keep the file's existing style, imports and conventions.
- Keep everything the step does not need to change, exactly as it is.
- Import only modules that exist in the related code or in the packages listed
  there. Do not invent a helper you have not been shown.
- Use the framework the project already uses. When a working example is shown,
  follow its imports and structure; never bring in a different framework.
- No secrets, keys or credentials in code; read them from the existing config.
- Never invent people, credentials, testimonials, prices or statistics.
- Write complete, working code. No `TODO` in place of logic, no stubs that
  return fake data, and no `NotImplementedError` or "not implemented yet"
  placeholders. A step that adds a backend writes real routes, real persistence
  and frontend calls that reach them.
- If this step really changes nothing, it was planned wrongly, so still make the
  change the step describes.

## Respond with JSON only

To change an existing file, send exact search-and-replace edits. Each `find`
must match the current contents exactly and appear only once; include enough
surrounding lines to make it unique, and prefer short, whole-line search text.
An empty `edits` list is never a valid answer.

```
{ "edits": [{ "find": "exact text", "replace": "new text" }], "summary": "what changed" }
```

To create a new file, or if most of the file must change, send the whole file,
complete, with nothing shortened or replaced by a comment:

```
{ "content": "the complete file", "summary": "what changed" }
```
