---
name: structure-studio
description: Build a UK property packet and cost four ownership structures (direct, SPV, fund, family trust) with cited tax rules, or explain one option in plain English. Use when asked to "build packet from <property>" or "explain option A/B/C/D" in Structure Studio.
license: MIT
metadata:
  version: 0.1.0
---

# Structure Studio (Grok Bot skill)

Two commands. Both call the Structure Studio app; neither calculates tax itself.
Every £ figure in a reply is quoted from the deterministic engine (`/api/engine`), never computed by Grok.

## Commands

### build packet from <property id or address>

```bash
npx tsx agent/bot/cli.ts "build packet from allsop-6392cf9c"
npx tsx agent/bot/cli.ts "build packet from Wireless House, Midsomer Norton"
```

Flow: address -> `GET /api/properties?q=` (first hit) -> `POST /api/match` -> `POST /api/structures` -> `POST /api/engine`.
Reply: packet size and total price, each option's totals by stage, number of review flags, studio link.
Investors default to UK pension fund 60% / UK family office 40% (`DEFAULT_INVESTORS` in `agent/bot/commands.ts`, same as `fixtures/sample.json`).
The bot sends `STUDIO_ASSUMPTIONS` to `/api/engine` (rental-business relief on, profits paid out each year), so its figures match what the Studio and Setup show by default. These are not the engine's own defaults (both off).

### explain option <A|B|C|D>

```bash
npx tsx agent/bot/cli.ts "explain option D"
```

Uses the last packet built (`fixtures/cache/bot/last-run.json`). Grok writes up to 6 sentences from that option's
engine rows and flags. If the text contains any £ figure that is not in the engine output, it is discarded and the
engine rows are shown verbatim instead (rule, formula, citation link).

Add `--json` to either command for machine-readable output (`reply`, `packet_id`, `app_url`, `totals`).

## Environment

- `STUDIO_URL`: app base URL (default `http://localhost:3000`; use the Vercel URL for the demo).
- `DEMO_MODE=1`: Grok answers served only from `fixtures/cache` (offline demo). Run each command once without it to fill the cache.
- `XAI_API_KEY`, `XAI_MODEL`: needed only when not in demo mode.

## Register as a Grok Bot teammate

With the [grok-bot skill](https://github.com/adamanz/grok-bot-skill) installed (`npx skills add adamanz/grok-bot-skill -g -a cursor`):

```bash
python3 "$GROKBOT" create --name "Structure Studio" \
  --title "Costs UK property ownership structures" \
  --description "Answers two commands: 'build packet from <property id or address>' and 'explain option <A-D>'. Runs npx tsx agent/bot/cli.ts with the command and replies with its output unchanged. Never calculates or estimates tax figures; only quotes the engine. Decision support, not tax advice."
python3 "$GROKBOT" chat --name "Structure Studio" "build packet from allsop-6392cf9c"
```

## Rules for the agent running this skill

- Pass the user's command to the CLI as-is and relay its output unchanged.
- Do not add, round, total or compare £ figures yourself.
- If the CLI errors (app not running, property not found), say so and suggest a property id such as `allsop-6392cf9c`.
- End every reply with: "Decision support, not tax advice."
