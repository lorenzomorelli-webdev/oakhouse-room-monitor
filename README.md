# Oakhouse + AYN Telegram Monitor

An unofficial Cloudflare Worker that watches two public pages and sends useful
change alerts to one private Telegram chat:

- [GRAN KOBE room availability](https://www.oakhouse.jp/eng/house/1142#room),
  checked every minute;
- [AYN Shipping Dashboard](https://www.ayntec.com/pages/shipment-dashboard),
  checked every 30 minutes.

The Worker runs entirely on Cloudflare after deployment. No computer or
always-on server is required.

> This project is not affiliated with, endorsed by, or operated by Oakhouse or
> AYN. It monitors public information only and does not automate login,
> reservations, purchases, or other actions.

## Features

- detects new, removed, and changed Oakhouse room rows;
- detects new, removed, and changed dated AYN shipment rows;
- includes a concise diff and a direct page link in every alert;
- sends an initial baseline, then remains silent until meaningful data changes;
- reports repeated fetch or parsing failures and announces recovery;
- preserves the last delivered snapshot if fetching, parsing, KV, or Telegram
  delivery fails;
- exposes private `/status`, `/test`, `/test_ayntec`, `/help`, and `/start`
  Telegram commands;
- keeps the two monitors isolated through separate Cron routes and KV keys.

## How it works

```text
Cloudflare Cron
  ├─ every minute ─────► Oakhouse parser ──► Oakhouse KV snapshot
  └─ every 30 minutes ─► AYN parser ───────► AYN KV snapshot
                                              │
                           meaningful diff ───┴─► Telegram
```

Oakhouse is parsed from its server-rendered room table. AYN is fetched through
Shopify's compact `main-page` section endpoint, while notifications link to the
normal dashboard page. Each normalized snapshot is compared with the last
successfully delivered snapshot before KV is advanced.

Telegram commands do not scrape either website. `/status` reads both persisted
snapshots and their health heartbeats. `/test` and `/test_ayntec` make a
synthetic in-memory diff from the corresponding real snapshot and never write
that simulation to KV.

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
only an empty secret example and a reusable Wrangler template.

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
intended account ID. Keeping the account explicit is especially useful when
Wrangler can access more than one Cloudflare account.

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

### 4. Enable both Cron Triggers and deploy

Set the local trigger configuration to:

```json
"triggers": {
  "crons": ["* * * * *", "*/30 * * * *"]
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

Configure the menu through BotFather's `/setcommands` flow or Telegram's
`setMyCommands` API:

```text
status - Show both monitor states
test - Send a safe synthetic Oakhouse alert
test_ayntec - Send a safe synthetic AYN alert
help - Show the command guide and source links
```

Send `/status`, `/test`, and `/test_ayntec` to verify the complete
webhook-to-Worker-to-Telegram flow. Both test commands are clearly labelled as
simulations and never update persisted snapshots.

## Local development

Copy the empty local-secret template and fill it only on your machine:

```bash
cp .dev.vars.example .dev.vars
pnpm run dev
```

Trigger either scheduled route locally:

```bash
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
curl "http://localhost:8787/__scheduled?cron=*/30+*+*+*+*"
```

Useful checks:

```bash
pnpm run check
pnpm run deploy:dry
pnpm exec wrangler tail oakhouse-room-monitor --format pretty
```

## Persistence and delivery semantics

Workers KV stores four versioned records:

- `house:1142:snapshot:v1`: last valid Oakhouse snapshot delivered;
- `house:1142:health:v1`: Oakhouse failure and heartbeat state;
- `ayntec:shipment-dashboard:snapshot:v1`: last valid AYN snapshot delivered;
- `ayntec:shipment-dashboard:health:v1`: AYN failure and heartbeat state.

Notifications use **at-least-once delivery**. If Telegram times out after a
partial multi-message delivery, a later run may repeat part of the alert. The
monitor deliberately prefers a possible duplicate over silently losing a
change notification.

Workers KV is eventually consistent. Reads use its minimum 30-second cache
TTL. A failed notification never advances the corresponding data snapshot.

## Free-tier usage

With the default schedules, the Worker performs approximately:

- 1,488 invocations per day: 1,440 Oakhouse and 48 AYN;
- 2,976 KV reads per day under normal operation;
- 288 regular Oakhouse health-heartbeat writes and 48 regular AYN heartbeat
  writes per day, plus initial baselines and real state transitions.

Pricing and quotas can change. Check the current
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
and [Workers KV limits](https://developers.cloudflare.com/kv/platform/limits/)
before deploying.

[Oakhouse states](https://www.oakhouse.jp/eng/helpcenter) that vacancy
information is updated every 15 minutes. The one-minute schedule prioritizes
notification latency. The slower AYN schedule keeps request volume modest for
a dashboard that changes much less frequently.

## Limitations and responsible use

- A material markup change on either source can require parser and fixture
  updates.
- Alerts are informational and do not guarantee continued availability.
- Review each target site's current terms and `robots.txt`, use identifiable
  user agents, and keep request volume reasonable.
- Do not extend this project to bypass authentication, automate reservations
  or purchases, or collect non-public personal data.

## License

Released under the [MIT License](LICENSE). Oakhouse and AYN names, trademarks,
website content, and product data remain the property of their respective
owners.
