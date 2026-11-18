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
  without a slug, and disabled sources. Those stay on the Suggested page.
- **Web**: Suggested leaves the nav (the phone bar goes back to 4 tabs, no
  badge); the page stays at `/suggested`, linked from Settings → New-grad
  lists, where the switch is now called "Add companies automatically".

## Applied overview

A card at the top of the Applied page, built from every applied job (not the
page's filters): the total, this week vs last week, the current streak (a day
without an application yet today doesn't break it), a 16-week heatmap of
applications per day in the amber signal colour, and the mix by tier.
Applications from before `applied_at` was recorded count in the total only.
