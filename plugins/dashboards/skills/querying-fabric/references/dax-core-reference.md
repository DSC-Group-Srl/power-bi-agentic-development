# DAX core reference for queries

The DAX a dashboard query needs: filter arguments, SUMMARIZECOLUMNS, TREATAS, ALL and ALLEXCEPT, BLANK
semantics and the syntax mistakes that cause most errors. Examples use the sample schema in
[dax-query-patterns.md](./dax-query-patterns.md). Function details: [dax.guide](https://dax.guide) and
[learn.microsoft.com](https://learn.microsoft.com/dax/).

## Contents

- Syntax rules
- CALCULATE and CALCULATETABLE
- SUMMARIZECOLUMNS
- TREATAS
- ALL and ALLEXCEPT
- BLANK semantics
- Common mistakes

## Syntax rules

- Measures come first. Answer with the model's measures before writing any aggregation of your own; a query
  decides grain and filters, the model decides what a number means
- `EVALUATE` is a statement, not a function, and takes a table expression. Wrap scalar results in `ROW`
- Columns are always `'Table'[Column]` with the table name in single quotes; measures are always `[Measure]`
  without a table. Many common table names (`Date`, `Product`, `Order`, `Calendar`, `Currency`, `Time`) are
  reserved words, and quoting every table name avoids the question
- `CALCULATE` takes a scalar expression and returns a scalar; `CALCULATETABLE` takes a table expression and
  returns a table. Both apply the same filter rules
- `SUMMARIZECOLUMNS` arguments come in a fixed order: group-by columns, then filter tables, then name and
  expression pairs
- Without any measure, and with group-by columns from more than one table, use `SUMMARIZE`, `VALUES` or
  `SELECTCOLUMNS` instead of `SUMMARIZECOLUMNS`
- `SELECTCOLUMNS` and `CALCULATETABLE` results must keep every column a later `ORDER BY` or `FILTER` needs
- Filters move across relationships in the direction the relationship allows (one way or both ways); check
  `get_model_schema` part `Relationships` when a filter seems to have no effect
- `INTERSECT`, `UNION` and `EXCEPT` need the same number of columns on both sides
- `TODAY()` and `NOW()` give the current date and time; for "the latest period" prefer the last date with
  data, since data usually lags the calendar

## CALCULATE and CALCULATETABLE

```dax
CALCULATE ( <scalar expression> [, <filter> ...] )
CALCULATETABLE ( <table expression> [, <filter> ...] )
```

### Filter argument types

```dax
// Boolean on one column
CALCULATE ( [Total Sales], 'Product'[Color] = "Red" )
CALCULATE ( [Total Sales], 'Product'[Color] IN { "Red", "Blue" } )

// Table expression
CALCULATE ( [Total Sales], TREATAS ( { "Red", "Blue" }, 'Product'[Color] ) )
CALCULATE ( [Total Sales], FILTER ( ALL ( 'Product'[Color] ), 'Product'[Color] = "Red" ) )
```

Modifiers:

```yaml
ALL / REMOVEFILTERS:  clear filters from a table or columns
ALLEXCEPT:            clear filters from a table except the listed columns
ALLSELECTED:          clear filters set inside the visual, keep outer filters
ALLCROSSFILTERED:     clear filters on a table and the filters reaching it through relationships
KEEPFILTERS:          intersect with existing filters instead of replacing them
USERELATIONSHIP:      use an inactive relationship, e.g. delivery date instead of order date
CROSSFILTER:          change a relationship's filter direction for one calculation
```

### Slicing an existing measure

These shapes reuse a measure and change only its filter context, so they are fine in a dashboard query:

```dax
CALCULATE ( [Total Sales], ALL ( 'Product' ) )                          // grand total for share of total
CALCULATE ( [Total Sales], DATEADD ( 'Date'[Date], -1, YEAR ) )         // prior year when the model has no PY measure
CALCULATE ( [Total Sales], USERELATIONSHIP ( 'Sales'[ShipDate], 'Date'[Date] ) )
CALCULATE ( [Total Sales], KEEPFILTERS ( 'Product'[Color] IN { "Red", "Blue" } ) )
DIVIDE ( [Total Sales], CALCULATE ( [Total Sales], ALL ( 'Product' ) ) ) // share of total
```

A share of total is a ratio of one measure to itself under a different filter; it adds no new business
definition, which is why it does not break the measure-reuse rule. A margin or a rate built from two different
measures does; take that from the model.

### Context transition

A measure reference inside an iterator or a row context is evaluated as if wrapped in `CALCULATE`: the current
row becomes a filter. That is why `FILTER ( VALUES ( 'Product'[Name] ), ISBLANK ( [Total Sales] ) )` tests each
product separately.

### Boolean filter restrictions

```dax
// Wrong: one boolean over two tables
CALCULATE ( [Total Sales], 'Product'[Color] = "Red" && 'Customer'[Segment] = "Enterprise" )

// Correct: one argument per column
CALCULATE ( [Total Sales], 'Product'[Color] = "Red", 'Customer'[Segment] = "Enterprise" )

// Wrong: a measure inside a boolean filter
CALCULATE ( [Total Sales], 'Product'[List Price] > [Median List Price] )

// Correct: evaluate the measure into a variable first
DEFINE VAR _Median = [Median List Price]
EVALUATE ROW ( "Above median", CALCULATE ( [Total Sales], 'Product'[List Price] > _Median ) )
```

Table functions such as `FILTER`, `SUMMARIZE`, `SUMMARIZECOLUMNS`, `TOPN`, `DATESBETWEEN`, `DATESINPERIOD`,
`UNION` and `EXCEPT` cannot sit inside a boolean expression (for example after `IN`). Pass them as filter
arguments directly, or through `TREATAS`.

## SUMMARIZECOLUMNS

The default grouping function for dashboard queries.

```dax
SUMMARIZECOLUMNS (
    <group-by column> ...,
    <filter table> ...,
    "<name>", <expression> ...
)
```

```yaml
order:           group-by columns, then filter tables, then name/expression pairs; each part is optional
non-empty:       returns only rows where at least one expression is not BLANK, which keeps results small
blank member:    fact rows with keys missing from a dimension group under a blank member, and that row appears
                 when its measures are not BLANK; it usually signals a data quality issue worth showing
filters:         filter arguments must be tables, never booleans
no group-by:     filters plus measures returns one row, like ROW with filters applied
```

```dax
// Wrong: boolean filter
SUMMARIZECOLUMNS ( 'Product'[Category], 'Product'[Category] = "Bikes", "Total Sales", [Total Sales] )

// Correct
SUMMARIZECOLUMNS ( 'Product'[Category], TREATAS ( { "Bikes" }, 'Product'[Category] ), "Total Sales", [Total Sales] )

// Range filter
SUMMARIZECOLUMNS (
    'Date'[Year],
    FILTER ( ALL ( 'Date'[Year] ), 'Date'[Year] >= 2023 && 'Date'[Year] <= 2025 ),
    "Total Sales", [Total Sales]
)
```

`SUMMARIZECOLUMNS` is for aggregation with measures; `SUMMARIZE` is for distinct combinations of columns.

## TREATAS

```dax
TREATAS ( <table expression>, <column> [, <column> ...] )
```

Applies the values of a table expression as a filter on model columns, as if they came from those columns.
Values that do not exist in the target column are dropped. The number of columns must match.

```dax
TREATAS ( { "Red", "Blue" }, 'Product'[Color] )
TREATAS ( { ( 2025, 1 ), ( 2025, 2 ) }, 'Date'[Year], 'Date'[Month Number] )
TREATAS ( VALUES ( 'Budget'[ProductKey] ), 'Product'[ProductKey] )   // virtual relationship
```

It is the standard way to pass a dashboard selection into a query; see
[crossfiltering.md](./crossfiltering.md).

## ALL and ALLEXCEPT

`ALL` has two uses:

```yaml
as a CALCULATE filter:  removes filters; returns nothing; ALL() with no arguments clears every filter
as a table function:    returns all rows or values ignoring filters, including the blank member
                        (ALLNOBLANKROW excludes it)
```

`ALLEXCEPT ( 'Customer', 'Customer'[Segment] )` clears every filter on `Customer` except `Segment`. It keeps a
filter that already exists; it does not add one. For a parent total of the current member use
`CALCULATE ( [Total Sales], ALL ( 'Customer' ), VALUES ( 'Customer'[Segment] ) )`.

## BLANK semantics

BLANK means "no value". It behaves differently from SQL NULL:

```yaml
BLANK + 4:          4
BLANK * 4:          BLANK
4 / BLANK:          infinity; DIVIDE(4, BLANK()) returns BLANK
BLANK = 0:          TRUE (= treats BLANK as 0, "" and FALSE)
BLANK == 0:         FALSE (== and IN and SWITCH match exactly)
BLANK & "A":        "A"
sort:               BLANK sorts lowest, before 0
```

Rules for queries:

- Let measures return BLANK. `[Measure] + 0`, `COALESCE ( [Measure], 0 )` or `DIVIDE ( x, y, 0 )` inside
  `SUMMARIZECOLUMNS` turns every combination of the group-by columns into a row, which can be millions of rows
- Test with `ISBLANK ( [Measure] )` or `[Measure] == BLANK ( )`, never `= BLANK ( )`
- Show "no data" in the dashboard rather than a zero the data does not contain
- `VALUES` includes the blank member; `DISTINCT` does not

## Common mistakes

```dax
// Reserved word as a variable name
DEFINE VAR SUM = [Total Sales]          // wrong
DEFINE VAR _TotalSales = [Total Sales]  // correct

// Unquoted reserved table name
'Date'[Year]                            // correct; Date[Year] can fail

// Column of a table variable
VAR _Bikes = FILTER ( 'Product', 'Product'[Category] = "Bikes" )
RETURN _Bikes[Name]                                         // wrong
RETURN CONCATENATEX ( _Bikes, 'Product'[Name], ", " )       // correct

// Quotes inside strings are doubled, not escaped with a backslash
"He said ""yes"""
```
