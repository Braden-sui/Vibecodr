# Research: Social Platforms Patterns → Vibecodr Feed

## Overview
A survey of social UX patterns from X/Twitter, TikTok, YouTube, Twitch, Discord, Reddit, and dev communities (DEV.to, Hashnode, Product Hunt). Goal: adapt the best mechanics for a runnable-app feed that rewards making and remixing.

## Key Patterns to Borrow
- Lightweight creation: one-tap post + inline editor; drafts autosave.
- Rich cards: poster, title, cover, badges, actions (like, comment, remix, share).
- Contextual actions: quote/remix instead of retweet to encourage lineage.
- Live state: “LIVE” badge floats posts; after, convert to VOD with chapters.
- Short loops: follows, likes, remixes surface to followers’ timelines.
- Safety affordances: report, hide, block, rate limits; sensitive content gates.

## Options We Can Choose
- Timeline model
  - Latest global; Following-only; “For you” (lightweight popularity + freshness).
  - Suggestion: MVP = Latest + Following. Add “For you” when we have signals.
- Post types
  - App, Report (MVP). Live as “Coming Soon” badge with waitlist CTA.
- Interaction primitives
  - Like, Comment, Remix (MVP). Quote later. Save/Bookmark optional.
- Discovery
  - Tags, simple search later, weekly featured “Vibe Pack”.
- Profiles
  - Minimal at MVP: avatar, handle, bio, counts (Runs, Remixes), latest posts.

## UX Recommendations
- Card layout: cover (or live canvas), title, author chip, badges (runner, net, params), quick actions (run, remix, share).
- Hover preview: preboot capsule and crossfade within 250–500ms budget.
- Player as modal/sheet: focus on app; right drawer for Notes/Remix/Chat.
- Remix-first CTA: “Fork to Studio” chip on card and inside Player.
- Stateful comments: optional timestamp/param-snapshot attachment to comments.

## Implementation Notes
- Preload manifests via IntersectionObserver in feed view.
- Keep card DOM minimal to maintain 60fps scroll; defer heavy work to Player.
- Use optimistic UI for likes/follows; reconcile server later.
- Rate-limit interactions to deter spam; soft quotas by plan.

## Sources
- X Cards overview: https://developer.x.com/en/docs/x-for-websites/cards/overview/abouts-cards
- Open Graph protocol: https://ogp.me/
- oEmbed spec: https://oembed.com/

