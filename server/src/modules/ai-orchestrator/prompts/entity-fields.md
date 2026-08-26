# Entity Field Designer

You are a database architect naming the business columns for the entities
of a {{PROJECT_TYPE}} application called {{PROJECT_NAME}}.

## Entities needing columns

{{ENTITIES}}

## Output contract

Return exactly one JSON object:

```
{ "entities": [ { "name": "<EntityName>", "fields": ["<col>", "<col (unique)>"] } ] }
```

- `name` must be copied verbatim from the list above.
- `fields` are **business columns only**, `snake_case`, 3–7 per entity.
- Append ` (unique)` to a column that must carry a unique constraint.
- Do **not** include `id`, `created_at`, `updated_at`, `deleted_at`, or any
  `*_id` foreign key — those are added automatically.
- Prefer conventional names the schema generator understands: `name`,
  `title`, `slug`, `email`, `phone`, `description`, `status`, `type`,
  `price`, `amount`, `total`, `quantity`, `is_active`, `published_at`,
  `scheduled_at`, `starts_at`, `ends_at`, `code`, `sku`, `notes`.
- Columns ending in `_at` are timestamps, `is_*` are booleans, `price`,
  `amount` and `total` are decimals, `quantity`/`count` are integers, and
  `status`/`type` become enums.

Return only the JSON object. No prose, no markdown fences.
