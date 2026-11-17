# Seed companies

"Verified" = a live or recent posting was found on that board. Confirm each via
the API before seeding; if it fails, mark `needs_review` (don't drop it).
(old) = from a 1–3 year old posting; the ATS may have changed.
Every tier starts tracked (S and A included).

## Greenhouse — verified

| Slug                | Name                | Location       | Tier    |
| ------------------- | ------------------- | -------------- | ------- |
| perpay              | Perpay              | Philadelphia   | Startup |
| duolingo            | Duolingo            | Pittsburgh/NYC | A       |
| govini              | Govini              | Pittsburgh     | Startup |
| airtable            | Airtable            | NYC            | Mid     |
| harmonic            | Harmonic            | NYC            | Startup |
| thenewyorktimes     | NYT                 | NYC            | Mid     |
| greenhouse          | Greenhouse Software | NYC/Remote     | Mid     |
| valon (old)         | Valon               | NYC            | Startup |
| permutive (old)     | Permutive           | NYC            | Startup |
| braze (old)         | Braze               | NYC            | Mid     |
| thirtymadison (old) | Thirty Madison      | NYC            | Startup |
| redpandadata (old)  | Redpanda            | NYC/Remote     | Startup |

Find slug: Aurora Innovation (Pittsburgh, Mid), Yext (NYC, Mid)

## Lever — verified

| Slug        | Name        | Location                | Tier    |
| ----------- | ----------- | ----------------------- | ------- |
| gopuff      | Gopuff      | Philadelphia            | Mid     |
| secureframe | Secureframe | NYC                     | Startup |
| ladders     | Ladders     | NYC/Philadelphia/Remote | Mid     |
| BlueMatrix  | BlueMatrix  | NYC/Remote              | Mid     |
| findigs     | Findigs     | NYC                     | Startup |
| regalvoice  | Regal       | NYC                     | Startup |
| getduranta  | Duranta     | NYC                     | Startup |
| RadicalAI   | Radical AI  | NYC                     | Startup |
| seekai      | Seek AI     | NYC                     | Startup |
| palantir    | Palantir    | NYC                     | S       |

## Ashby — verified

| Slug          | Name          | Location   | Tier    |
| ------------- | ------------- | ---------- | ------- |
| harvey        | Harvey        | NYC        | A       |
| category-labs | Category Labs | NYC        | Startup |
| eagle         | Eagle         | NYC        | Startup |
| permitflow    | PermitFlow    | NYC        | Startup |
| norm-ai       | Norm Ai       | NYC        | Startup |
| parabola-io   | Parabola      | NYC        | Startup |
| office-hours  | Office Hours  | NYC        | Startup |
| trayd         | Trayd         | NYC        | Startup |
| livekit       | LiveKit       | NYC/Remote | Startup |
| ashby         | Ashby         | NYC/Remote | Mid     |

Find slug: EliseAI (NYC, Startup), Ellipsis Labs (NYC, Startup), Gecko Robotics
(Pittsburgh, Startup), Rilla (NYC, Startup), Graphite (NYC, Startup),
Astronomer (NYC, Mid)

## Research

Run `discover`; if found on Greenhouse/Lever/Ashby, seed with `track = true`
(status ok); otherwise seed as `ats = other`, `manual_only`, `track = false`.
`city`/`state` = the region below (NYC → New York, NY; NJ → state NJ; PA → state PA).

| Region | Mid                                                | Startup                                                                                              | Corporate         |
| ------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------- |
| NYC    | Sigma Computing, Squarespace, Zocdoc, Oscar Health | Traba, Chalk, Loop, Northslope, Enigma, Prelim, PointOne, HIFI, Confido                              | —                 |
| NJ     | FanDuel, AvePoint, Zinnia, Incedo                  | Apprentice.io                                                                                        | —                 |
| PA     | FreedomPay, Vistar Media                           | SoftWriters, Journey Robotics, IAM Robotics, Skild AI, Latitude AI, Hellbender, Stack AV, SoundStack | Woolpert, Certara |

## manual_only (unsupported ATS; `ats = other`, track = false, tier Corporate)

Prudential, PNC, Audible, Comcast, Westinghouse, BAE Systems, Ahold Delhaize
USA, Susquehanna/SIG, Bloomberg, MetLife, ASRC Federal, Leidos, Lockheed
Martin, JPMorgan Chase, Verizon, ADP, NJ Transit, Boeing, Vanguard

## Reference only (track = false)

- Tier S: Stripe, Cursor, Jane Street, HRT, Two Sigma, Citadel
- Tier A: Plaid, Ramp, Brex, Datadog, MongoDB

Seeded with `ats = other`, `manual_only` unless `discover` finds them on a
supported ATS, in which case they get that `ats`/`slug`, status ok, and are
tracked.

## Seeding rules

- Seed is insert-only (never overwrites an existing company, matched by
  normalized name).
- Verified/"Find slug" tables: `city` = the Location column verbatim (e.g.
  "Pittsburgh/NYC", "NYC/Remote"); `state` = the states it implies, `/`-joined
  in the same order (NYC → NY, Philadelphia/Pittsburgh → PA; "Remote" adds
  nothing), e.g. "PA/NY", "NY".
- manual_only and Reference-only companies: `city`/`state` null.
- "Find slug" companies: `discover` finds the slug → status ok; not found →
  kept with the listed ATS, no slug, `track = false`, `needs_review`.
- Verified/"(old)" entries: `probe` the slug; responds → status ok; fails →
  `needs_review` (kept, never dropped). The "(old)" marker is dropped from the slug.
- `track = true` unless the company is `manual_only` / has no slug (then false).

## Discover results (2026-11-13)

`pnpm discover` was run on every list above; `poller/data/companies.json` holds
the outcome. Hits were spot-checked against job locations before use.

- Moved ATS: Valon → Ashby `valon`, Permutive → Ashby `permutive`.
- Find slug: Yext (Greenhouse `yext`), EliseAI (Ashby `eliseai`), Ellipsis Labs
  (Ashby `ellipsislabs`), Gecko Robotics (Ashby `gecko-robotics`), Rilla (Ashby
  `rilla`), Astronomer (Ashby `astronomer`). Not found at first: Aurora
  Innovation and Graphite (`graphitehq` is an unrelated SEO agency). Resolved
  Nov 2026: Aurora posts on Ashby as `aurora-operations-inc`; Graphite joined
  Cursor (Dec 2025) and is `manual_only`.
- Research found: Sigma Computing, Squarespace, Zocdoc, FanDuel, AvePoint,
  Zinnia, Latitude AI (`latitude`), Hellbender (`hellbenderinc`), Stack AV,
  Woolpert (Greenhouse); Traba, Chalk, Prelim, PointOne, HIFI, Confido (Ashby);
  FreedomPay, SoundStack (Lever). The rest are `manual_only`. Journey Robotics
  is `manual_only` (the `journey` board is an architecture firm).
- S/A tiers found (tracked since Nov 2026): Stripe, Jane Street, Brex, Datadog,
  MongoDB (Greenhouse); Cursor, Plaid, Ramp (Ashby). HRT's Ashby board has no jobs and
  isn't confirmed, so HRT stays `manual_only`.
- The last seven 404s, resolved Nov 2026 from each company's careers page:
  - Govini rebranded to **Air** (June 2026): Greenhouse `air`.
  - Harmonic (harmonic.ai, NYC): Ashby `harmonic-ai` (the Ashby `harmonic`
    board is a different Palo Alto company).
  - Thirty Madison was acquired by **Remedy**: Greenhouse `remedy`.
  - Redpanda: Ashby `redpanda-data`.
  - Regal: Lever `regal.ai` (the slug contains a dot; `regalvoice` is gone).
  - Trayd (buildtrayd.com) hires through Gem, which isn't supported:
    `manual_only` with its careers URL.
  - Seek AI was acquired by IBM (2025): removed.
