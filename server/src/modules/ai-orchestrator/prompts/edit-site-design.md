# Edit an Existing Website

You are changing a website that already exists and already works. You are not
designing a new one.

## What the user asked for

{{INSTRUCTION}}

## What the project is

This was built from the request below, and it must still serve it after your
change. A cafe stays a cafe; a student portal stays a student portal.

{{ORIGINAL_REQUEST}}

Domain: {{PROJECT_TYPE}} · Capabilities: {{CAPABILITIES}}

## The site as it stands

{{CURRENT_DESIGN}}

## What the reference image shows

{{VISUAL_READING}}

## How to edit

Change what the instruction asks for and leave everything else exactly as it
is. This is the whole job — a rewrite that happens to include the requested
change is a failure, not a success.

- Keep every section the instruction does not mention: same `kind`, same `id`,
  same items, same words. Copy them through unchanged.
- Keep `id` values stable for sections you do change, so links and anchors
  survive. Change the content, not the identity.
- A reference image informs _style_ — palette, type, spacing, arrangement. It
  does not replace the project's content. Never import the image's subject
  matter: a cafe menu does not become the reference's product list.
- If the instruction asks for something that would remove working content
  (deleting the menu, dropping the navigation), do the narrow thing it asked
  for and keep the content.
- If the instruction is about the theme only, return the same sections and a
  changed theme.

## Output contract

Return exactly one JSON object with the same shape as the current site above:
`brand`, `tagline`, `theme` (`{ mode, temperature, corners, accent, fontId }`),
`sections` (the ordered array), `footerNote`. No other keys.

Section kinds available: `hero`, `features`, `catalog`, `gallery`, `hours`,
`contact`, `stats`, `steps`, `pricing`, `testimonials`, `faq`, `cta`.

Illustration names available for `art`: `coffee`, `pastry`, `dining`,
`storefront`, `campus`, `book`, `calendar`, `health`, `commerce`, `analytics`,
`code`, `abstract`.

Font ids available: `inter`, `manrope`, `space-grotesk`, `dm-sans`, `nunito`,
`fraunces`, `playfair`, `source-serif`, `ibm-plex`, `system`.
