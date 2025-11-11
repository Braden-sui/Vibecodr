# apps/web – UI Skeleton

Surfaces implemented as placeholder routes with inline TODOs:

- / (Feed): cards, hover previews, actions
- /player/[postId]: sandboxed runner, params drawer, logs, remix
- /studio (Import, Params, Files, Publish): import/build pipeline UI
- /post/[id]: app/report display
- /report/new: report composer with snapshots
- /profile/[handle]: profile + posts
- /settings: plan usage and upgrades
- /admin/moderation: moderation queue

Implementation checklist:
- Data fetching: wire to workers/api endpoints
- Styling: Tailwind + shadcn (tokens, components)
- Auth: Clerk/Lucia (GitHub + Google)
- Analytics: PostHog events for Player interactions
- Accessibility: focus traps in Player, keyboard navigation

