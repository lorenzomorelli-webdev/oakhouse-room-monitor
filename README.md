# Oakhouse + AYN + EUR/JPY Telegram Monitor

An unofficial Cloudflare Worker that watches two public pages, tracks EUR/JPY,
and sends useful updates to one private Telegram chat:

- [GRAN KOBE room availability](https://www.oakhouse.jp/eng/house/1142#room),
  checked every minute;
- [AYN Shipping Dashboard](https://www.ayntec.com/pages/shipment-dashboard),
  checked every hour;
- EUR/JPY, summarized at 09:00, 13:00, 17:00, and 21:00 Europe/Rome on
  weekdays, with a direct link to the
  [Il Sole 24 Ore chart](https://mercati.ilsole24ore.com/tassi-e-valute/valute/contro-euro/cambio/JPYVS.FX).

The Worker runs entirely on Cloudflare after deployment. No computer or
always-on server is required.

> This project is not affiliated with, endorsed by, or operated by Oakhouse or
> AYN, Twelve Data, or Il Sole 24 Ore. It monitors public information only and does not automate login,
> reservations, purchases, or other actions.

## Features

- detects new, removed, and changed Oakhouse room rows;
- alerts for AYN only when a newer shipment date appears and includes every row
  in that latest batch;
- silently stores AYN corrections made within the already-known latest date;
- sends four weekday EUR/JPY summaries with the current rate, daily movement,
  previous close, daily range, and trailing one-year range/performance;
- includes a concise recap and a direct page link in every alert;
- keeps Oakhouse and AYN silent after their baselines until meaningful data
  changes, while FX sends each scheduled digest;
- reports repeated fetch or parsing failures and announces recovery;
- preserves the last delivered snapshot if fetching, parsing, KV, or Telegram
  delivery fails;
- exposes private `/status`, `/yen`, `/test`, `/test_ayntec`, `/test_yen`,
  `/help`, and `/start` Telegram commands;
- keeps all three monitors isolated through separate execution paths and KV
  keys.

## How it works

```text
Cloudflare Cron
  ├─ every minute ─────► Oakhouse parser ──► Oakhouse KV snapshot
  └─ every hour ───────► AYN parser ───────► AYN KV snapshot
          └─ 09/13/17/21 Europe/Rome, Mon–Fri
                         ► Twelve Data ─────► EUR/JPY KV snapshot
                                                    │
                         alert or digest ──────────┴─► Telegram
```

Oakhouse is parsed from its server-rendered room table. AYN is fetched through
Shopify's compact `main-page` section endpoint, while notifications link to the
normal dashboard page. Oakhouse alerts on tracked room changes. AYN alerts only
when its maximum published shipment date moves forward; same-day corrections
refresh the stored snapshot without sending noise. EUR/JPY uses Twelve Data's
daily time series and sends a text-only digest; the linked Il Sole 24 Ore page
provides the chart on demand.

Telegram commands do not fetch any source. `/status` reads all persisted
snapshots and health states; its AYN section also prints every row from the
latest batch. `/yen` prints the last persisted FX digest. `/test` makes a
synthetic Oakhouse diff, `/test_ayntec` simulates a batch on the following
calendar day, and `/test_yen` replays the saved rate with a prominent test
label. No simulation writes to KV.

## Security model

- Telegram webhook requests must include `TELEGRAM_WEBHOOK_SECRET`.
- Updates are accepted only from the configured private `TELEGRAM_CHAT_ID`.
- Bot tokens, chat IDs, webhook secrets, the Twelve Data API key, and the
  production Wrangler config are ignored by Git.
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
- a dedicated Telegram bot and a private chat with that bot;
- a [Twelve Data API key](https://twelvedata.com/) (the free tier is ample for
  four weekday requests).

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

### 4. Configure the EUR/JPY provider

Create a Twelve Data API key, then store it as a Cloudflare secret:

```bash
pnpm exec wrangler secret put TWELVE_DATA_API_KEY
```

The Worker requests `EUR/JPY` daily candles only at 09:00, 13:00, 17:00, and
21:00 in `Europe/Rome`, Monday through Friday. Daylight-saving changes are
handled automatically. The reported value is indicative; a bank or exchange
may apply a spread and commissions.

### 5. Enable both Cron Triggers and deploy

Set the local trigger configuration to:

```json
"triggers": {
  "crons": ["* * * * *", "0 * * * *"]
}
```

Then validate and deploy:

```bash
pnpm run deploy:dry
pnpm run deploy
```

Wrangler prints the `workers.dev` URL after deployment.

### 6. Register the Telegram webhook and command menu

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

The Worker treats the following list as its command manifest. Sending `/start`
or `/help` synchronizes it through Telegram's `setMyCommands` API for the exact
configured private chat and activates the native command menu button:

```text
start - Start the bot and show its guide
status - Show all monitor states
yen - Show the latest saved EUR/JPY digest
test - Send a safe synthetic Oakhouse alert
test_ayntec - Simulate an AYN batch on the next calendar day
test_yen - Replay the saved EUR/JPY digest as a test
help - Show the command guide and source links
```

Send `/help` once, then `/status`, `/yen`, `/test`, `/test_ayntec`, and
`/test_yen` to verify the complete webhook-to-Worker-to-Telegram flow. Test
commands are clearly labelled as simulations and never update persisted
snapshots.

## Local development

Copy the empty local-secret template and fill it only on your machine:

```bash
cp .dev.vars.example .dev.vars
pnpm run dev
```

Trigger either scheduled route locally:

```bash
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"
```

Useful checks:

```bash
pnpm run check
pnpm run deploy:dry
pnpm exec wrangler tail oakhouse-room-monitor --format pretty
```

## Persistence and delivery semantics

Workers KV stores six versioned records:

- `house:1142:snapshot:v1`: last valid Oakhouse snapshot delivered;
- `house:1142:health:v1`: Oakhouse failure and heartbeat state;
- `ayntec:shipment-dashboard:snapshot:v1`: last valid AYN snapshot, including
  silently stored same-day corrections;
- `ayntec:shipment-dashboard:health:v1`: AYN failure and heartbeat state;
- `fx:eurjpy:snapshot:v1`: last successfully delivered EUR/JPY digest;
- `fx:eurjpy:health:v1`: EUR/JPY failure and heartbeat state.

Notifications use **at-least-once delivery**. If Telegram times out after a
partial multi-message delivery, a later run may repeat part of the alert. The
monitor deliberately prefers a possible duplicate over silently losing a
change notification.

Workers KV is eventually consistent. Reads use its minimum 30-second cache
TTL. A failed notification never advances the corresponding data snapshot.

## Free-tier usage

With the default schedules, the Worker performs approximately:

- 1,464 invocations per day: 1,440 Oakhouse and 24 AYN;
- 2,928 KV reads per day, plus 8 FX reads on weekdays;
- 288 regular Oakhouse health-heartbeat writes and 24 regular AYN heartbeat
  writes per day, plus 8 FX writes on weekdays, initial baselines, and real
  state transitions;
- four Twelve Data calls and four FX Telegram digests per weekday.

Pricing and quotas can change. Check the current
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
and [Workers KV limits](https://developers.cloudflare.com/kv/platform/limits/),
plus [Twelve Data pricing](https://twelvedata.com/pricing/),
before deploying.

[Oakhouse states](https://www.oakhouse.jp/eng/helpcenter) that vacancy
information is updated every 15 minutes. The one-minute schedule prioritizes
notification latency. The slower AYN schedule keeps request volume modest for
a dashboard that changes much less frequently.

## Limitations and responsible use

- A material markup change on Oakhouse or AYN, or a Twelve Data response-schema
  change, can require parser and fixture updates.
- Alerts are informational and do not guarantee continued availability.
- FX values are indicative market data, not financial advice or a guaranteed
  executable exchange rate.
- Review each target site's current terms and `robots.txt`, use identifiable
  user agents, and keep request volume reasonable.
- Do not extend this project to bypass authentication, automate reservations
  or purchases, or collect non-public personal data.

## License

Released under the [MIT License](LICENSE). Oakhouse and AYN names, trademarks,
website content, and product data remain the property of their respective
owners.
