# Oakhouse Room Monitor

An unofficial Cloudflare Worker that watches the public room table of an
Oakhouse property and sends Telegram alerts when availability changes.

The included configuration targets
[GRAN KOBE](https://www.oakhouse.jp/eng/house/1142#room), but the property name
and URLs can be changed in the local Wrangler configuration. The parser is
specific to Oakhouse's current server-rendered room markup.

> This project is not affiliated with, endorsed by, or operated by Oakhouse.
> It monitors public information only and does not automate login, booking, or
> reservation flows.

## Features

- checks the room table every minute with a Cloudflare Cron Trigger;
- detects newly available rooms, removed availability, dates, prices, area,
  room type, and floor-plan changes;
- sends an initial Telegram baseline and then only meaningful changes;
- reports an outage after three consecutive failures and announces recovery;
- exposes private `/status`, `/test`, `/help`, and `/start` Telegram commands;
- preserves the last delivered snapshot when fetching, parsing, KV, or
  Telegram delivery fails;
- runs entirely on Cloudflare after deployment, with no computer left on.

## How it works

1. A Cron Trigger invokes the Worker.
2. The Worker downloads the public Oakhouse page with a fixed timeout.
3. `HTMLRewriter` parses and validates every room row.
4. The normalized result is compared with the last delivered snapshot in
   Workers KV.
5. Relevant differences are sent to Telegram before the snapshot advances.

Telegram commands do not scrape Oakhouse directly. `/status` reads the latest
persisted snapshot and health heartbeat, while `/test` builds a synthetic diff
from that snapshot without writing anything to KV. This keeps webhook replies
fast and prevents a command from changing production state.

## Security model

- Telegram webhook requests must include `TELEGRAM_WEBHOOK_SECRET`.
- Updates are accepted only from the configured private `TELEGRAM_CHAT_ID`.
- Bot tokens, chat IDs, webhook secrets, and the production Wrangler config are
  ignored by Git.
- Cloudflare secrets are stored with `wrangler secret put`, not as plaintext
  Worker variables.
- Unknown routes return `404`; the webhook accepts authenticated `POST`
  requests only.
- Operational errors are normalized and known secret values are redacted
  before logging or persistence.

Never commit `.env`, `.dev.vars`, or `wrangler.jsonc`. The repository contains
only empty secret examples and a reusable Wrangler template.

## Requirements

- Node.js 22 or later;
- [pnpm](https://pnpm.io/);
- a Cloudflare account with Workers and Workers KV;
- a dedicated Telegram bot and a private chat with that bot.

## Setup

### 1. Install dependencies

```bash
pnpm install
pnpm run check
```

### 2. Create the local Cloudflare configuration

Copy the public template. The resulting file is ignored by Git:

```bash
cp wrangler.example.jsonc wrangler.jsonc
pnpm exec wrangler login
pnpm exec wrangler whoami
```

Replace `REPLACE_WITH_YOUR_CLOUDFLARE_ACCOUNT_ID` in `wrangler.jsonc` with the
intended account ID. Keeping it explicit is especially useful when Wrangler
can access more than one Cloudflare account.

Create and bind the KV namespace:

```bash
pnpm exec wrangler kv namespace create STATE --binding STATE --update-config
```

Wrangler writes the generated namespace ID only to the ignored local config.

### 3. Prepare Telegram

1. Create a dedicated bot with [BotFather](https://t.me/BotFather).
2. Open the bot's private chat and send `/start`.
3. Before registering a webhook, use Telegram's
   [`getUpdates`](https://core.telegram.org/bots/api#getupdates) method to read
   the numeric private chat ID.
4. Generate a high-entropy webhook secret, for example with
   `openssl rand -hex 32`.

Store all three values through Wrangler's encrypted secret prompts:

```bash
pnpm exec wrangler secret put TELEGRAM_BOT_TOKEN
pnpm exec wrangler secret put TELEGRAM_CHAT_ID
pnpm exec wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

Do not paste real values into `wrangler.jsonc`, source files, issues, or commit
messages.

### 4. Enable the Cron and deploy

After KV and all secrets exist, change the local trigger to:

```json
"triggers": {
  "crons": ["* * * * *"]
}
```

Then validate and deploy:

```bash
pnpm run deploy:dry
pnpm run deploy
```

Wrangler prints the `workers.dev` URL after deployment.

### 5. Register the Telegram webhook and command menu

Call Telegram's [`setWebhook`](https://core.telegram.org/bots/api#setwebhook)
method with:

```json
{
  "url": "https://YOUR_WORKER.workers.dev/telegram/webhook",
  "secret_token": "THE_SAME_TELEGRAM_WEBHOOK_SECRET",
  "allowed_updates": ["message"],
  "drop_pending_updates": true
}
```

Configure the menu through BotFather's `/setcommands` flow:

```text
status - Show the latest confirmed check
test - Send a safe synthetic availability alert
help - Show the command guide and property link
```

Send `/status` and `/test` to verify the complete webhook-to-Worker-to-Telegram
flow. `/test` is labelled as a simulation and never updates the stored
snapshot.

## Local development

Copy the empty local-secret template and fill it only on your machine:

```bash
cp .dev.vars.example .dev.vars
pnpm run dev
```

Trigger a scheduled run locally:

```bash
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
```

Useful checks:

```bash
pnpm run check
pnpm run deploy:dry
pnpm exec wrangler tail oakhouse-room-monitor --format pretty
```

## Persistence and delivery semantics

Workers KV stores two versioned records:

- `house:1142:snapshot:v1`: the last valid snapshot successfully delivered;
- `house:1142:health:v1`: failure, outage, recovery, and heartbeat state.

Notifications use **at-least-once delivery**. If Telegram times out after a
partial multi-message delivery, a later run may repeat part of the alert. The
monitor deliberately prefers a possible duplicate over silently losing a new
room notification.

Workers KV is eventually consistent. Reads use its minimum 30-second cache
TTL, so technical outage or recovery alerts can rarely be delayed or
duplicated. A failed notification never advances the availability snapshot.

## Free-tier usage

At the default one-minute interval, the Worker performs approximately:

- 1,440 Worker invocations per day;
- 2,880 KV reads per day;
- 288 normal health-heartbeat writes per day, plus real state transitions.

These figures were comfortably within the Cloudflare free-tier limits when
this project was published, but pricing and quotas can change. Check the
current [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
and [Workers KV limits](https://developers.cloudflare.com/kv/platform/limits/)
before deploying.

[Oakhouse states](https://www.oakhouse.jp/eng/helpcenter) that vacancy
information is updated every 15 minutes. The one-minute schedule favors
notification latency, but a slower Cron may be more appropriate for other
deployments.

## Limitations and responsible use

- A material Oakhouse markup change can require parser and fixture updates.
- Availability alerts are informational and do not guarantee that a room can
  still be booked.
- Review the target site's current terms and
  [`robots.txt`](https://www.oakhouse.jp/robots.txt), use an identifiable user
  agent, and keep request volume reasonable.
- Do not extend this project to bypass authentication, automate reservations,
  or collect non-public personal data.

## License

Released under the [MIT License](LICENSE). Oakhouse names, trademarks, website
content, and property data remain the property of their respective owners.
