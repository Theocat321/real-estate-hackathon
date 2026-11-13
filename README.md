# Structure Studio

**Explore who should own a UK property portfolio, what the modeled tax consequences are, and which questions need a specialist.**

Structure Studio is a real estate hackathon prototype for comparing four ways to hold a packet of properties. Start with your own listings CSV or sale brochures, or search the included property data for a starting lot. The app builds a packet, draws each ownership chain, calculates supported tax rules, exposes the source behind each figure, and produces a PDF or an adviser brief.

> **Decision support, not tax advice.** The calculations are simplified scenarios, not a complete transaction model or a recommendation to use a particular structure. Confirm the facts, current rules, reliefs, transaction documents, and investor circumstances with qualified advisers before acting.

## At a glance

- **Bring properties in:** upload a listings or auction CSV, one or more sale brochure PDFs, or search the bundled data. A PDF may contain multiple lots. The upload endpoint accepts files up to 20 MB each.
- **Keep a trail to the source:** extracted brochure values carry page numbers and excerpts; CSV values carry row references. Unverifiable PDF fields are dropped with warnings. Users can supply a missing price, marked as a user-entered source.
- **Compare ownership:** direct purchase (**A**), a UK property company (**B**), a fund above that company (**C**), or a family discretionary trust above it (**D**).
- **Inspect the calculation:** a deterministic TypeScript engine returns cost rows with amounts, formulas, input sources, rule identifiers, and citation links. Grok may extract document facts and write short rationales; it does not calculate tax figures.
- **Explore alternatives:** compare purchase, 10-year and 25-year views; inspect nearby tax thresholds; add residential lots to explore the six-dwelling rule; or optimise the lots and purchase groups under explicit assumptions.
- **Take the next step:** download a PDF report or copy an adviser brief with setup steps, roles, and review flags.

## The workflow

```text
CSV / sale brochures / property search
                 │
                 ▼
       sourced property packet
                 │
                 ├── optional matching, top-up, optimisation
                 ▼
    four ownership graphs (A–D)
                 │
                 ▼
       deterministic tax engine
                 │
                 ├── comparison and source drawer
                 ├── threshold and scenario prompts
                 ├── PDF report
                 └── setup steps and adviser brief
```

1. **Choose the properties.** The landing page accepts CSV, PDF, or text uploads and has a property search. It processes multiple PDFs in sequence and combines distinct extracted lots. The search path finds similar lots using property use, nation, postcode area, type, price band, and available yield information.
2. **Review the packet.** Check each lot's address, use, price, rent, yield, and source. A missing price can be entered before building an upload packet; otherwise that property is flagged and omitted from priced calculations.
3. **Compare structures.** The studio draws the ownership graph, attaches tax rows to the relevant entities, and shows assumptions and review flags. The two UI investor presets are a UK pension fund and a non-UK family office.
4. **Explore the decision.** Change the holding period, inspect the threshold prompts, or run the packet optimiser. The setup page turns a selected option into practical steps and an adviser brief.

Packets and optimisation plans are stored in browser `sessionStorage`. A direct link to a packet will work only in the browser session that created it; there is no account-backed packet persistence in this prototype.

## The four modeled structures

| Option | Ownership chain | What it illustrates |
| --- | --- | --- |
| **A — Direct** | Buyer → each property | The buyer acquires the lots directly. |
| **B — UK SPV** | Buyer → PropCo Ltd → properties | One UK company holds the portfolio. |
| **C — Fund** | Investors → fund → PropCo Ltd → properties | A fund pools investors above the company. The template uses a UK RIF when all investors are UK and a Jersey JPUT otherwise. |
| **D — Family trust** | Settlor → UK discretionary trust → PropCo Ltd → properties | A family trust scenario with modeled inheritance-tax entry and ten-year charges. It is illustrative when no family investor is selected. |

The graph templates are built in code. Grok can supply a short, number-free rationale for each option; a fixed rationale is used if that call fails.

## What the numbers mean

The engine currently models these categories for its **2026–27 rule set**:

- **On acquisition:** non-residential SDLT, residential SDLT including the higher-rate and company 17% paths where applicable, and a modeled inheritance-tax entry charge for option D.
- **While holding:** Annual Tax on Enveloped Dwellings (ATED) where the implemented conditions apply, and the trust's ten-year charge.
- **On an illustrative exit:** stamp duty on a sale of PropCo shares. This is displayed separately from the holding-period comparison.
- **For comparison:** an inheritance-tax death comparator used in the 25-year family-investor view. It is a hypothetical comparator, not a charge levied on the trust.

Every `CostRow` names its stage, tax code, amount, formula, inputs and input sources, and a dated rule citation. The engine also emits `info` and `review` flags for circumstances that require interpretation. Rule implementations and citations live in [`engine/rules/`](engine/rules/) and [`engine/rules/citations.ts`](engine/rules/citations.ts).

The studio's **purchase** view sums acquisition rows. Its **10-year** and **25-year** views add annual modeled charges for the selected number of years and trust charges for completed ten-year periods. The 25-year view also includes the death comparator for non-trust options when a family investor is selected. These views do **not** include exit costs. The packet optimiser uses a separate, default **five-year** objective: acquisition tax plus five years of modeled annual charges, expressed as a share of selected property price.

### Scope and limitations

- SDLT is priced for **England and Northern Ireland**. Scottish LBTT and Welsh LTT are not implemented. Matching rejects Scottish and Welsh seeds; an uploaded lot in either nation receives a review flag rather than an SDLT amount.
- A missing purchase price cannot be costed. Guide, asking, and achieved prices are source facts, not proof of the eventual transaction price.
- Linked transactions, available reliefs, buyer residence, company control, trust eligibility, prior gifts, and fund elections can change the result. The app flags some of these questions; it does not resolve the underlying legal or factual test.
- The six-or-more-dwellings calculation assumes qualifying homes are bought in **one transaction**. The top-up and threshold tools are scenario explorations, not evidence that properties share a seller or can be bought together.
- The comparison does not price financing, corporation or income tax, capital gains, VAT, legal and fund setup fees, running fees, appreciation, rent growth, or the next buyer's SDLT. Do not read “lowest” in the UI as lowest total economic cost.
- Brochure extraction uses a PDF text layer. Scanned or image-only PDFs may yield little usable text. The extractor checks claimed page excerpts against extracted text; review the original document before relying on a field.
- The included property rows are research/demo inputs. Check their dates, availability, permissions, and transaction details independently.

## Run locally

You need Node.js and npm, plus one of the Grok modes below for PDF extraction. The CSV search, mapping, ownership templates, and tax engine are code-driven; a missing Grok call falls back to template rationales.

```bash
git clone https://github.com/Theocat321/real-estate-hackathon.git
cd real-estate-hackathon
npm ci
cp .env.example .env
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). For the simplest start, leave Supabase variables blank; the server will read the included CSV files into an in-memory property index. Then search for a property or upload a supported CSV.

For live brochure extraction, set `XAI_API_KEY` in `.env`. `XAI_MODEL` is optional and defaults to `grok-4`. On macOS, `GROK_TRANSPORT=grokbot` can route requests through a signed-in Grok Bot desktop app instead; see [`agent/bot/skill/SKILL.md`](agent/bot/skill/SKILL.md) and [`agent/bot/setup-grokbot.ts`](agent/bot/setup-grokbot.ts) for that integration. The `.env.example` file lists the supported settings. Never commit a populated `.env` file.

`DEMO_MODE=1` uses only matching responses already present in `fixtures/cache/` and the in-memory CSV index. It makes no Grok network call; a cache miss returns an error. Prewarm the exact brochures and prompts you intend to demonstrate while live mode is enabled. A different PDF or prompt may have a different cache key.

### Optional Supabase store

The project can query a Supabase `properties` table instead of the in-memory index. Apply [`supabase/schema.sql`](supabase/schema.sql), set `NEXT_PUBLIC_SUPABASE_URL` and a Supabase key, then load the bundled data with a server-side service role key:

```bash
npx tsx data/load.ts --dry-run
npx tsx data/load.ts
```

The first command reports mapping counts without writing. The second upserts rows only when `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set. Keep the service role key server-side. `DEMO_MODE=1` always selects the in-memory data path.

## Data and provenance

The bundled [`data/raw/`](data/raw/) directory contains `listings.csv` and `auction-results.csv`. The committed [`data/COUNTS.md`](data/COUNTS.md) reports **9,426 mapped rows** from those files at its generation date, including **8,120 with a price**, **1,131 with annual rent**, and **246 with a yield**. Those counts describe the bundled snapshot; run the dry-run loader to recount after changing the files.

[`lib/mapping/`](lib/mapping/) normalises raw rows into the shared `Property` contract. Values that enter the UI or engine carry a `SourceRef` with a file and row, PDF page and excerpt, user entry, or rule citation as appropriate. Matching is deterministic and excludes unpriced candidates, unknown property types, and residential land or similar non-dwelling lots. The seed itself is retained in the packet.

## API and code map

All HTTP endpoints are Next.js route handlers under `app/api/`. The shared request and response types are in [`contracts/index.ts`](contracts/index.ts).

| Endpoint | Role |
| --- | --- |
| `GET /api/properties` | Search the configured property store by text and optional use. |
| `POST /api/extract` | Accept one multipart `file`; map a CSV, extract PDF lots, or parse an investor list. |
| `POST /api/match` | Build a packet around a property ID. `n` defaults to five and is capped at eight before any dwelling top-up. |
| `POST /api/topup` | Add eligible residential lots from the store to reach six homes where available. |
| `POST /api/structures` | Return the four ownership graphs and short rationales. |
| `POST /api/engine` | Validate a `ScenarioInput` and return cost rows, flags, and totals. |
| `POST /api/cliffs` | Re-run the engine around supported price, dwelling, and nil-rate-band thresholds. |
| `POST /api/optimise` | Search lot subsets and up to three purchase groups under the supplied assumptions. |
| `POST /api/export` | Render a PDF from a packet, structures, and engine result. |

The main implementation areas are:

- [`app/`](app/) and [`components/`](components/): upload, packet, studio, setup, source drawer, charts, and PDF download UI.
- [`agent/`](agent/): CSV/PDF extraction, verified brochure citations, Grok transport and cache, ownership templates, and optional bot CLI.
- [`engine/`](engine/): pure calculation rules, scenario comparisons, threshold search, and the subset optimiser.
- [`lib/`](lib/): typed API client, CSV mapping, property store, holding-period summaries, adviser setup content, and PDF rendering.
- [`fixtures/`](fixtures/): sample scenarios and precomputed Grok responses for reproducible demos and tests.

## Development checks

```bash
npm run typecheck
npm test
npm run build
```

The Vitest suite covers extraction and citation checks, property mapping and matching, the rule engine, threshold prompts, optimiser behavior, and bot parsing. Tests use fixtures or injected transports rather than making live Grok calls.

## Optional bot CLI

With the web app running, the bot CLI can build a packet from an ID or address, or explain one of its ownership options:

```bash
npx tsx agent/bot/cli.ts "build packet from allsop-6392cf9c"
npx tsx agent/bot/cli.ts "explain option D"
```

The CLI calls the app's APIs and checks explanation figures against engine output. `explain option` uses the last packet built by the CLI. Set `STUDIO_URL` if the app is not at `http://localhost:3000`. See the [bot skill instructions](agent/bot/skill/SKILL.md) for command details and Grok Bot registration.
