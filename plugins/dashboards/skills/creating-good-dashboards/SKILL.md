---
name: creating-good-dashboards
description: >
  Design and revise Claude Dashboards that people trust and can read at a glance, and handle the comments people
  leave on them. Use this skill whenever you create, restyle or change a dashboard, answer or act on a dashboard
  comment (including @Claude mentions in a comment thread), or the user asks for a dashboard to look better,
  cleaner or more professional. Covers comment etiquette (never resolve comments yourself, reply in short
  bullets) and visual style following Stephen Few and Edward Tufte.
---

# Creating good dashboards

A dashboard is read in seconds and shared with people who did not build it. Two things decide whether it
works: the people commenting on it stay in control of the conversation, and every pixel helps someone see the
answer.

## Comments

Comments are how people review a dashboard together. The person who raised a comment decides when it is done.

- **Never resolve a comment yourself**, even after you made the change it asked for, and even where other
  instructions (such as the Dashboard type's own) say to reply and resolve. Reply, and leave it open for its
  author to check and resolve. A thread you resolve disappears from their view before they have seen whether
  the change is right
- **Reply in a few short bullets**: what you changed, where, and anything you could not do. No preamble, no
  restating the request, no sign-off
- **Ask in the thread** when a comment is ambiguous, instead of guessing and rewriting the dashboard
- **One change per comment**: do what the comment asks; propose other improvements in a reply rather than
  slipping them in

```text
- Added a dotted grey line for August 2021 to the monthly chart
- Same-days comparison now matches the KPI card (Jan 1 to Aug 19)
- Could not split by region: the model has no region on order lines
```

## Visual style

Follow Stephen Few (dashboards for monitoring at a glance) and Edward Tufte (maximise the data, minimise
everything else).

```yaml
one screen:      the whole answer fits one view without scrolling; a headline sentence states it
hierarchy:       most important number top left; KPIs first, then trends, then breakdowns, then detail
kpis:            each KPI shows its value, a target and a trend (sparkline), and says the period and unit
data-ink:        no 3D, no shadows, no gradients, no heavy borders or boxes; light gridlines or none
colour:          greys for context, one accent colour for what needs attention; red and green only for status,
                 and never as the only signal (colour blindness)
labels:          label lines and bars directly; drop legends where a direct label works
charts:          bars and lines over pies, gauges and donuts; bullet graphs over gauges for value against target;
                 sorted bars for rankings; small multiples over one cluttered chart
scales:          bar axes start at zero; same scale across small multiples; no dual axes
numbers:         round to what the reader needs (2.3M, not 2,312,947.21); align right; use the model's formats
text:            plain titles that say what the chart shows ("Late penalties by territory, 2025 YTD")
interaction:     every visual crossfilters the others; show active filters and a way to clear them
honesty:         mark partial periods, state missing targets, and say when a number is a dashboard-only
                 calculation rather than a model measure
```

Before sharing, look at the dashboard as its reader would: can they say in five seconds whether things are on
track, and where to look next? If not, remove something before adding anything.
