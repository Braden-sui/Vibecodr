# Vibecodr – Runnable Feed for Vibecoders

**Twitter/X for people who don't code** – A social platform where non-coders can share interactive micro-apps ("capsules"), get inspired, and test community creations.

## 🏗️ Architecture

- **Frontend**: Next.js 14 (App Router) with TailwindCSS + shadcn/ui
- **API**: Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite) with Drizzle ORM
- **Storage**: Cloudflare R2 for capsule bundles and assets
- **Auth**: Clerk (GitHub + Google OAuth)
- **Analytics**: PostHog + Workers Analytics Engine
- **Monorepo**: Turborepo with npm workspaces

## 📁 Project Structure

```
vibecodr/
├── apps/
│   └── web/              # Next.js frontend
├── workers/
│   └── api/              # Cloudflare Workers API
├── packages/             # Shared packages (future)
├── docs/                 # Planning and research docs
└── turbo.json           # Turborepo config
```

## 🚀 Local Development

### Prerequisites

- Node.js 20+
- npm 10+
- Cloudflare account (for D1 and R2)
- Clerk account (for auth)

### Setup

1. **Clone and install dependencies:**
   ```bash
   git clone <your-repo-url>
   cd Vibecodr
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   # Copy example env files
   cp .env.example .env.local
   cp apps/web/.env.example apps/web/.env.local

   # Fill in your actual keys in .env.local files
   ```

3. **Setup Cloudflare D1 database:**
   ```bash
   cd workers/api

   # Create D1 database
   npx wrangler d1 create vibecodr-d1

   # Copy the database ID and update wrangler.toml
   # Then run migrations
   npx wrangler d1 execute vibecodr-d1 --file=./src/schema.sql
   ```

4. **Setup Cloudflare R2 bucket:**
   ```bash
   # Create R2 bucket
   npx wrangler r2 bucket create vibecodr-assets
   ```

5. **Setup Husky git hooks:**
   ```bash
   npm run prepare
   ```

### Running Locally

```bash
# Run all services in dev mode
npm run dev

# Or run individually:
cd apps/web && npm run dev          # Frontend on http://localhost:3000
cd workers/api && npm run dev       # API on http://localhost:8787
```

### Other Commands

```bash
npm run build          # Build all packages
npm run lint           # Lint all packages
npm run typecheck      # Type check all packages
npm run format         # Format code with Prettier
```

## 📦 Deployment

### Cloudflare Pages (Frontend)

1. **Connect repository to Cloudflare Pages:**
   - Go to Cloudflare Dashboard → Pages
   - Create new project from Git
   - Build settings:
     - Build command: `npm run build --filter=vibecodr-web`
     - Build output directory: `apps/web/.next`
     - Root directory: `/`

2. **Set environment variables in Cloudflare Pages:**
   - Add all variables from `apps/web/.env.example`

### Cloudflare Workers (API)

```bash
cd workers/api

# Deploy to production
npm run deploy

# Deploy to preview
npm run deploy -- --env preview
```

### Database Migrations

```bash
cd workers/api

# Run migrations on production
npx wrangler d1 execute vibecodr-d1 --file=./src/schema.sql --remote

# Or use Drizzle migrations (once set up)
npm run db:push
```

## 🎯 MVP Roadmap

See [docs/checklist.mdx](./docs/checklist.mdx) for the full implementation checklist.

### Phase 1 (Foundation) ✅
- [x] Monorepo with Turborepo
- [x] Next.js with TailwindCSS + shadcn/ui
- [x] TypeScript strict mode
- [x] ESLint + Prettier
- [x] Git hooks
- [ ] Drizzle ORM setup
- [ ] Clerk authentication
- [ ] Basic Feed components
- [ ] Player shell

### Phase 2 (Capsules & Studio)
- [ ] Manifest schema + validator
- [ ] Client-static runner
- [ ] Studio import pipeline
- [ ] Publish flow

### Phase 3 (Social Layer)
- [ ] Feed sorting & profiles
- [ ] Comments & notifications
- [ ] Remix graph

### Phase 4 (Safety & Polish)
- [ ] Network proxy
- [ ] Moderation queue
- [ ] Quotas & plans
- [ ] Share cards & embeds

## 📚 Documentation

- [MVP Plan](./docs/mvp-plan.md)
- [Implementation Checklist](./docs/checklist.mdx)
- [Research Docs](./docs/)

## 🤝 Contributing

This is currently in MVP development. Contributions welcome once we reach public beta.

## 📄 License

[Your License Here]
