# Seed companies

"Verified" = a live or recent posting was found on that board. Confirm each via
the API before seeding; if it fails, mark `needs_review` (don't drop it).
(old) = from a 1–3 year old posting; the ATS may have changed.
Every tier starts tracked (S and A included): every seeded company with a
board is polled (the last 8 S/A boards the seed had left off were turned on in
Nov 2026, and migration 0011 did the same in existing databases). Seeded tiers
are `tier_source = seed`: the AI rater never re-rates them.

This file is the starter list. Since Nov 2026 the list grows on its own:
companies the new-grad lists name are added automatically, rated by the AI
rater (when `OPENAI_API_KEY` is set), and healed when their board breaks (see
"Company upkeep" in `docs/SPEC.md`). Those companies live only in the
database, not in `poller/data/companies.json`. The seed's only SmartRecruiters
board is ServiceNow and its only Workable one Hugging Face (`huggingface`); other companies on them arrive
through auto-add, add by link or name, or the list-boards step.

**Tier names (Nov 21, 2026):** tiers are now letters S, A, B, C, D, ranked by how
good a company is for a new-grad SWE: first-year pay first, then engineering and
prestige, then size and stability (see `INSTRUCTIONS` in `core/src/tiering.ts`).
The log below keeps the names used at the time; migration `0014_letter_tiers`
renamed them Mid → B, Startup → C, Corporate → D, and every company was then
re-rated by hand on the new scale (e.g. Render, Dropbox, Bloomberg → A; IBM,
SoFi → B; banks, insurers and defense primes → C; staffing firms, IT
outsourcers and small contractors → D). `poller/data/companies.json` uses the
letters. ServiceNow moved to SmartRecruiters (`ServiceNow`).

## Greenhouse: verified

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

## Lever: verified

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

## Ashby: verified

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

Run `discover`; if found on a supported ATS, seed with `track = true`
(status ok); otherwise seed as `ats = other`, `manual_only`, `track = false`.
`city`/`state` = the region below (NYC → New York, NY; NJ → state NJ; PA → state PA).

| Region | Mid                                                | Startup                                                                                              | Corporate         |
| ------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------- |
| NYC    | Sigma Computing, Squarespace, Zocdoc, Oscar Health | Traba, Chalk, Loop, Northslope, Enigma, Prelim, PointOne, HIFI, Confido                              | ;                 |
| NJ     | FanDuel, AvePoint, Zinnia, Incedo                  | Apprentice.io                                                                                        | ;                 |
| PA     | FreedomPay, Vistar Media                           | SoftWriters, Journey Robotics, IAM Robotics, Skild AI, Latitude AI, Hellbender, Stack AV, SoundStack | Woolpert, Certara |

## manual_only (unsupported ATS; `ats = other`, track = false, tier Corporate)

Prudential, PNC, Audible, Comcast, Westinghouse, BAE Systems, Ahold Delhaize
USA, Susquehanna/SIG, Bloomberg, MetLife, ASRC Federal, Leidos, Lockheed
Martin, JPMorgan Chase, Verizon, ADP, NJ Transit, Boeing, Vanguard

## Reference only

- Tier S: Stripe, Cursor, Jane Street, HRT, Two Sigma, Citadel
- Tier A: Plaid, Ramp, Brex, Datadog, MongoDB

Seeded with `ats = other`, `manual_only` unless `discover` finds them on a
supported ATS, in which case they get that `ats`/`slug`, status ok, and are
tracked.

## Seeding rules

- Seed is insert-only (never overwrites an existing company, matched by
  normalized name or alias).
- Every seeded company gets `tier_source = seed`.
- Verified/"Find slug" tables: `city` = the Location column verbatim (e.g.
  "Pittsburgh/NYC", "NYC/Remote"); `state` = the states it implies, `/`-joined
  in the same order (NYC → NY, Philadelphia/Pittsburgh → PA; "Remote" adds
  nothing), e.g. "PA/NY", "NY".
- manual_only and Reference-only companies: `city`/`state` null.
- "Find slug" companies: `discover` finds the slug → status ok; not found →
  kept with the listed ATS, no slug, `track = false`, `needs_review`.
- Verified/"(old)" entries: `probe` the slug; responds → status ok; fails →
  `needs_review` (kept, never dropped). The "(old)" marker is dropped from the slug.
- `track = true` unless the company is `manual_only` / has no slug, or the
  entry says `"track": false` (then false; only Two Sigma and Citadel, both
  `other`).
- One update rule: a company still stored as `ats = other` + `manual_only`
  whose seed entry now names a supported board is moved to that board
  (tracked, status ok) when its `probe` answers. This is how seed fixes reach
  an existing database; nothing else about existing companies is changed.

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

## Added Nov 2026 (QA cross-check)

Companies whose new-grad SWE roles in NYC/NJ/PA/Remote-US showed up on the
2027-SWE-College-Jobs list but weren't tracked. Each board was checked live
before adding: SeatGeek (`seatgeek`), Clear Street (`clearstreet`), Garner
Health (`garnerhealth`), DV Trading (`dvtrading`), Five Rings
(`fiveringsllc`), HelloFresh (`hellofresh`), TeleTracking
(`teletrackingtechnologiesinc`), Abnormal AI (`abnormalsecurity`),
Smartsheet (`smartsheet`), Affirm (`affirm`), StubHub (`stubhubinc`) on
Greenhouse; Meow (`meow`), Spruce (`spruceid`), Quora (`quora`), Madhive
(`madhive`) on Ashby. Lumos (Ashby `lumos`) was skipped: its only nearby role
is "Remote - East Coast", which the Remote-US rule doesn't accept.

## Added Nov 2026 (wider board scan)

All ~470 Greenhouse/Lever/Ashby boards listed in New-Grad-Jobs' `config.yml`
(MIT) were fetched and run through jobvr's own rules (location, title, store
window, experience). The 31 boards with at least one job that would show in
the feed were added, tiered by judgment (notes say where they came from):
OpenAI, Anthropic (S); Coinbase, Notion, Airbnb, Robinhood, Reddit, DoorDash,
DRW, ElevenLabs, Mercury, Cohere (A); GitLab, Betterment, Tailscale,
PlanetScale, ClickHouse, Flow Traders, Pinecone, Vultr, CentralReach (Mid);
NICE, ALTEN Technology USA, PAR Technology (Corporate); Baseten, Mercor,
Fluidstack, Safe Security, Rox Data Corp, Swarm Aero, ATOMS (Startup).
Skipped: BJAK (posts each role in 100+ countries), and boards whose only
matches were titles the rules now reject (Roblox contract role, Justworks GTM,
Airbyte support, Proconex services).

## manual_only audit (Nov 2026)

Every `manual_only` company's careers site was checked for the system behind
it. Fixed in `companies.json` (the seed moves an existing manual-only company
to its board, see Seeding rules):

- Greenhouse: HRT (`wehrtyou`, now tracked), Oscar Health (`oscar`), Enigma
  (`enigmaio`), Apprentice.io (`apprentice`), Skild AI (`skildai-careers`).
- Ashby: Vistar Media (`vistar`).
- New: OpenAI Deployment Company (Ashby `openai-deployment-company`, tier S).
  northslopetech.com now redirects to it; Northslope stays manual only.

Still manual only, and why:

| System                    | Companies                                                                                                                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Workday                   | Boeing (`boeing.wd1/EXTERNAL_CAREERS`), Comcast (`comcast.wd115/comcast_careers`), PNC (`pnc.wd5/External`), Prudential (`pru.wd5/Careers`), Vanguard (`vanguard.wd5/vanguard_external`), Verizon (`verizon.wd12/verizon-careers`), Leidos (`leidos.wd5/External`) |
| Avature                   | Bloomberg, Two Sigma, MetLife                                                                                                                                                                                                                                      |
| Oracle Cloud HCM          | JPMorgan Chase, NJ Transit                                                                                                                                                                                                                                         |
| iCIMS                     | Susquehanna/SIG, Certara                                                                                                                                                                                                                                           |
| Other                     | Westinghouse (SuccessFactors), ASRC Federal (Dayforce), Lockheed Martin (Eightfold/BrassRing), Audible (Amazon Jobs), BAE Systems (Phenom), Loop (Rippling), IAM Robotics (now Onward Robotics, Paycom), Graphite (joined Cursor), Trayd (Gem)                     |
| Blocks automated requests | Citadel (403), ADP (403)                                                                                                                                                                                                                                           |
| No board found            | Ahold Delhaize USA, Incedo, Journey Robotics, SoftWriters, Northslope                                                                                                                                                                                              |

A Workday adapter was built and dropped: Workday's public JSON API covers 7 of
these companies, but its Cloudflare front end answers Node's HTTP client with
a bot challenge (`cf-mitigated: challenge`, HTTP 429) even for one request, and
getting around that is off limits. Leidos would also need 60+ pages per poll.

## New-grad lists (Nov 2026)

Most mid-size and large companies post on systems jobvr can't read, so
"Mid" jobs were rare. Public GitHub lists name many of them:

| List                                        | Rows | NY/NJ/PA/Remote | Notes                                                                                  |
| ------------------------------------------- | ---- | --------------- | -------------------------------------------------------------------------------------- |
| SimplifyJobs/New-Grad-Positions             | 19k  | (in use)        | JSON with ids                                                                          |
| speedyapply/2027-SWE-College-Jobs           | 913  | 115             | Links go to the postings. Added: first poll +43 new jobs, 16 merged into existing ones |
| jobright-ai/2026-Software-Engineer-New-Grad | 641  | 61              | Links go to jobright.ai pages (dedupe by company + title). Added: +53 new, 12 merged   |
| vanshb03/New-Grad-2027                      | 2080 | 373             | Not added: see below                                                                   |

After both (and matching "Palantir Technologies" to Palantir), the feed went
from 174 to 262 rows (89 new: 66 Unlisted, 10 Corporate, 5 S, 5 A, 3 Mid; 51
with a Jobright row, 41 with a SpeedyApply row). Most Unlisted ones are mid-size and large
companies not on the list yet (Palantir, American Express, Pinterest, IBM,
BMO, D. E. Shaw, Priceline, Vanguard, Highmark Health); they showed under
Suggested then (auto-add now adds them, and the AI rater tiers them), and
tiering them is what makes "Mid" jobs show as Mid. Abnormal
Security is now listed as Abnormal AI (its new name, which the lists use; the
Greenhouse slug is still `abnormalsecurity`).

vanshb03 was measured and left out: its titles are rewritten ("New Grad 2027:
Junior Forward Deployed Software Engineer"), so they don't dedupe by title;
its links are `go.vansh.nyc` redirects, so they don't dedupe by URL without a
request per row; multi-city rows hide their places in `<details>` blocks. Of
its 373 NY/NJ/PA/Remote rows only 75 were posted in November, and those
sampled (CrossCountry, Empire State Realty Trust, Bask Health, Citi) were
already in the feed.

## Suggested backlog (Nov 2026)

Before auto-add replaced the Suggested page, the 42 open suggestions were
triaged by hand:

- Added and tracked (board found): Shield AI (A, Ashby `shield`; the
  suggestion carried an Ashby board id instead), Kalshi (A), Ande, Discernis,
  Alchemi, Pure, Sola (Startup), CrossCountry Consulting, RainFocus (Mid),
  Empire State Realty Trust (Corporate).
- Added as manual only (no supported board; tiered so their SimplifyJobs jobs
  get a tier): Google, NVIDIA (S); Amazon, Microsoft, Salesforce (A); H2O.ai,
  Aerotech, Akamai Technologies, Cisco, Guidewire, Innovative Defense
  Technologies, Magnite, Wyetech, ZT Systems (Mid); Bask Health, Empowerly,
  ShadowDragon (Startup); General Dynamics Mission Systems, 84 Lumber, Citi,
  GHD (Corporate).
- Dismissed: Memorial Hermann (hospital IT in Houston), Pragmatike (recruiting
  agency), Star Mountain Capital (finance systems), eClerx (outsourcing),
  Techstra Solutions and All Lines Technology (staffing/consulting).
- Left open (unclear): Lumaril, Multi Media, Natuvion, neurohire.ai, Orbis
  Operations.

## Tier list (Nov 2026)

Tiers follow a personal S/A/B/C list: **Mid is the B tier** (solid product,
enterprise and fintech SWE companies) and **Corporate is the C tier**
(traditional enterprise, less tech-centric). Where the list names a company
twice, the higher tier wins, except where it is placed explicitly (Twilio,
Workday, Duolingo, Toast and Chime are A; Affirm is B). Names follow the
new-grad lists ("Expedia Group", "Veeva Systems", "IMC Trading", "Perplexity
AI") so their jobs match by name.

- Re-tiered: Microsoft, Amazon, Airbnb, Ramp, Susquehanna/SIG → S; Affirm,
  ADP → Mid. The seed is insert-only, so the PC database was updated by hand.
- Added and tracked (board checked live): Databricks, xAI, Scale AI,
  Cloudflare, Figma, Roblox, Jump Trading, IMC Trading (`imc`) on Greenhouse;
  Perplexity AI, Snowflake on Ashby (S). Twilio, Pinterest, Okta, Vercel,
  Gusto, Samsara, Toast, Chime, Anduril (`andurilindustries`) on Greenhouse;
  Spotify on Lever (A). Dropbox, Asana, Box (`boxinc`), New Relic, Elastic,
  GoDaddy, SoFi, Block, Riot Games, Epic Games, Nasdaq on Greenhouse; Bumble
  (`bumbleinc`), Snyk on Ashby; Match Group, Veeva Systems (`veeva`), Wattpad
  on Lever (Mid).
- Added as manual only (no supported board; tiered so list jobs get a tier):
  Meta, Apple, Netflix, Google DeepMind, Uber, LinkedIn, Optiver, Citadel
  Securities (S); Adobe, Atlassian, HubSpot, Shopify, Snap, Workday,
  ServiceNow, Palo Alto Networks, CrowdStrike, Rippling, Hugging Face (A);
  Etsy, Zillow, Wayfair, Expedia Group, Chewy, Indeed, Yelp, Shutterstock,
  Zoom, Zendesk, Oracle, IBM, F5, Dynatrace, Confluent, Autodesk, Docusign,
  Pegasystems, SAS, Verisk, PayPal, Marqeta, Remitly, BILL, LendingClub,
  Fiserv, Global Payments, NCR Voyix, Fidelity Investments, Current,
  Electronic Arts, Zynga, S&P Global, Moody's, FactSet, Broadridge (Mid);
  Chubb, BlackRock, American Express (Corporate).
- Rejected `discover` hits: Lever `linkedin` (a test board), Greenhouse
  `current` (a digital agency) and `sas` (security hardware); Greenhouse
  `optiver` and `indeed`, Ashby `confluent` and Lever `docusign` have no jobs,
  so they can't be confirmed.
