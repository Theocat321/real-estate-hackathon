# Tax and Structure Gaps (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the gaps that change which option the Studio ranks cheapest: inconsistent rental-business relief, investors collapsed into a generic buyer, missing tax on paying profits out, families taxed as companies, and associated companies ignored. Also make the structure chart show flags and what each edge means.

**Architecture:** Every fix is a new or changed rule in `engine/rules/`, wired in `engine/index.ts`, so every £ keeps its formula, sourced inputs and `RuleRef`. Studio assumptions that change tax (relief, profits paid out) move from client-side row filtering in `lib/horizon.ts` into `ScenarioInput.assumptions`, so the engine, cliffs and optimiser all price the same way. Structure templates in `agent/structures.ts` keep the real investors and their percentages.

**Tech Stack:** TypeScript, Next.js app routes, zod, vitest, @xyflow/react + dagre.

**Spec:** Gap review in this session (no separate spec file). Items 1–5 of "Tax rules: wrong numbers today" plus the structure chart section. Phase 2 items are listed at the end, out of scope.

## Global Constraints

- `contracts/index.ts` is owned by the lead. Task 1 is the only task that edits it; it bumps `CONTRACT_VERSION` to `"1.1.0"`.
- Every `CostRow` keeps a `formula`, `inputs` with a `SourceRef` each, and a `RuleRef` with `citation_url` and `as_of: AS_OF` ("2026-27"). The existing test "every row has formula, sourced inputs and RuleRef" must stay green.
- Amounts are whole pounds, rounded per rule, as now.
- Rates for 2026-27: dividend additional rate 39.35%; trust dividend rate 39.35%; property income additional rate 45%; corporation tax 19% / 25%, limits £50,000 / £250,000, marginal relief fraction 3/200.
- `engine/schema.ts` (zod) mirrors every contract change.
- Copy in UI and flags: plain English, one sentence per flag, no jargon without a short explanation.
- Golden figures change. Update `engine/HANDOFF.md` "Golden sample" line in the task that changes them, with the new numbers.

## Review Focus

1. Investor percentages that don't add up to 100 (e.g. 60 + 30): shares of rent and the trust's share must not silently shrink. Expect a `review` flag "Investor shares add up to 90%, not 100%" and shares used as given. Test in Task 3.
2. No investors given: A, B and D fall back to today's generic "Buyer" (UK company). Today's numbers must not change. Test in Task 3.
3. Joint direct purchase in A with one company and one family: the 17% company rate applies to the whole dwelling over £500k (any non-natural person among the buyers), and the 2% non-UK surcharge applies if any buyer is non-UK. Test in Task 3.
4. Relief off and profits kept in the company reproduce today's engine output exactly (regression). Test in Task 2 and Task 4.
5. Zero or no rent (all lots unpriced): no dividend or income tax row with a negative or NaN amount. Test in Task 4.

---

### Task 1: Contract change (lead approval)

**Files:**
- Modify: `contracts/index.ts` (TaxCode union, ScenarioInput, CONTRACT_VERSION)
- Modify: `engine/schema.ts` (zod mirror)
- Modify: `components/StructureChart.tsx` (`TAX_SHORT` record; TS forces it)
- Test: `engine/__tests__/engine.test.ts`

**Interfaces:**
- Produces:
  - `TaxCode` adds `"DIVIDEND_TAX" | "INCOME_TAX_RENT"`.
  - `ScenarioInput.assumptions?: Assumptions` with `interface Assumptions { rental_relief?: boolean; distribute_profits?: boolean }`. Engine defaults when absent: both `false` (keeps today's numbers for API callers that don't send them).
  - `CONTRACT_VERSION = "1.1.0"`.
  - `TAX_SHORT.DIVIDEND_TAX = "Dividend tax p.a."`, `TAX_SHORT.INCOME_TAX_RENT = "Income tax on rent p.a."`.

- [ ] **Step 1: Get lead sign-off** on the three contract changes above (lead owns `contracts/index.ts`).
- [ ] **Step 2: Write failing test** `it("accepts assumptions in ScenarioInput")`: `ScenarioInputSchema.safeParse({ ...sample, assumptions: { rental_relief: true, distribute_profits: true } }).success === true`, and `{ assumptions: { rental_relief: "yes" } }` fails.
- [ ] **Step 3: Run** `npx vitest run engine/__tests__/engine.test.ts -t "accepts assumptions"`. Expected: FAIL.
- [ ] **Step 4: Make the contract, zod and `TAX_SHORT` changes.**
- [ ] **Step 5: Run** `npx vitest run && npx tsc --noEmit`. Expected: all green, no type errors.
- [ ] **Step 6: Commit** `feat(contract): assumptions on scenario, dividend and income tax codes (1.1.0)`.

### Task 2: One rental-business relief switch for SDLT 17% and ATED

**Files:**
- Modify: `engine/rules/sdlt_res.ts`, `engine/rules/ated.ts`, `engine/rules/citations.ts`
- Modify: `engine/index.ts:162-227`
- Modify: `lib/horizon.ts` (drop `atedRelief` row filter; `Assumptions.atedRelief` renamed `rentalRelief`)
- Modify: `app/studio/[id]/page.tsx:190-200, 425-435` (toggle label, re-request the engine on change)
- Test: `engine/__tests__/engine.test.ts`, `lib/__tests__/horizon.test.ts`

**Interfaces:**
- Consumes: `ScenarioInput.assumptions.rental_relief` (Task 1).
- Produces:
  - `sdltRes(price, dwellings, buyerIsCompany, buyerIsNonUk, rentalRelief = false): SdltResResult`. When `rentalRelief` and the 17% case would apply, it prices higher rates (+ non-UK 2 points if set) and returns `tax: "SDLT_RES_HIGHER"`, with a formula ending "(17% rate disapplied: property-rental-business relief)".
  - `ated(price, dwellings, rentalRelief = false)`: when relief applies and the dwelling is over £500k, returns `{ amount: 0, formula: "... £X a year before relief; property-rental-business relief claimed on the yearly return = £0" }`. The row is still emitted so the return obligation shows.
  - `CITE.sdltCorporate = "https://www.gov.uk/guidance/stamp-duty-land-tax-corporate-bodies"` on the relieved SDLT row's rule.
  - Studio label: "Homes let to unconnected tenants (rental-business relief on 17% SDLT and ATED)". Default on, as now.

- [ ] **Step 1: Write failing tests:**
  - `it("£1.1m dwelling, company, relief on -> higher rates 108,750 not 17%")`: expects `SDLT_RES_HIGHER`, `amount_gbp: 108750` (0–125k 5%, 125–250k 7%, 250–925k 10%, 925k–1.1m 15%: 6,250 + 8,750 + 67,500 + 26,250).
  - `it("ATED row is £0 with relief on, 9,450 with relief off")`.
  - `it("relief off reproduces today's golden totals")`: `runEngine({ ...sample, assumptions: { rental_relief: false } }).totals` deep-equals `runEngine(sample).totals`.
- [ ] **Step 2: Run** `npx vitest run engine/__tests__/engine.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the rule params, then pass `input.assumptions?.rental_relief ?? false` through `engine/index.ts`. Replace the "may disapply the 17% rate" info flag: when relief is on, show "17% rate disapplied on the assumption the homes are let to unconnected tenants; relief is withdrawn if that stops within 3 years."
- [ ] **Step 4: Horizon and Studio:** remove the ATED filter in `breakdown`; Studio sends `assumptions.rental_relief` and re-fetches `/api/engine` when the toggle changes. Update `lib/__tests__/horizon.test.ts` cases that relied on the filter.
- [ ] **Step 5: Run** `npx vitest run && npx tsc --noEmit`. Expected: green.
- [ ] **Step 6: Commit** `fix(engine): rental-business relief applies to 17% SDLT and ATED together`.

### Task 3: Keep real investors in structures A, B and D

**Files:**
- Modify: `agent/structures.ts:53-124`
- Modify: `engine/index.ts` (`findBuyer` → `buyersOf`, SDLT buyer tests, rent payers, IHT trust share)
- Modify: `engine/cliffs.ts:368-381` (`withItems` copies the ownership pattern of the first property, not a single buyer edge)
- Test: `agent/__tests__/agent.test.ts`, `engine/__tests__/engine.test.ts`, `engine/__tests__/cliffs.test.ts`

**Interfaces:**
- Produces:
  - `buyersOf(s: Structure): { node: StructNode; share: number }[]`: owners of the first property node with `share = pct / 100`. `findBuyer` stays as "the largest owner" for callers that need one node (labels).
  - SDLT for a property bought by several buyers: `company = buyers.some(isCompany)`, `nonUk = buyers.some((b) => buyerIsNonUk(s, b.node))`. Formula names every buyer.
  - Rent: `rentPayers` runs from each owner of the properties, weighted by `share`.
  - Templates:
    - A with 2+ investors: each investor gets an edge to every property with its `pct`.
    - B: each investor gets an edge to `spv` with its `pct`.
    - D: settlor → trust edge (pct 100), trust → `spv` with the family's `pct`, other investors → `spv` with their `pct`.
    - 0 investors: today's generic `Buyer`.
  - IHT in D: base = `packetPrice × trustShare` where `trustShare` = trust → spv edge pct / 100. Formula states the share.
  - New flag `rule_id: "investor_pct"`, `review`: "Investor shares add up to N%, not 100%."

- [ ] **Step 1: Write failing tests:**
  - Agent: `buildB(packet, [pension 40, fo_nonuk 60])` has edges `inv→spv` pct 40 and 60 and no `buyer` node.
  - Engine: B with a 60% non-UK family office on a £400k home gets the 2% non-UK surcharge (today it doesn't).
  - Engine: A with `uk_company` 50 + `family_office_uk` 50 on a £1.1m home pays the 17% rate (relief off).
  - Engine: D with family 70 / pension 30: IHT entry base is 70% of packet price.
  - Engine: investors 60 + 30 produce the `investor_pct` flag.
  - Engine: no investors gives the same totals as today (Review Focus 2).
- [ ] **Step 2: Run** `npx vitest run agent engine`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** the templates, then `buyersOf` and its use in SDLT, rent and IHT, then `withItems`.
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit`. Expected: green. Update the golden sample if its investors are 2+, and the HANDOFF line.
- [ ] **Step 5: Commit** `fix(structures): keep each investor and their share in A, B and D`.

### Task 4: Tax on rent by who receives it: income tax and dividend tax

**Files:**
- Create: `engine/rules/income_tax.ts`, `engine/rules/dividend_tax.ts`
- Modify: `engine/rules/citations.ts`, `engine/index.ts:229-262`
- Modify: `app/studio/[id]/page.tsx` (toggle "Profits paid out each year", default on)
- Test: `engine/__tests__/engine.test.ts`

**Interfaces:**
- Consumes: `buyersOf`, `rentPayers` (Task 3); `assumptions.distribute_profits` (Task 1).
- Produces:
  - `incomeTaxOnRent(profit: number): { amount; formula }`: flat 45% additional rate, formula says "assumes other income already uses the lower bands". Rule `{ id: "income_tax_rent", citation_url: "https://www.gov.uk/income-tax-rates" }`.
  - `dividendTax(dividend: number, recipient: "individual" | "trust" | "uk_company" | "pension" | "non_uk"): { amount; formula }`: individual 39.35%, trust 39.35%, uk_company 0 (dividend exemption), pension 0, non_uk 0 (no UK tax on dividends to non-residents). Rule `{ id: "dividend_tax", citation_url: "https://www.gov.uk/tax-on-dividends" }`; trust rows cite `"https://www.gov.uk/guidance/trusts-and-income-tax"`.
  - Mapping: a family office receiving rent directly (A, or C through the transparent fund) gets an `INCOME_TAX_RENT` row instead of `CORP_TAX_RENT`. The "taxed as a company" flag is removed. For a non-UK family, the formula notes "non-resident landlord scheme".
  - When `distribute_profits`: for each company paying `CORP_TAX_RENT`, dividend = profit − corporation tax, split by that company's owners' shares. Each owner gets a `DIVIDEND_TAX` row (stage `hold`), with £0 rows kept for transparency.

- [ ] **Step 1: Write failing tests:**
  - `incomeTaxOnRent(100000).amount === 45000`.
  - `dividendTax(81000, "trust").amount === 31873` (81,000 × 39.35% = 31,873.5; dividend and income tax round down, like the IHT rules).
  - D with £108,000 profit: SPV corporation tax 24,870 (27,000 − (250,000 − 108,000) × 3/200 = 27,000 − 2,130), dividend 83,130 to the trust gives a dividend tax row of 32,711 (83,130 × 39.35% = 32,711.66, floor). Build the scenario from rents that give exactly £108,000 profit (rent £144,000, 75%).
  - `distribute_profits: false` gives no `DIVIDEND_TAX` rows and today's totals (Review Focus 4).
  - All lots unpriced gives no income or dividend tax rows (Review Focus 5).
- [ ] **Step 2: Run** `npx vitest run engine`. Expected: FAIL.
- [ ] **Step 3: Implement** the two rule files, then the payer mapping in `engine/index.ts`.
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit`. Expected: green.
- [ ] **Step 5: Commit** `feat(engine): income tax for families on rent, dividend tax when profits are paid out`.

### Task 5: Associated companies in corporation tax

**Files:**
- Modify: `engine/rules/corp_tax.ts`, `engine/index.ts`
- Test: `engine/__tests__/engine.test.ts`

**Interfaces:**
- Produces:
  - `corpTax(profit: number, associated = 0)`: both limits divided by `associated + 1`; the formula states "limits shared with N associated companies".
  - `associatedCompanies(s: Structure, nodeId: string): number`: count of other company-like nodes (`kind === "company"` or `investor_type === "uk_company"`) that control the payer (edge pct > 50), plus companies controlled > 50% by the same controller.

- [ ] **Step 1: Write failing tests:**
  - `corpTax(60000, 1).amount === 14025`. Limits halve to £25k / £125k, so £60k is in the marginal band: 60,000 × 25% = 15,000, less (125,000 − 60,000) × 3/200 = 975.
  - B with a single `uk_company` investor owning 100% of PropCo: the PropCo row formula contains "1 associated company".
  - B with a pension owning 100%: no associated companies.
- [ ] **Step 2: Run** `npx vitest run engine -t "associated"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`. Expected: green.
- [ ] **Step 5: Commit** `fix(engine): corporation tax limits shared with associated companies`.

### Task 6: Structure chart shows flags, edge meaning and fits badges

**Files:**
- Modify: `components/StructureChart.tsx`
- Modify: callers passing `rows` (add `flags`): `app/studio/[id]/page.tsx`, `app/setup/[id]/[option]/page.tsx`, `lib/pdf/report.tsx` if it renders the chart

**Interfaces:**
- Produces:
  - `StructureChart({ structure, rows, flags, large })`, with `flags: Flag[]`.
  - Node: a `!` marker when it has `review` flags, an `i` marker for `info` only. `title` lists the flag messages. Shown on any node whose id matches `flag.entity_id` for the option.
  - Edge label derived from node kinds: investor → trust "settles"; anything → fund "units X%"; anything → company "shares X%"; anything → property "owns" (plus "X%" when < 100).
  - Node height: `NODE_H + 18 × ceil(badges / 2)` passed to dagre, so badges don't overlap.
  - A one-line legend under the chart: "p.a. = every year · * comparator, not a cost of this option".

- [ ] **Step 1: Run the app** (`npm run dev`), open a studio packet with a Scottish or unpriced lot and option D. Screenshot before.
- [ ] **Step 2: Implement** the props, markers, edge labels, height and legend.
- [ ] **Step 3: Verify** with `npx tsc --noEmit` and the same screenshot after: the Scottish lot shows `!`, settlor → trust reads "settles", D's SPV badges don't overlap.
- [ ] **Step 4: Commit** `feat(chart): flags on nodes, edge meaning, room for badges`.

---

## Phase 2: out of scope, each needs a decision first

| Gap | Decision needed |
|---|---|
| Tax on gains at sale (CT on PropCo gain, CGT, non-UK gains, latent-gain discount on share sale) | Growth assumption (% a year) and hold period; whether to model base-cost discount |
| VAT on commercial (option to tax, TOGC, SDLT on VAT-inclusive price) | Data has no VAT status; add a per-lot "opted to tax" input or default assumption? |
| Trust IHT refinements (grossing-up, exit charges, settlor-interested flag) | Who pays the entry charge; whether to model a sale inside the trust |
| LBTT / LTT pricing | Worth it for the demo packets? |
| Linked transactions and one-transaction assumption in the engine | Add `same_seller` to `ScenarioInput` (another contract change) |
| More structures (SPV per property, holdco, non-UK company, LLP, debt) | Which one or two matter for the target investors |
