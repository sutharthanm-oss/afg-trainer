# AFG AI Appointment Setting Trainer — Deployable Version

This is the real, deployable version of the trainer app. Unlike the version tested inside
Claude's chat preview, this one has its own backend, so it will work as a real app with its
own URL — including the microphone, which the chat preview blocked.

## What's different from the chat-preview version

- The chat preview called Anthropic and Airtable **directly from the browser**, relying on
  Claude.ai's own authentication. That only works inside Claude.ai's preview — it cannot work
  once this app has its own URL.
- This version adds a small **backend** (three files in `/api`) that holds your real API keys
  securely and does the actual work. The browser app talks only to this backend, never
  directly to Anthropic or Airtable.

## Before you deploy, you need two things

1. **An Anthropic API key** — from https://console.anthropic.com (Settings → API Keys).
   This is separate from your Claude.ai chat login.
2. **An Airtable Personal Access Token** — from https://airtable.com/create/tokens
   - Give it these scopes: `data.records:read`, `data.records:write`, `schema.bases:read`
   - Give it access to your **AFG AI Appointment Setting Trainer** base specifically.

**Keep both of these secret.** Never paste them into a chat with me or anyone else — you'll
enter them directly into your hosting provider's dashboard in Step 3 below.

## Deploying with Vercel (recommended — free, and this project is already set up for it)

1. Create a free account at https://vercel.com if you don't have one (you can sign up with
   GitHub, GitLab, or email).
2. Install the Vercel CLI on your own computer (requires Node.js installed):
   ```
   npm install -g vercel
   ```
3. From inside this project folder, run:
   ```
   vercel
   ```
   Follow the prompts (link to a new project, accept the defaults).
4. Before or after the first deploy, add your two secret keys:
   - Go to your project on vercel.com → **Settings → Environment Variables**
   - Add `ANTHROPIC_API_KEY` = (your Anthropic key)
   - Add `AIRTABLE_TOKEN` = (your Airtable personal access token)
   - Redeploy (`vercel --prod`) so the new environment variables take effect.
5. Vercel will give you a real URL like `https://afg-appointment-trainer.vercel.app`.
   Open that on your iPhone in Safari, then use **Share → Add to Home Screen** for the
   app-like experience.

## Deploying with Netlify (alternative)

Netlify also supports this structure (`/api` functions) with minor path differences. If you'd
rather use Netlify, tell me and I'll adjust the API folder to Netlify's function format
(`netlify/functions/`) — it's a small change, not a rewrite.

## Local testing (optional, for you or a developer to try before deploying)

```
npm install
npm run dev
```
Note: the `/api` functions won't run under plain `vite dev` — Vercel's own local dev command
(`vercel dev`) is needed to test those locally, since it emulates the serverless environment.

## What to test once it's live

Everything from our earlier checklist, but this time the mic, the roleplay chat, and the
Airtable submission should all actually work, since none of them depend on Claude.ai's
in-chat sandbox anymore.

## If something breaks after deploying

Copy me the exact error message shown in the app (the app is designed to surface real error
text, not hide it) and I'll help you debug from there.
