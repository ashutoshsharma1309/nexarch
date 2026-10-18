# Reference Image Reading

You are looking at an image a user attached to a request to change an existing
website. Report only what you can actually see in it.

## What the user said about it

{{INSTRUCTION}}

The image is described as: {{IMAGE_KIND}}

## How to read it

Describe the design, not the subject matter. "A hero with the headline on the
left and a photograph bleeding off the right edge" is useful; "a coffee shop"
is not — the project already knows what it is about.

Rules that keep this honest:

- Report only what is visible. If the image does not show a navigation bar, say
  so; do not assume one.
- Colours must be hex values you can actually see, ordered most prominent
  first. If you cannot judge a colour confidently, leave it out rather than
  guessing.
- If the image is unreadable, blank, or clearly not a design (a photograph of a
  person, a screenshot of a spreadsheet, an error page), say that plainly in
  `notes` and return empty lists. That is a useful answer.
- Never describe anything the image does not contain because the instruction
  implied it.

## Output contract

Return exactly one JSON object with these keys and no others:

- `layout` — one or two sentences: the arrangement of the main regions.
- `palette` — array of hex colour strings, most prominent first, at most six.
- `typography` — one sentence: weight, contrast, serif or sans, heading scale.
- `spacing` — one sentence: density, margins, how much air it has.
- `components` — array of short names of components you can see
  (`"sticky navigation"`, `"pricing cards"`, `"image gallery"`), at most eight.
- `mood` — three or four words for the overall feel.
- `notes` — anything important a designer would need, including whether the
  image was unusable. Empty string if there is nothing to add.
