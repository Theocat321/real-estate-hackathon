# HANDOFF — Engine + Grok Bot

Last updated after Phase 1 of `docs/superpowers/plans/2026-11-12-tax-structure-gaps.md` (commits 70c9763..HEAD). Contract version 1.1.0. Tests: 133 green (`npx vitest run`, 12 files), `npx tsc --noEmit` clean.

## Built
- `runEngine(ScenarioInput) → EngineResult` in `engine/index.ts`. Pure TS. Every `CostRow` has a formula, sourced inputs and a `RuleRef` (GOV.UK citation, as_of 2026-27).
- 14 rule files in `engine/rules/`:
  - `sdlt_nonres.ts` — non-residential SDLT bands.
  - `sdlt_res.ts` — residential higher rates, flat 17% for companies over £500k, +2% non-UK surcharge, rental-business relief switch.
  - `stamp_duty_shares.ts` — 0.5% on shares (PropCo sale).
  - `stamp_duty_units.ts` — stamp duty on fund units.
  - `ated.ts` — ATED 2026-27 bands, relief to £0.
  - `iht_entry.ts` — trust entry charge.
  - `iht_ten_year.ts` — 10-year charge.
  - `iht_death_comparator.ts` — what the family would pay on death holding personally (a comparator, not a cost of D).
  - `iht_base.ts` — shared IHT base wording (`ihtBaseText`, "family's share" label).
  - `corp_tax.ts` — 19% / 25% with marginal relief; limits shared with associated companies.
  - `income_tax.ts` — rent received by families, flat 45%.
  - `dividend_tax.ts` — tax when PropCo pays profits out.
  - `rent.ts` — stated rent, else 6.5% yield estimate, 75% profit.
  - `citations.ts` — all GOV.UK URLs in one place (`CITE`).
- `POST /api/engine` validates with zod (`engine/schema.ts`, shares `AssumptionsSchema` with `/api/optimise`). 400 `{error}` on bad input.
- Contract 1.1.0 added `ScenarioInput.assumptions?: { rental_relief?, distribute_profits? }` and the `DIVIDEND_TAX` / `INCOME_TAX_RENT` tax codes.
  - Engine/API default when absent: both false.
  - Studio, Setup and the bot default to `STUDIO_ASSUMPTIONS` (`lib/horizon.ts`): both true. One source; do not copy the values.
  - Studio's Setup link carries `?relief=0|1&dividends=0|1`; Setup reads it (`assumptionsFromQuery`), missing keys fall back to `STUDIO_ASSUMPTIONS`.
  - Cliffs and the optimiser (`/api/optimise` takes `assumptions`) price with the same flags.
- Grok Bot: `npx tsx agent/bot/cli.ts "build packet from <id|address>"` / `"explain option A-D"`. Skill in `agent/bot/skill/SKILL.md`. Explanations quote engine figures only; an invented £ falls back to the engine rows.

## Behaviours that must not regress (each pinned by a test)
All in `engine/__tests__/engine.test.ts` unless noted.
- **Relief switch.** £1.1m dwelling, company, relief on: `SDLT_RES_HIGHER` £108,750, not 17% (£187,000 when off). Test "£1.1m dwelling, company, relief on -> higher rates 108,750 not 17%". Non-UK company, relief on: £130,750 and cites the corporate-bodies page. Test "...non-UK company buyer, relief on...". ATED row stays at £0 with relief (9,450 off). Test "ATED row is £0 with relief on, 9,450 with relief off". Relief off equals today's totals. Test "relief off reproduces today's golden totals". Setup keeps the ATED return step at £0: `lib/__tests__/setup.test.ts`.
- **Joint buyers in A.** Any company among buyers gives 17%; any non-UK buyer adds 2%. Tests "A with a UK company and a family office owning half each pays the 17% rate" (£187,000, ATED £9,450 on the whole dwelling) and "B with a 60% non-UK family office pays the 2% non-UK surcharge". Several companies: "their share" wording, test "joint ATED note says 'their share'...".
- **Investors kept in A/B/D with shares.** `agent/__tests__/agent.test.ts`: "B keeps each investor and their share of PropCo", "A with 2+ investors gives each investor its share...", "a single investor uses its own share on edges in A and B, as in C and D". No investors falls back to the generic Buyer and today's totals: "no investors gives today's totals" (A 49,250 / 14,401).
- **D trust share for IHT.** Family 70 / pension 30 on £1m: trust IHT on £700,000. Entry £75,000, ten-year £22,500, death comparator £150,000. Test "D with family 70 / pension 30 bases trust IHT on 70% of the packet". Formula text says "family's share".
- **D without a family** keeps one owner of PropCo (shares sum to 100) and today's D totals (265,250 / 14,401 / 7,025 / 64,800 / 432,000). Test "D without a family keeps one owner of PropCo and today's D totals".
- **investor_pct flag** fires when shares are not within 0.5 of 100; message "Investor shares add up to 90%, not 100%." Test "investor_pct tolerates rounding like normalisePcts".
- **Income tax on rent.** Flat 45% for families receiving rent (A, C). `incomeTaxOnRent(100_000)` = £45,000, test "income tax on rent: 45% additional rate". Non-UK family: £21,937 on £1m, test "non-UK family receiving rent directly...".
- **Dividend tax.** 39.35% for individuals and trusts, rounded down: £81,000 gives £31,873. £0 (row kept) for company, pension and non-UK. Test "dividend tax by recipient, rounded down". D with £108,000 profit: SPV pays CT £24,870 and trust pays £32,711 dividend tax, test "D with £108,000 profit...". No rows when profits are not paid out or no lot is priced: "distribute_profits off...", "all lots unpriced...".
- **Associated companies share CT limits.** `corpTax(60_000, 1)` = £14,025; a `uk_company` investor owning PropCo gives 1 associated company; a pension gives none. Tests "associated companies halve the corporation tax limits", "associated: a uk_company investor...", "associated: a pension...".
- **Grok rationale never blocks Studio.** `buildStructures` waits at most `RATIONALE_WAIT_MS` (8s), then uses template text; the slow call keeps running and fills the cache. `agent/__tests__/agent.test.ts`: "does not wait on a slow Grok: template text after the time limit". Numbers in Grok text are rejected and fall back: "Grok writes only rationale...".
- **Studio request-id guard.** `app/studio/[id]/page.tsx`: structures are built only when packet or preset changes; toggles re-run engine and cliffs on cached structures; only the latest request's result and loading state apply. No automated test (verified by tsc and build only). Change with care.
- **Chart node height.** One badge per row: `NODE_H + 18 × badges` = 56, 74, 92, 110 for 0 to 3. `components/__tests__/StructureChart.test.ts` "adds 18 per badge, one badge per row".
- **One assumptions source.** `lib/__tests__/horizon.test.ts` "one default for every engine caller..."; bot test "runs the engine on the same assumptions as the Studio" (`agent/bot/__tests__/bot.test.ts`).

## Golden sample (`fixtures/sample.json` → `expected_engine`)
Pension 60 / UK family office 40, each kept in A, B and D. No `assumptions` sent (both false). Asserted in `engine/__tests__/engine.test.ts` ("golden sample fixture", "returns golden totals for the sample fixture") and `agent/__tests__/agent.test.ts` ("engine on generated structures reproduces the golden totals").
- A: acquire 49,250 · hold 12,329 (family's 40% of rent at 45%).
- B: acquire 49,250 · hold 14,401 (PropCo CT) · exit 7,025.
- C: acquire 49,250 · hold 12,329 · exit 0.
- D: acquire 96,650 · hold 14,401 · exit 7,025 · ten-year 14,220 · death 94,800 (trust IHT on its 40% of £1,405,000 = £562,000).
- D breakdown: SDLT_NONRES 49,250 · IHT_ENTRY 47,400 · STAMP_DUTY_SHARES 7,025 · IHT_TEN_YEAR 14,220 (test "D breakdown by tax").
- Residential checks: £1.1m company dwelling SDLT 187,000, ATED 9,450.
- With `distribute_profits`: B and D add 8,514 dividend tax a year (family's or trust's 40% of the £54,093 left after CT, at 39.35%). Test "sample with profits paid out...". B hold becomes 22,915 (14,401 + 8,514). Studio and the bot show this, because they send `STUDIO_ASSUMPTIONS`.
- `settlor_nrb_available_gbp: 0` gives D ten-year 33,720 (test "settlor_nrb_available_gbp changes IHT base").

## Gaps (open)
- LBTT / LTT not priced (flagged).
- Linked transactions are a flag, not priced. Needs `same_seller` on `ScenarioInput` (contract change).
- Brochures without a printed price come in uncosted (unpriced lots).
- Fixture `per_lot` shares 4,450 vs engine's packet-level 7,025 needs a lead decision.
- `CostRow.comparator?: boolean` change request stays open: contract 1.1.0 does not have it. The death comparator is identified by tax code `IHT_DEATH_COMPARATOR`.
- Phase 2 (each needs a decision first, see the plan): tax on gains at sale, VAT on commercial, trust IHT refinements (grossing-up, exit charges), more structures (SPV per property, holdco, non-UK company, LLP, debt).
- New simplifications to know about:
  - Income tax on rent is a flat 45%, dividend tax a flat 39.35%. No lower bands, no dividend allowance.
  - Associated companies come only from the structure graph, and only when one edge gives control above 50%. Two edges summing above 50% are not counted.
  - ATED is charged on the whole dwelling when a company co-owns it (the formula says so).
  - A company investor paying CT directly (option A) has no owner above it, so no dividend rows.
  - `optimisePacket` / `/api/optimise` has no UI caller. Any future caller must send `assumptions`.
  - Investor shares within 0.5 of 100 are used as given (no drift correction).
  - Dividend formula prints the raw unrounded percentage.

## Run
- Grok Bot.app open, `.env` has `DEMO_MODE=0`, `NEXT_PUBLIC_USE_FIXTURES=false`, then `npm run dev` → http://localhost:3000.
- No API key: `GROK_TRANSPORT=grokbot` in `.env` sends Grok calls through the signed-in Grok Bot app (macOS) via `~/.cursor/skills/grok-bot/scripts/grokbot.py` (patched to read the app version; a stale version gives HTTP 401). Teammate "Structure Studio JSON": `npx tsx agent/bot/setup-grokbot.ts`.
- Grok answers cache in `fixtures/cache/`. A stale or empty cache now only costs rationale wording (template text after 8s), not page load. Pre-run the demo once for instant replies.
- Tests: `npx vitest run`.

## Regression checklist before merging engine changes
1. `npx vitest run && npx tsc --noEmit && npm run build` all pass.
2. Update the golden numbers in `fixtures/sample.json` and the "Golden sample" section here, plus the test count at the top.
3. Studio, Setup and the bot must all use `STUDIO_ASSUMPTIONS` from `lib/horizon.ts`. Do not hard-code flags.
4. On any contract change: bump `CONTRACT_VERSION` in `contracts/index.ts` and `contract_version` in `fixtures/sample.json` (test "is on the current contract version"), and mirror it in `engine/schema.ts`. The lead approves contract edits.
