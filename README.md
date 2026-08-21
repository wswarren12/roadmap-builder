# PL AI Apps — Starter Kit v1.9

Welcome! This kit lets you vibe-code an app with your AI assistant and deploy it
to the Protocol Labs Network sandbox with a single instruction.

## What's inside
- `CLAUDE.md` / `AGENTS.md` — instructions your AI agent reads automatically.
- `.claude/skills/deploy-to-labs/` — the deploy skill your agent uses.
- `.claude/skills/app-metadata/` — how your agent names/describes your app and
  adds an optional one-pager PRD (always with your approval).
- `.claude/skills/app-logs/` — how your agent reads your app's build and
  runtime logs to diagnose failed deploys and runtime errors.
- `.claude/skills/pl-design-system/` — how to build on-brand UI with the PL Design System.
- `.claude/skills/pln-member-context/` — how your app can know which PL member is using it.
- `.claude/skills/app-analytics/` — baseline usage tracking (automatic on
  every app) plus optional custom events (button clicks, feature usage) to
  help the PL team understand how AI Apps get used.
- `.claude/skills/db-migration/` — for apps that already have their own database, how your
  agent migrates it — structure and, by default, your existing data — onto a
  PL-provisioned Postgres database.
- `pln-app.config.json` — the LabOS connect + deploy endpoints (no secrets).
- `pl-design-system/` — the **PL Design System**: ready-made React components
  (Button, EntityCard, PageShell, Table, Tabs, Tag, Badge, SearchInput, …),
  Tailwind v4 semantic tokens, and `USAGE.md` / `guidelines.md`. Your agent
  uses these instead of hand-building UI.
- `styles/` — a tiny CSS-variable fallback (`pln-theme.css`) for plain-HTML apps
  that don't use React, plus font guidance.
- `app/` — a minimal runnable Node app to start from (its `server.js`,
  `package.json`, and `Dockerfile` are placeholders you can replace).

## How to use
1. Unzip this folder and open it in Claude Code (or your AI tool of choice).
2. Add your app to the `app/` folder:
   - **New app:** tell your agent what to build (e.g. "build a leaderboard page
     using the PL styles"). It works in `app/`.
   - **Existing app:** copy your project's files into `app/`, then say "migrate this
     existing app and deploy it to LabOS". Your agent takes care of whatever setup is
     needed to run it there.
3. When you're happy, say "deploy this app". Before the first deploy your agent
   suggests a name and short description for your app — approve them or ask for
   changes. The first time you deploy, your agent will also give you a LabOS
   link to open and approve — sign in and click **Approve** to authorize the
   deploy. Your agent then ships the app to the PL sandbox; the first deploy
   can take a minute or two.
4. Your app appears on the PL Infra → AI Apps dashboard, where you can open it.
   After the first deploy your agent offers an optional **one-pager PRD** — a
   short product brief (why the app exists and what it does) shown with your
   app; say yes and approve the draft, or skip it. You can rename your app,
   edit its description, or change the PRD anytime — just ask your agent; no
   redeploy needed.

## Apps that need an API key or password (secrets)
Some apps need a secret to work — for example an app that talks to ChatGPT/OpenAI,
sends emails, or connects to your own database needs an **API key** or password
for that service. If yours does, the flow is slightly different, and your agent
handles it for you:

1. Build your app as usual — just tell your agent what you want (e.g. "an app that
   summarizes news with ChatGPT"). It knows the app will need a key.
2. **Never paste your API key into the chat** (and don't put it in any file). If
   you do it by accident, your agent will ask you to use the secure page instead.
3. When it's time to deploy, your agent registers the app as a **draft** and gives
   you a LabOS link. Open it, enter your key(s) in the form there, and click
   **Deploy** — that page is the only place your secrets should ever go.
4. Updating a key later? On the PL Infra → AI Apps dashboard, open the **⋯ menu**
   on your app's card (it's also on the app's own page) and choose **Deployment
   settings** — click **Replace** on the value you want to change, enter the new
   one, and click **Redeploy**.

Secrets never go into the code, the chat, or the uploaded ZIP — they are stored
securely on the sandbox and injected into your app when it runs.

## Apps that need a database
Some apps need to remember information between visits — a to-do list, a
leaderboard, a guestbook, anything with data that should still be there next
time someone opens the app. If yours does, you don't need any technical
know-how — your agent will ask which of these you want when it's time to deploy:

1. **Let PL set one up for you (recommended if you don't already have one).**
   No accounts, no setup, nothing to configure — just tell your agent you'd
   like one. Your app gets a working database automatically the moment it
   deploys; you never touch a password or connection string.
2. **Connect a database you already have.** Treat its connection details the
   same as any other secret — see "Apps that need an API key or password"
   above; you'll enter it on that same secure LabOS page.

Either way, you never create the database or generate credentials yourself —
your agent and PL handle that part.

**Already have your own database and want to switch?** If you deployed before
this feature existed (or brought your own on purpose) and would rather PL
manage it, just tell your agent — e.g. *"can we move my database to PL's
managed one?"*. Your agent looks at how your app is built and carries over
both your existing tables/structure **and your existing data** automatically —
one migration, not two separate asks. If you'd rather start the new database
empty (e.g. a throwaway test app), just say so. Either way, it lets you know
if anything about your current setup can't come along automatically (some
database platforms offer extras — like their own login system — that don't
transfer).

## Personalized apps (who's using it)
Your app can know which PL member opened it. When a signed-in member with AI
Apps access uses your app, it can fetch their public directory profile — name,
photo, teams, role, skills — to greet them, tag their feedback, or tailor what
it shows. Just ask your agent, e.g. *"greet me by name and show my team when I
open the app"*. Visitors who aren't signed in (or lack access) simply get the
non-personalized version — your app keeps working for them.

## Usage tracking (helps the PL team, not a dashboard for you)
Every app built with this kit automatically reports basic usage (that it was
opened, roughly how long it was used, and whether it hit an error) to the PL
team, so they can understand how AI Apps get used across the program —
there's nothing to sign up for, configure, or ask your agent for. Note this
data isn't shown back to you anywhere yet — there's no usage dashboard for
your own app today. If you want tracking on a specific feature too (e.g.
"track when someone clicks Export"), just ask your agent — that part is
optional and skipping it doesn't change how your app works.

## When something breaks
If a deploy fails or your app misbehaves after deploying, just tell your agent —
e.g. *"the deploy failed, what happened?"* or *"the app shows an error, check the
logs"*. Your agent can read your app's **build logs** (what happened while the
app was being built) and **runtime logs** (what the running app printed),
diagnose the problem, and fix it — you never need to dig through logs yourself.

## Embedding in the dashboard
Your app is shown inside the AI Apps dashboard. Apps built with this kit display
correctly out of the box, and your agent checks this for you on every deploy — so you
don't need to do anything special. (The technical rule lives in `AGENTS.md` for your
agent's reference.)

## How deploy authorization works
This kit contains **no token**. When your agent deploys, it asks LabOS for a
short-lived deploy credential: you open a LabOS link, sign in, and approve. The
credential is tied to your account, expires after about an hour, and is never
written to disk — so this folder is safe to commit or share (it grants nothing on
its own). Each new deploy session just asks you to approve again.
