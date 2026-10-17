# KPI design: value, target, trend

Every KPI in a dashboard shows its value, the target it is judged against, and its trend. A value without a
target cannot say whether it is good; a value without a trend cannot say whether it is getting better. Together
they answer the reader's real question: do I need to act?

## Contents

- Finding the KPI measures
- Finding the target
- Variance to target
- The trend
- Query shapes for one KPI
- Presenting a KPI
- Checklist

## Finding the KPI measures

Start from the business question, then find the measures in the model that answer it:

1. `get_model_schema` part `Measures`. Read names, display folders, descriptions and format strings; models
   group measures in folders such as `Actuals`, `Budget`, `YTD`, `1YP`
2. Prefer measures the model shows (`IsHidden` false). Hidden measures are often building blocks, and they can
   depend on filters the visible measure applies for you
3. Check the expression for required selections (currency, unit, scenario); see the SKILL.md section on
   measures that need a selection
4. Run each candidate at a known grain (total, one year) and compare with a figure the user trusts

Pick three to five KPIs. More than that stops being a summary.

## Finding the target

Look in the model first, in this order:

```yaml
variance measures:  "vs Target", "vs Budget", "vs Plan", "Achievement %"; the target and the variance in one
target measures:    Budget, Target, Goal, Plan, Forecast, Quota, SLA, Threshold
target tables:      a Budget or Targets table with its own measures, often at a coarser grain (month, region)
kpi objects:        model KPIs (a KPIID on the measure) carry a target expression and status thresholds
descriptions:       a measure description that states the goal ("target is 95% on time")
```

A target at a coarser grain than the visual is common: a monthly budget with daily sales, or a regional target
with sales by customer. Show the target only at grains where it is defined, or use the model's own allocation
measure if it has one (`Budget MTD` style measures often spread a monthly budget over working days).

When the model has no target:

1. Tell the user, and ask what the target is
2. Use the user's figure as a stated target, labelled with where it came from ("Target 95%, from the user")
3. If there is no target at all, fall back to the prior period as the comparison and label it "vs last year",
   never "vs target"

Never invent a target or derive one from the data (an average, a percentile) and present it as the goal.

## Variance to target

Use the model's variance measures when they exist. Otherwise compute the variance from the KPI and target
measures in the query; it compares two existing measures and adds no new business definition:

```dax
"Variance", [Total Sales] - [Sales Target],
"Variance %", DIVIDE ( [Total Sales] - [Sales Target], [Sales Target] )
```

Know the direction of good. For sales, above target is good; for costs, late deliveries or penalties, below
target is good. Colour and wording follow that direction.

## The trend

```yaml
measure:    the same KPI measure as the card, never a different one
grain:      the grain the business reviews the KPI at, usually month; week for operations, quarter for strategy
history:    enough periods to see a pattern, typically 12 to 24
comparison: the target per period where the target exists at that grain, and the prior year where seasonality matters
partials:   start the window at a period boundary; mark the current partial period
```

A sparkline on the card is the trend at its smallest. A larger trend chart can show target and prior year as
reference lines.

## Query shapes for one KPI

Two queries per KPI: one row for the card, one row per period for the trend.

```dax
// KPI card: value, target, variance, prior year for the current year to date
DEFINE
    VAR _LastDate = CALCULATE ( MAX ( 'Sales'[OrderDate] ), REMOVEFILTERS ( ) )
EVALUATE
    CALCULATETABLE (
        ROW (
            "Total Sales", [Sales YTD],
            "Sales Target", [Sales Target YTD],
            "Sales vs Target %", DIVIDE ( [Sales YTD] - [Sales Target YTD], [Sales Target YTD] ),
            "Total Sales PY", [Sales PY YTD]
        ),
        TREATAS ( { _LastDate }, 'Date'[Date] )
    )
```

```dax
// KPI trend: value and target per month, last 24 whole months
DEFINE
    VAR _LastDate = CALCULATE ( MAX ( 'Sales'[OrderDate] ), REMOVEFILTERS ( ) )
    VAR _Window = DATESBETWEEN ( 'Date'[Date], EOMONTH ( _LastDate, -24 ) + 1, _LastDate )
EVALUATE
    SUMMARIZECOLUMNS (
        'Date'[Year],
        'Date'[Month Number],
        'Date'[Year Month],
        _Window,
        "Total Sales", [Total Sales],
        "Sales Target", [Sales Target],
        "Total Sales PY", [Total Sales PY]
    )
ORDER BY 'Date'[Year], 'Date'[Month Number]
```

Several KPIs can share one card query and one trend query when they share the same grain and filters; that
halves the round trips. Both queries take the dashboard's crossfilter parameters (see
[crossfiltering.md](./crossfiltering.md)), so a KPI always describes the current selection.

## Presenting a KPI

- Lead with the value, then the target and variance, then the trend
- State the period ("Year to date, through 14 Aug 2025") and the currency or unit
- Use the model's format string for the value
- Colour the variance by whether it is good or bad, not by its sign
- Say when a target is missing or came from the user, on the card itself

## Checklist

```yaml
- every KPI uses an existing model measure
- every KPI has a target from the model or the user, or is labelled as a prior-period comparison
- every KPI has a trend of the same measure at a stated grain
- the card and the trend respond to every crossfilter selection
- the current partial period is marked
- one KPI value was checked against a figure the user trusts
```
