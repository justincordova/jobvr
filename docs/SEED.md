# Seed companies

"Verified" = a live or recent posting was found on that board. Confirm each via
the API before seeding; if it fails, mark `needs_review` (don't drop it).
(old) = from a 1–3 year old posting; the ATS may have changed.
S/A tiers start with `track = false`.

## Greenhouse — verified

| Slug | Name | Location | Tier |
|---|---|---|---|
| perpay | Perpay | Philadelphia | Startup |
| duolingo | Duolingo | Pittsburgh/NYC | A |
| govini | Govini | Pittsburgh | Startup |
| airtable | Airtable | NYC | Mid |
| harmonic | Harmonic | NYC | Startup |
| thenewyorktimes | NYT | NYC | Mid |
| greenhouse | Greenhouse Software | NYC/Remote | Mid |
| valon (old) | Valon | NYC | Startup |
| permutive (old) | Permutive | NYC | Startup |
| braze (old) | Braze | NYC | Mid |
| thirtymadison (old) | Thirty Madison | NYC | Startup |
| redpandadata (old) | Redpanda | NYC/Remote | Startup |

Find slug: Aurora Innovation (Pittsburgh, Mid), Yext (NYC, Mid)

## Lever — verified

| Slug | Name | Location | Tier |
|---|---|---|---|
| gopuff | Gopuff | Philadelphia | Mid |
| secureframe | Secureframe | NYC | Startup |
| ladders | Ladders | NYC/Philadelphia/Remote | Mid |
| BlueMatrix | BlueMatrix | NYC/Remote | Mid |
| findigs | Findigs | NYC | Startup |
| regalvoice | Regal | NYC | Startup |
| getduranta | Duranta | NYC | Startup |
| RadicalAI | Radical AI | NYC | Startup |
| seekai | Seek AI | NYC | Startup |
| palantir | Palantir | NYC | S |

## Ashby — verified

| Slug | Name | Location | Tier |
|---|---|---|---|
| harvey | Harvey | NYC | A |
| category-labs | Category Labs | NYC | Startup |
| eagle | Eagle | NYC | Startup |
| permitflow | PermitFlow | NYC | Startup |
| norm-ai | Norm Ai | NYC | Startup |
| parabola-io | Parabola | NYC | Startup |
| office-hours | Office Hours | NYC | Startup |
| trayd | Trayd | NYC | Startup |
| livekit | LiveKit | NYC/Remote | Startup |
| ashby | Ashby | NYC/Remote | Mid |

Find slug: EliseAI (NYC, Startup), Ellipsis Labs (NYC, Startup), Gecko Robotics
(Pittsburgh, Startup), Rilla (NYC, Startup), Graphite (NYC, Startup),
Astronomer (NYC, Mid)

## Research

Run `discover`; if found on Greenhouse/Lever/Ashby, seed with `track = true`
(status ok); otherwise seed as `ats = other`, `manual_only`, `track = false`.
`city`/`state` = the region below (NYC → New York, NY; NJ → state NJ; PA → state PA).

| Region | Mid | Startup | Corporate |
|---|---|---|---|
| NYC | Sigma Computing, Squarespace, Zocdoc, Oscar Health | Traba, Chalk, Loop, Northslope, Enigma, Prelim, PointOne, HIFI, Confido | — |
| NJ | FanDuel, AvePoint, Zinnia, Incedo | Apprentice.io | — |
| PA | FreedomPay, Vistar Media | SoftWriters, Journey Robotics, IAM Robotics, Skild AI, Latitude AI, Hellbender, Stack AV, SoundStack | Woolpert, Certara |

## manual_only (unsupported ATS; `ats = other`, track = false, tier Corporate)

Prudential, PNC, Audible, Comcast, Westinghouse, BAE Systems, Ahold Delhaize
USA, Susquehanna/SIG, Bloomberg, MetLife, ASRC Federal, Leidos, Lockheed
Martin, JPMorgan Chase, Verizon, ADP, NJ Transit, Boeing, Vanguard

## Reference only (track = false)

- Tier S: Stripe, Cursor, Jane Street, HRT, Two Sigma, Citadel
- Tier A: Plaid, Ramp, Brex, Datadog, MongoDB

Seeded with `ats = other`, `manual_only` unless `discover` finds them on a
supported ATS, in which case they get that `ats`/`slug`, status ok, and stay
`track = false` (S/A rule).

## Seeding rules

- Seed is insert-only (never overwrites an existing company, matched by
  case-insensitive name).
- Verified/"(old)" entries: `probe` the slug; responds → status ok; fails →
  `needs_review` (kept, never dropped). The "(old)" marker is dropped from the slug.
- `track = true` unless the tier is S or A (then false), or the company is
  `manual_only` / has no slug (then false).
