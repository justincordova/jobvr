# Letter tiers, and poll fixes from the Nov 2026 QA

Implemented Nov 21, 2026. SPEC.md still names the old tiers (S/A/Mid/Startup/
Corporate) and predates these fixes; run sync-docs to fold this in.

## Letter tiers

Company tiers are `S`, `A`, `B`, `C`, `D`, ranked by how good a company is for
a new-grad software engineer: first-year pay first, then engineering quality and
prestige, then size and stability. Startups and big enterprises are placed by the
same measure, so there is no separate "Startup" or "Corporate" tier.

| Tier | Rough new-grad pay | Examples                                                               |
| ---- | ------------------ | ---------------------------------------------------------------------- |
| S    | $200k+             | Google, Meta, OpenAI, Jane Street, Stripe, Databricks, Ramp            |
| A    | $150-200k          | Datadog, Plaid, Coinbase, Dropbox, Vercel, Render, Bloomberg, Mercor   |
| B    | $110-150k          | SoFi, PayPal, Autodesk, Etsy, Oracle, IBM, funded startups with traction |
| C    | $80-110k           | banks, insurers, defense primes, retailers, ADP, unproven startups     |
| D    | weak picks         | staffing and recruiting agencies, IT outsourcers, OPT-only employers, small contractors and consultancies, job boards |

- `UNRATED_TIER` (auto-added companies before the AI rates them, and every new
  company without `OPENAI_API_KEY`) is `C`. The AI's fallback for a company it
  can't place is `D` for a services, staffing or contracting firm, else `C`; an
  acquired company takes its parent's tier.
- Rank points: S 20, A 15, B 10, C 6, D 3, Unlisted 0.
- Migration `0014_letter_tiers` renames stored tiers Mid → B, Startup → C,
  Corporate → D and sets AI-rated (`auto`) companies back to `pending`, so the
  AI rates them again on the new scale. Hand-picked and seed tiers keep their
  mapped letter.
- Old names are still read where they can linger: stored `tiersToTrack`
  (`parseStoredSettings`) and the web app's links and remembered filters
  (`parseFeedSearch`).
- `POST /api/suggestions/:id/add` without a tier creates the company `pending`
  (unrated, for the AI); with one, `manual`.

## Poll fetch loop

- Each source's queue is shuffled every poll (`RunPollOptions.order`; tests fix
  it), so the same broken boards can't always go first and trip the circuit
  breaker.
- Only network errors, timeouts, 5xx and 429 count as transient (toward the
  breaker and outages); an unreadable answer (HTML, schema drift) counts
  against its own board only.
- A board cut off mid-fetch by the poll budget or shutdown is skipped like the
  boards never started: no health change.

## Workable

- A role in several cities is listed once per city under one shortcode: the
  adapter merges them into one listing with every place.
- Posted date: the earlier of `created_at` and `published_on`, so a republished
  role isn't new.
- Invalid items are reported by `shortcode` (`validateItems`' `idKey`), so one
  bad item holds only its own job's closure.
- The account slug is lowercased in API URLs (the API is case-sensitive).

## Company changes

- When a company's ATS changes (or its board is switched off), its old board's
  source rows are marked removed and jobs with no live source left are closed,
  since no poll scans the old board anymore.
- A merge that moves over a board given up on (`manual_only`) keeps it untracked.
