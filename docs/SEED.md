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

Run `discover`; if found on Greenhouse/Lever/Ashby, seed with `track = true`;
otherwise seed as `manual_only`.

- NYC: Traba, Chalk, Loop, Sigma Computing, Northslope, Squarespace, Zocdoc,
  Oscar Health, Enigma, Prelim, PointOne, HIFI, Confido
- NJ: FanDuel, AvePoint, Zinnia, Incedo, Apprentice.io
- PA: SoftWriters, Journey Robotics, IAM Robotics, Skild AI, Latitude AI,
  Hellbender, Stack AV, Woolpert, SoundStack, Certara, FreedomPay, Vistar Media

## manual_only (unsupported ATS; track = false)

Prudential, PNC, Audible, Comcast, Westinghouse, BAE Systems, Ahold Delhaize
USA, Susquehanna/SIG, Bloomberg, MetLife, ASRC Federal, Leidos, Lockheed
Martin, JPMorgan Chase, Verizon, ADP, NJ Transit, Boeing, Vanguard

## Reference only (S/A, track = false)

Stripe, Plaid, Ramp, Brex, Datadog, MongoDB, Cursor, Jane Street, HRT,
Two Sigma, Citadel
