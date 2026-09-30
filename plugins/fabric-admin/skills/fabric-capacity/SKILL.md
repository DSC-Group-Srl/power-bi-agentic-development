---
name: fabric-capacity
description: Automatically invoke this skill whenever the user asks why a Fabric capacity is busy, throttled, at 90 or 100 percent, or what is consuming CUs; asks for current capacity utilization, carry forward or per-item CU usage; wants to query or repair the Microsoft Fabric Capacity Metrics app or its semantic model; or wants to start, pause or monitor a capacity from a script or status bar.
---

# Fabric Capacity

Read capacity utilization and per-item CU from the Microsoft Fabric Capacity Metrics semantic model with `fab`, and start or pause a capacity. Invoke the `fabric-cli` skill alongside this one; its `references/capacity-cost.md` covers budget math, smoothing and throttling.

## Where the numbers live

```yaml
live (DirectQuery, CapacityMetricsCES connector):
  CU Detail:                 per 30 s timepoint; Interactive, Background, CU limit, SKU
  Timepoint CU Detail:       same, per timepoint detail page
  Metrics By Item [And Day|And Hour|And Operation]: CU (s), Duration (s), Operations, Users per item
  System Events:             pause, resume, state changes
import (fresh only after a model refresh; Pro workspace = 8 refreshes a day):
  Capacities, Items, Workspaces, Timepoints/Dates calendars
  Average utilization (last 1 hour | last 24 hours | last 7 days): measures on the Health page
not available:               Azure Monitor has no metrics namespace for Microsoft.Fabric/capacities
```

Anything that must be current (a status bar, "what is using the capacity now") needs the DirectQuery tables.

## Query with fab

The model sits in a Pro workspace, so there is no XMLA endpoint and `te` cannot connect. Use `executeQueries` through fab. DirectQuery tables need the capacity passed as an M parameter inside a `DEFINE` block; without it the connector fails, and the error reads like a credential problem.

```bash
fab api -A powerbi "groups/<metrics-ws-id>/datasets/<metrics-model-id>/executeQueries" -X post -i "$(jq -cn --arg q "$(cat <<'EOF'
DEFINE
  MPARAMETER 'CapacitiesList' = {"<CAPACITY-ID-UPPERCASE>"}
  VAR latest = MAX('CU Detail'[Window start time])
EVALUATE
ROW("pct", CALCULATE(
  DIVIDE(SUM('CU Detail'[Interactive]) + SUM('CU Detail'[Background]), MAX('CU Detail'[CU limit])),
  'CU Detail'[Window start time] = latest) * 100)
EOF
)" '{queries: [{query: $q}]}')"
```

- Capacity IDs: `fab api -A powerbi capacities`
- Per item for a day: `SUMMARIZECOLUMNS(Items[Workspace name], Items[Item kind], Items[Item name], TREATAS({DATE(y,m,d)}, 'Metrics By Item And Day'[Date]), "CUs", SUM('Metrics By Item And Day'[CU (s)]))`
- Schema: `INFO.VIEW.TABLES()`, `INFO.VIEW.COLUMNS()`, `INFO.VIEW.MEASURES()` work over `executeQueries`; `INFO.TABLES()` and measure expressions do not
- fab paths break on names containing `/`; use IDs with `fab api`

## Start and pause

```bash
fab get ".capacities/<name>.Capacity" -q properties.state   # Active | Paused, ~10 s
fab start ".capacities/<name>.Capacity" -f
fab stop  ".capacities/<name>.Capacity" -f                  # bills the carry forward at once
```

`fab get` output ends in `\r`; strip it before comparing.

## Keeping the metrics app alive

Failure modes seen on one tenant, in the order they surfaced:

- The data source OAuth refresh token expires after 90 days without use (`AADSTS700082`); scheduled refresh stops and the model goes stale silently. Re-enter the credential in the model settings, then refresh
- An old app version (47 from 2024) could not serve DirectQuery at all. Update from Apps, Get apps, Template apps, Microsoft Fabric Capacity Metrics, "Update the workspace and the app". It updates in place (same workspace and model IDs) but appends a date to the workspace name; rename it back or fab and te paths break on the `/`
- Saving the credential dialog with "Skip test connection" ticked stores a credential that refreshes fine but fails every DirectQuery with `The credentials provided for the CapacityMetricsCES source are invalid` (`QueryUserError`). Save again with the box unticked; open the settings page with `?alwaysPromptForContentProviderCreds=true` to force a fresh OAuth prompt and pick the capacity admin account explicitly when the browser holds several
- Moving the workspace to Premium Per User to get XMLA did not help and broke nothing that was not already broken; keep it on shared capacity as Microsoft recommends
- The account on the credential must be a capacity admin of every capacity queried

## What usually fills a small capacity

- Preview Planning sessions: one Stakeholder session is 168 CU-h, billed at once (604,800 CU-s on an F2), drives the capacity into carry forward for days; see `fabric-cli` `capacity-cost.md`
- SQL databases (including the `__fabric_plan_sys` and `<name>_plan` databases Planning creates, and app backends' databases) consume CU continuously while awake
- Background jobs are smoothed over 24 h, so a busy morning still counts at night
