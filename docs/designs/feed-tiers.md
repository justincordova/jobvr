# Feed tiers and entry level as settings

## Problem

"Tiers to track" decided three things at once: which companies are polled,
which jobs push, and the feed's default tier filter. To keep S and A polled
(useful to see) but out of the way day to day, the feed's Tier filter had to be
set to Mid, Startup, Corporate and Unlisted again on every visit (filters live
in the URL and in memory, so a reload or the home-screen app starts over).

The feed's "Entry level only" switch had the same problem, and it hides plain
"Software Engineer" board roles that are often new-grad friendly anyway.

## Design

- **`tiersToTrack`** ("Poll"): only which companies are polled.
- **`feedTiers`** ("Feed and pushes"), new: the feed's default tier filter
  (when Filters → Tier is empty), and the tiers that push and count as new
  (`isFreshMatch`). Picking tiers in Filters still overrides it, so S and A
  stay one tap away. Saved, Applied and Hidden ignore it, as before.
- **`entryLevelOnly`**, new, default off: the feed and pushes keep only
  entry-level jobs (an entry-level title, or on a new-grad list). Replaces the
  feed's switch; `level=entry` still works on the API.
- Stored settings without `feedTiers` start it at `tiersToTrack`, so an
  existing database behaves as before until it's changed.
- Settings: the "Tiers to track" section becomes "Tiers & feed" with the two
  tier rows and the switch.

## Also

- Feed row actions (Applied, Save/Unsave, Hide/Unhide, Not applied) are
  icon-only; each keeps its name as `aria-label` and tooltip.
