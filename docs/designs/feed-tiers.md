# Feed filters that stick; entry level as a setting

## Problem

Feed filters lived in the URL and in memory, so a reload or the home-screen
app opened the feed with no filters, and the tiers had to be picked again
(Mid, Startup, Corporate and Unlisted, with S and A still polled).

The feed's "Entry level only" switch hid plain "Software Engineer" board
roles that are often new-grad friendly anyway, and had to be turned on again
each time too.

A separate "feed and pushes" tier setting was tried and dropped: two tier
settings (poll vs feed) were confusing. "Tiers to track" still decides
polling, pushes and the feed's default tier filter.

## Design

- **Filters stick per browser**: each view's filters (tiers, places, sources,
  company, age, order; not the text search) are saved in `localStorage`
  (`jobvr.filters`). Opening a view bare (reload, home-screen icon, nav link)
  restores them; "Clear" clears them. Per browser, so each person or device
  keeps its own.
- A remembered tier filter doesn't stop the feed from counting as a visit (the
  "new since last visit" mark), since the feed usually opens with one now.
- **`entryLevelOnly`**, a setting, default off: the feed and pushes keep only
  entry-level jobs (an entry-level title, or on a new-grad list). Replaces the
  feed's switch; `level=entry` still works on the API.
- **Refresh after a poll, not on a timer**: job lists used to refetch every
  2 min. The app shell already checks settings every minute; when
  `lastPollOkAt` (new in `GET /api/settings`) moves, it invalidates the job
  lists. Nothing else changes them between polls except your own actions.
- Feed row actions (Applied, Save/Unsave, Hide/Unhide, Not applied) are
  icon-only; each keeps its name as `aria-label` and tooltip.
- **One compact filter row**, no Filters panel: view, age (All, Today, 1h,
  3 days, 1 week; `1w` is new in the API), tiers (a multi-select pill; none
  picked = tracked tiers) and order (Best / Newest, plus Applied on the
  Applied page), then search. The place, source and company filters are gone
  from the UI: places are set in Settings, and search covers companies,
  places and titles. The API still accepts them; saved filters drop them.
