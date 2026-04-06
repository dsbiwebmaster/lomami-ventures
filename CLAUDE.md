# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install Wrangler (if not already installed)
npm install -g wrangler

# Run locally
wrangler dev

# Deploy to Cloudflare
wrangler deploy
```

## Architecture

This is a **Cloudflare Workers + Assets** site. There is no build step — static HTML/CSS files are served directly from the project root via the Workers Assets runtime.

- **`wrangler.jsonc`** — Cloudflare Workers config. `assets.directory: "."` means the root is the asset root. `nodejs_compat` flag is enabled for Workers scripts.
- **`.dev.vars`** — Local-only secrets (gitignored). Use `.dev.vars.example` for the template. Production secrets go in the Cloudflare dashboard or via `wrangler secret put`.
- **`index.html`** — Landing page (hero with background image, contact email, links to legal pages).
- **`privacy.html` / `terms.html`** — Legal pages. Both reference Twilio as the SMS/communications provider and include standard STOP/HELP opt-out language per A2P 10DLC requirements.

## Key context

- Business: Lomami Ventures (consulting/scheduling, $271/hr). California-based, LA County venue.
- SMS is opt-in only; opt-out via `STOP`, help via `HELP` or email. Privacy and Terms pages already include compliant A2P 10DLC language.
- Verification/background screening (BeenVerified, Intelius) is referenced in legal pages for fraud/risk.
- Any Worker script (e.g. for API routes or form handling) should be placed in a `src/` or `functions/` directory and wired up in `wrangler.jsonc`.
