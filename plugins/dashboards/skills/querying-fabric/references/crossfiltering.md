# Crossfiltering

In a crossfiltered dashboard every visual is also a filter: selecting a bar, a row, a point or a map region
filters every other visual, and selecting it again clears the filter. Readers expect this from Power BI, and it
turns a static page into something they can ask questions of.

## Contents

- Selection state
- Passing a selection into DAX
- Multi-select
- Which visuals re-query
- The visual that owns a selection
- Testing

## Selection state

Keep one selection object for the whole dashboard, keyed by the model column each visual groups by:

```yaml
selection:
  "'Customer'[Segment]": ["Enterprise"]
  "'Date'[Year Month]": []
  "'Product'[Category]": ["Bikes", "Helmets"]
```

- A click on a mark toggles that member in the visual's column
- Ctrl or Cmd click adds to the selection; a plain click replaces it
- Every visual reads the whole selection, except its own column (see below)
- One visible strip lists active selections, each with a way to clear it, plus "clear all"
- Slicers and date pickers write into the same object, so there is one source of truth for filters

## Passing a selection into DAX

Pass selections as query parameters, never by splicing text into the query string. Fabric MCP tools take
parameters as `{"name": value}` and the query references them as `@name`; this avoids quoting bugs and DAX
injection from member names that contain quotes.

Build each filter so it does nothing when the selection is empty. An empty string means "no selection":

```dax
DEFINE
    VAR _Segment =
        FILTER (
            ALL ( 'Customer'[Segment] ),
            @segment = "" || 'Customer'[Segment] = @segment
        )

EVALUATE
    SUMMARIZECOLUMNS (
        'Product'[Category],
        _Segment,
        "Total Sales", [Total Sales]
    )
ORDER BY [Total Sales] DESC
```

```json
{ "segment": "Enterprise" }
```

For a numeric column, compare with a sentinel the column never holds, or pass a separate flag:

```dax
VAR _Year = FILTER ( ALL ( 'Date'[Year] ), @year = 0 || 'Date'[Year] = @year )
```

## In a Claude Dashboard

A Claude Dashboard stores each dataset as a connector call, and fills `{{name}}` placeholders in the call's
arguments from the page's filter state. Pass the whole DAX parameter object through them, so the query keeps
using `@name` parameters and never has values spliced into its text:

```json
{
  "model": "<model id>",
  "query": "DEFINE VAR _Segment = FILTER ( ALL ( 'Customer'[Segment] ), @segment = \"\" || 'Customer'[Segment] = @segment ) EVALUATE ...",
  "parameters": { "segment": "{{segment}}", "categories": "{{categories}}", "year": "{{year}}" }
}
```

- Give every parameter a default in the dashboard's params (`""` for no selection, `0` for a numeric sentinel).
  A parameter with no default is NULL until the page sets one, and every query has to run at its defaults
- A click calls `dash.setParams({segment: value})`; every dataset whose arguments name `{{segment}}` runs again.
  Clearing sets it back to its default (`""`), not `null`
- The visual that owns a selection leaves its own `{{name}}` out of its `parameters`, so it keeps every member
- Model selections such as a reporting currency are parameters too (`{{currency}}`, default from the model or
  the user), so a reader can switch them

## Multi-select

Pass the selected members as one delimited string and test membership with `PATHCONTAINS`, which splits on `|`:

```dax
DEFINE
    VAR _Categories =
        FILTER (
            ALL ( 'Product'[Category] ),
            @categories = "" || PATHCONTAINS ( @categories, 'Product'[Category] )
        )

EVALUATE
    SUMMARIZECOLUMNS (
        'Date'[Year],
        _Categories,
        "Total Sales", [Total Sales]
    )
ORDER BY 'Date'[Year]
```

```json
{ "categories": "Bikes|Helmets" }
```

If a member name can contain `|`, pick another approach for that column (one parameter per selected member, or
filter by a key column instead of the name).

A dashboard with several crossfilter columns repeats this filter once per column and passes every one of them to
every query. Unused filters cost almost nothing when their parameter is empty.

## Which visuals re-query

```yaml
re-query from the model:
  - any visual showing a ratio, percentage, average, distinct count or other non-additive measure
  - KPI cards and their targets
  - any visual whose measure has filter logic you cannot see (hidden expressions, selection-dependent measures)
filter client-side only when:
  - the measure is additive (a plain sum or count)
  - the data already loaded is at a grain that contains the selected column
  - and the row count is small
```

When unsure, re-query. A wrong number after a click is the fastest way to lose a reader's trust, and the model is
the only place that knows how a measure behaves for a subset. This follows from the measure-reuse rule: summing
per-row ratios in the dashboard is a new, wrong definition of the measure.

Debounce selection changes (wait for a short pause after the last click) and run the affected queries in
parallel, so rapid clicking does not queue dozens of queries. Show a light loading state on each visual while its
query runs, and keep the previous result visible until the new one arrives.

## The visual that owns a selection

The visual a user clicked must not filter itself, or every other bar disappears and the user cannot change their
mind. Leave its own column out of its query and highlight the selected members (full colour) against the rest
(muted).

```dax
// The category bar chart ignores the category selection but respects every other selection
DEFINE
    VAR _Segment = FILTER ( ALL ( 'Customer'[Segment] ), @segment = "" || 'Customer'[Segment] = @segment )

EVALUATE
    SUMMARIZECOLUMNS (
        'Product'[Category],
        _Segment,
        "Total Sales", [Total Sales]
    )
ORDER BY [Total Sales] DESC
```

The trend chart owns the date selection the same way: selecting a month filters the other visuals to that
month, while the trend keeps its whole window and highlights the month.

## Testing

For every query, run it with `run_dax_query`:

1. with every parameter empty; the totals must match the unfiltered dashboard
2. with one member selected in each crossfilter column; the KPI card total must equal that member's value in the
   visual that owns the selection
3. with two members selected; the result must equal the sum of the two for additive measures, and the model's
   value (not the sum) for ratios
