# Add companies automatically; Applied overview

## Problem

The new-grad lists keep naming companies that aren't in the list. Each one
waited under Suggested for a manual "Add", and the tab's badge nagged. The
goal: the polled companies grow on their own, with no manual work.

## Design

- **`runAutoAddCompanies`** (`core/src/auto-add.ts`), a scheduler step right
  after the poll. When "Add companies automatically" (the existing
  `suggestCompanies` setting) is on, it takes the open suggestions whose
  listings point at a Greenhouse, Lever or Ashby board with a known slug, most
  listings first, at most 10 per run.
- Each board is probed first. If it answers with jobs, the suggestion is added
  as a tracked company: tier **Startup** (change it on the Companies page), a
  note naming the lists and the board. Its first poll is a silent baseline, so
  the existing roles don't push.
- A board that errors or has no jobs is retried after a day (an in-memory map
  in the scheduler; a restart retries sooner, which is harmless).
- After adding any, the lists' ETags are cleared, so their next poll refetches
  and their Unlisted jobs pick up the new companies and tiers.
- Skipped: dismissed suggestions, unsupported job sites ("other"), suggestions
  without a slug, and disabled sources. Their jobs keep showing as Unlisted.
- **Web**: the Suggested page is gone (the phone bar goes back to 4 tabs, no
  badge); `/suggested` redirects to Companies. The Settings switch is now
  "Add companies automatically" (on by default). The suggestions API stays;
  it's what the auto-add reads.

## Applied overview

A card at the top of the Applied page, built from every applied job (not the
page's filters): the total, this week vs last week, the current streak (a day
without an application yet today doesn't break it), a 16-week heatmap of
applications per day in the amber signal colour, and the mix by tier.
Applications from before `applied_at` was recorded count in the total only.

## Hands-off companies (automatic tiers, self-healing boards)

Nothing on the Companies page needs a person.

- **Tiers rate themselves.** `companies.tier_source` says where a tier came from:
  `seed` (the starter list), `auto` (the AI rater), `manual` (picked by a
  person, never overwritten) or `pending`. Auto-added and hand-added
  companies start `pending` as Startup; the scheduler's `tiers` step
  (`runAutoTier`) rates them with OpenAI (`OPENAI_API_KEY`, model
  `OPENAI_MODEL`, default `gpt-5-mini` with minimal reasoning) using the name,
  careers link and a few recent titles, and stores a one-line `tier_reason`.
  At most 10 a run and 200 calls a day (about $0.0003 each); a failure is
  retried after an hour. Without a key they stay Startup and say "not rated".
- **Broken boards heal.** The `heal` step (`runHealCompanies`) searches every
  ATS by name for companies in `needs_review` (3 per run, each every 6 h). A
  board with jobs found: the company moves to it. Nothing after 3 days: it
  becomes `manual_only` and its jobs keep coming from the lists.
- **No Track switch.** Every company with a working board is polled (the
  migration turned on the 8 S/A boards the seed had left off).
- **Add by one line.** `POST /api/companies/add { query }` takes a board or
  careers link or a name, finds the board (`boardSlug` on each ATS adapter,
  then slug guesses), and rates the tier right away.
- **Web.** Companies is a read-only list: name (with the AI's reason), tier,
  roles in 30 days, newest role, and one status dot (Checked directly, Via job
  lists, Having trouble, Paused when the tier isn't tracked). The row menu
  changes the tier, hands it back to the AI, opens the careers page or removes
  the company.
- **No job stays Unlisted.** Auto-add also adds list companies without a
  readable board (`manual_only`, "Via job lists") so they get a tier; a board
  that answers with no jobs counts as unreadable, one that doesn't answer is
  retried daily. A name equal to another company's board slug ("Kira" for
  Kira Learning's Ashby `kira`) resolves to that company in polls and
  suggestions, so it isn't added twice.
