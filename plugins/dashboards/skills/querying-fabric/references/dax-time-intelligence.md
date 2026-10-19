# Time intelligence in dashboard queries

Trends, prior-year comparisons, period-to-date values and rolling windows, written as queries over existing
measures. Most models already ship the variants a dashboard needs (`[Sales YTD]`, `[Sales PY]`,
`[Turnover 1YP]`); look for them in `get_model_schema` part `Measures` before shifting a measure yourself.

## Contents

- Prerequisites
- Establishing date context
- Finding "now"
- Period comparisons
- Period to date
- Rolling windows and whole periods
- Common mistakes
- Function list

## Prerequisites

Time intelligence functions need a date table that:

- has one row per day with no gaps
- is marked as a date table in the model
- has an active relationship to the fact table's date column

When a time intelligence result looks wrong, check these first. `get_model_schema` part `Relationships` shows
which fact columns the date table filters; models often have inactive relationships for other dates (ship date,
due date) that `USERELATIONSHIP` switches on.

## Establishing date context

A time intelligence function shifts or extends the dates already in the filter context. With no date filter,
there is nothing to shift.

```dax
// Wrong: no date context, so YTD has no "current" date
EVALUATE ROW ( "Sales YTD", [Sales YTD] )

// Correct: set the reference date explicitly
DEFINE
    VAR _LastDate = CALCULATE ( MAX ( 'Sales'[OrderDate] ), REMOVEFILTERS ( ) )
EVALUATE
    CALCULATETABLE (
        ROW ( "Sales YTD", [Sales YTD], "Sales PY YTD", [Sales PY YTD] ),
        TREATAS ( { _LastDate }, 'Date'[Date] )
    )
```

```dax
// Correct: date columns as group-by columns give each row its own context
EVALUATE
    SUMMARIZECOLUMNS (
        'Date'[Year],
        'Date'[Month Number],
        "Sales YTD", [Sales YTD],
        "Total Sales PY", [Total Sales PY]
    )
ORDER BY 'Date'[Year], 'Date'[Month Number]
```

## Finding "now"

Data lags the calendar, and date tables often extend into the future. Take "now" from the data:

```dax
VAR _LastDate = CALCULATE ( MAX ( 'Sales'[OrderDate] ), REMOVEFILTERS ( ) )
```

or from a flag the model provides, such as `'Date'[IsDateInScope] = TRUE ()` or `'Date'[IsPast]`. Avoid
hard-coded years; a dashboard built in one year should still work in the next.

```dax
DEFINE
    VAR _Year = YEAR ( CALCULATE ( MAX ( 'Sales'[OrderDate] ), REMOVEFILTERS ( ) ) )
EVALUATE
    SUMMARIZECOLUMNS (
        'Customer'[Segment],
        'Date'[Year],
        TREATAS ( { _Year, _Year - 1 }, 'Date'[Year] ),
        "Total Sales", [Total Sales]
    )
ORDER BY 'Customer'[Segment], 'Date'[Year]
```

## Period comparisons

When the model has no prior-period measure, shift the existing measure:

```dax
CALCULATE ( [Total Sales], SAMEPERIODLASTYEAR ( 'Date'[Date] ) )   // same dates last year
CALCULATE ( [Total Sales], DATEADD ( 'Date'[Date], -1, MONTH ) )   // shifts each date one month
CALCULATE ( [Total Sales], PARALLELPERIOD ( 'Date'[Date], -1, MONTH ) ) // the whole previous month
```

`DATEADD` shifts each date, so March 1 to 15 becomes February 1 to 15. `PARALLELPERIOD` returns the complete
period, so the same selection becomes all of February. Comparing a partial current month with a complete prior
month makes every month to date look like a decline; use `DATEADD` for like-for-like.

Year-over-year change:

```dax
DEFINE
    VAR _LastDate = CALCULATE ( MAX ( 'Sales'[OrderDate] ), REMOVEFILTERS ( ) )
EVALUATE
    CALCULATETABLE (
        ROW (
            "Total Sales", [Total Sales],
            "Total Sales PY", [Total Sales PY],
            "YoY %", DIVIDE ( [Total Sales] - [Total Sales PY], [Total Sales PY] )
        ),
        TREATAS ( { YEAR ( _LastDate ) }, 'Date'[Year] )
    )
```

The YoY ratio compares a measure with itself shifted in time, so it reuses the model's definition. Use the
model's own YoY measure when it has one.

## Period to date

```dax
CALCULATE ( [Total Sales], DATESYTD ( 'Date'[Date] ) )
CALCULATE ( [Total Sales], DATESQTD ( 'Date'[Date] ) )
CALCULATE ( [Total Sales], DATESMTD ( 'Date'[Date] ) )
CALCULATE ( [Total Sales], DATESYTD ( 'Date'[Date], "6/30" ) )                  // fiscal year ending June 30
CALCULATE ( [Total Sales], DATESYTD ( SAMEPERIODLASTYEAR ( 'Date'[Date] ) ) )   // prior year to date
```

`TOTALYTD ( [Total Sales], 'Date'[Date] )` is shorthand for the first line.

## Rolling windows and whole periods

```dax
// Last 12 whole months up to the last date with data
VAR _LastDate = CALCULATE ( MAX ( 'Sales'[OrderDate] ), REMOVEFILTERS ( ) )
VAR _Window = DATESBETWEEN ( 'Date'[Date], EOMONTH ( _LastDate, -12 ) + 1, _LastDate )

// Rolling 12-month total for each month of a trend
CALCULATE ( [Total Sales], DATESINPERIOD ( 'Date'[Date], MAX ( 'Date'[Date] ), -12, MONTH ) )
```

`DATESINPERIOD ( 'Date'[Date], _LastDate, -12, MONTH )` starts on the same day of the month a year back, so the
first month of a trend built from it is partial and dips for no business reason. For a trend axis, start the
window at a month boundary with `EOMONTH`. The last month is usually partial too; mark it in the chart instead
of letting it read as a collapse.

## Common mistakes

```dax
// Wrong: fact table date column instead of the date table
CALCULATE ( [Total Sales], DATESYTD ( 'Sales'[OrderDate] ) )

// Correct
CALCULATE ( [Total Sales], DATESYTD ( 'Date'[Date] ) )

// Slow: FILTER over the whole date table
CALCULATE (
    [Total Sales],
    FILTER ( ALL ( 'Date' ), 'Date'[Date] <= MAX ( 'Date'[Date] ) && YEAR ( 'Date'[Date] ) = YEAR ( MAX ( 'Date'[Date] ) ) )
)

// Fast: the built-in function
CALCULATE ( [Total Sales], DATESYTD ( 'Date'[Date] ) )
```

Other causes of wrong results: gaps in the date table, a fiscal calendar the query treats as calendar years, and
grouping by a month name without its year (January 2024 and January 2025 merge into one row).

## Function list

```yaml
period to date:   DATESYTD, DATESQTD, DATESMTD, TOTALYTD, TOTALQTD, TOTALMTD
shifting:         DATEADD, SAMEPERIODLASTYEAR, PARALLELPERIOD
ranges:           DATESINPERIOD, DATESBETWEEN
navigation:       FIRSTDATE, LASTDATE, STARTOFMONTH, ENDOFMONTH, STARTOFYEAR, ENDOFYEAR, PREVIOUSMONTH, NEXTMONTH
balances:         OPENINGBALANCEMONTH, CLOSINGBALANCEMONTH (and QUARTER, YEAR variants) for semi-additive values
```
