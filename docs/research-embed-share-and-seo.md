# Research: Embeds, Sharing, and SEO → Virality

## Overview
How capsules should unfurl across platforms and embed on external sites to drive discovery and runs.

## Unfurl Standards
- Open Graph (og:title, og:description, og:image, og:url) for rich link previews.
- X/Twitter Cards (summary_large_image) for social shares.
- oEmbed endpoint to let blogs/CMSes embed a playable capsule or a poster linking to Player.

## Vibecodr Embed Options
- One-line embed script
  - <script src="https://vibe.codr/embed.js" data-capsule="..." data-preset="..."></script>
  - Auto-resize, dark/light theme, param presets via data-attrs.
- Static iframe
  - <iframe src="https://vibe.codr/e/{id}" sandbox="..." allow="..." />
  - Recommended for CMSes without JS.
- Share cards
  - Server-side generated PNG with title/author/counters; cached per capsule.

## UX Recommendations
- “Share” button in Player: Copy link, Copy embed, Post to X, Copy snapshot.
- Always show net/storage/runtime badges on the share sheet.
- Provide “Snapshot” links that freeze param state for specific moments.

## Implementation Notes
- oEmbed: JSON endpoint returns HTML (iframe), width/height, thumbnail_url.
- OG images: server-render via headless renderer; include branded frame.
- Embed script: postMessage handshake, resize observer, feature-detection for theme.
- Security: sandbox/allow lists; no top-navigation; no storage unless enabled.

## Sources
- Open Graph: https://ogp.me/
- X/Twitter Cards: https://developer.x.com/en/docs/x-for-websites/cards/overview/abouts-cards
- oEmbed: https://oembed.com/

