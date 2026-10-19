# DAX query patterns for dashboards

Query structure, syntax rules, worked patterns for the visuals a dashboard needs, and anti-patterns. Every
pattern reads model measures and only decides grain and filters.

## Contents

- Query structure
- Sample schema
- Patterns: KPI row, trend, ranked list, TopN with other, small multiples, detail table, members with no data,
  comparison against an aggregate, distinct combinations
- Code quality
- Anti-patterns and syntax mistakes

## Query structure

```dax
[DEFINE
    VAR <name> = <expression>
    MEASURE 'Table'[<name>] = <expression>]

EVALUATE
    <table expression>

[ORDER BY <column or [result column]> [ASC | DESC], ...]

[START AT <value>, ...]
```

```yaml
DEFINE:    optional; one block only; VAR and MEASURE entries separated by new lines, no commas
           a VAR can hold a table, a filter or a scalar; prefix names with _ so they never collide with keywords
           MEASURE is for query-scoped helpers built from existing measures, not for new business logic
EVALUATE:  required; must be followed by a table expression; a query may hold several EVALUATEs, but keep one
           per visual so each visual's query can be tested and changed on its own
ORDER BY:  include it for every multi-row result; after SELECTCOLUMNS or a named result column, order by the
           new name in square brackets
START AT:  optional paging; rarely needed in a dashboard
```

```dax
// Correct: one DEFINE, no commas
DEFINE
    VAR _X = 1
    VAR _Y = 2

// Wrong: two DEFINEs
DEFINE VAR _X = 1
DEFINE VAR _Y = 2

// Wrong: commas between VARs
DEFINE
    VAR _X = 1,
    VAR _Y = 2
```

### Choosing a table function

```yaml
SUMMARIZECOLUMNS:  grouping with measures; the default for every chart and table in a dashboard
VALUES:            distinct values of one column, e.g. the members of a slicer
SUMMARIZE:         distinct combinations of columns without measures, e.g. a dimension list across two columns
SELECTCOLUMNS:     projection of a table, keeps duplicates; needed when a column comes through RELATED
ROW:               a single row of scalar results, e.g. one KPI card
TOPN:              the first N rows of a table expression by a measure
```

## Sample schema

The patterns use this hypothetical model:

```yaml
tables:
  Sales:
    measures: Total Sales, Total Sales PY, Total Quantity, Gross Margin %, Sales Target, Sales vs Target %
    columns: OrderDate, ProductKey, CustomerKey, Sales Amount
  Product:
    columns: ProductKey, Name, Category, Color, List Price
    measures: Median List Price
  Customer:
    columns: CustomerKey, Name, Segment
  Geography:
    columns: Region, Country
  Date:
    columns: Date, Year, Month Number, Month Name, Year Month
relationships:
  - 'Product'[ProductKey] -> 'Sales'[ProductKey] (Product filters Sales)
  - 'Customer'[CustomerKey] -> 'Sales'[CustomerKey] (Customer filters Sales)
  - 'Date'[Date] -> 'Sales'[OrderDate] (Date filters Sales)
```

## Patterns

### KPI row

One row, one column per KPI: value, target, variance, prior year. The date context comes from the period the
dashboard shows.

```dax
DEFINE
    VAR _LastDate = CALCULATE ( MAX ( 'Sales'[OrderDate] ), REMOVEFILTERS ( ) )
    VAR _ThisYear = TREATAS ( { YEAR ( _LastDate ) }, 'Date'[Year] )

EVALUATE
    CALCULATETABLE (
        ROW (
            "Total Sales", [Total Sales],
            "Sales Target", [Sales Target],
            "Sales vs Target %", [Sales vs Target %],
            "Total Sales PY", [Total Sales PY],
            "Gross Margin %", [Gross Margin %]
        ),
        _ThisYear
    )
```

### Trend

The KPI by month with its target and prior year, for a line chart or a sparkline.

```dax
DEFINE
    VAR _LastDate = CALCULATE ( MAX ( 'Sales'[OrderDate] ), REMOVEFILTERS ( ) )
    VAR _Window = DATESBETWEEN ( 'Date'[Date], EOMONTH ( _LastDate, -24 ) + 1, _LastDate )

EVALUATE
    SUMMARIZECOLUMNS (
        'Date'[Year Month],
        'Date'[Year],
        'Date'[Month Number],
        _Window,
        "Total Sales", [Total Sales],
        "Total Sales PY", [Total Sales PY],
        "Sales Target", [Sales Target]
    )
ORDER BY 'Date'[Year], 'Date'[Month Number]
```

The window starts on the first day of a month. `DATESINPERIOD ( 'Date'[Date], _LastDate, -24, MONTH )` starts
on the same day of the month 24 months back, so the first point is a partial month that dips for no business
reason. The last point is usually a partial month too; mark it in the chart (a hollow point, or "month to
date" in the label) rather than letting it read as a collapse.

Group by the sortable columns (`Year`, `Month Number`) alongside the label (`Year Month`), so the dashboard can
sort the axis without parsing text.

### Ranked list

Members of one dimension by a measure, for a bar chart or dot plot.

```dax
EVALUATE
    SUMMARIZECOLUMNS (
        'Product'[Category],
        "Total Sales", [Total Sales],
        "Gross Margin %", [Gross Margin %]
    )
ORDER BY [Total Sales] DESC
```

### TopN with "other"

The top members and one row for the rest. The total comes from the model, not from summing the top rows, so a
non-additive measure stays correct.

```dax
DEFINE
    VAR _ByProduct = SUMMARIZECOLUMNS ( 'Product'[Name], "Total Sales", [Total Sales] )
    VAR _Top = TOPN ( 10, _ByProduct, [Total Sales], DESC )
    VAR _TopNames = SELECTCOLUMNS ( _Top, "Name", 'Product'[Name] )
    VAR _OtherSales =
        CALCULATE (
            [Total Sales],
            EXCEPT ( ALL ( 'Product'[Name] ), _TopNames )
        )

EVALUATE
    UNION (
        SELECTCOLUMNS ( _Top, "Product", 'Product'[Name], "Total Sales", [Total Sales] ),
        ROW ( "Product", "Other", "Total Sales", _OtherSales )
    )
ORDER BY [Total Sales] DESC
```

Both inputs to `UNION` must have the same number of columns, in the same order.

### Small multiples

A measure by two dimensions, one panel per member of the first.

```dax
EVALUATE
    SUMMARIZECOLUMNS (
        'Geography'[Region],
        'Date'[Year],
        'Date'[Month Number],
        TREATAS ( { 2025 }, 'Date'[Year] ),
        "Total Sales", [Total Sales]
    )
ORDER BY 'Geography'[Region], 'Date'[Month Number]
```

### Detail table

Rows for a drill-down table, limited so the result stays small.

```dax
DEFINE
    VAR _Segment = TREATAS ( { "Enterprise" }, 'Customer'[Segment] )
    VAR _ByCustomer =
        SUMMARIZECOLUMNS (
            'Customer'[Name],
            _Segment,
            "Total Sales", [Total Sales],
            "Sales vs Target %", [Sales vs Target %]
        )

EVALUATE
    TOPN ( 50, _ByCustomer, [Total Sales], DESC )
ORDER BY [Total Sales] DESC
```

### Members with no data

Products with no sales, using the existing measure to test for BLANK.

```dax
EVALUATE
    FILTER (
        VALUES ( 'Product'[Name] ),
        ISBLANK ( [Total Sales] )
    )
ORDER BY 'Product'[Name]
```

### Comparison against an aggregate

Compute the aggregate once in a variable, then filter by it.

```dax
DEFINE
    VAR _Median = [Median List Price]

EVALUATE
    CALCULATETABLE (
        VALUES ( 'Product'[Name] ),
        'Product'[List Price] > _Median
    )
ORDER BY 'Product'[Name]
```

### Distinct combinations

Dimension members that occur together in the facts, without a measure: use SUMMARIZE over the fact table, not
SUMMARIZECOLUMNS.

```dax
EVALUATE
    CALCULATETABLE (
        SUMMARIZE ( 'Sales', 'Product'[Category], 'Product'[Color] ),
        'Date'[Year] = 2025
    )
ORDER BY 'Product'[Category], 'Product'[Color]
```

When columns come from tables the fact table only reaches through RELATED, project them with SELECTCOLUMNS and
name the result columns:

```dax
EVALUATE
    CALCULATETABLE (
        SELECTCOLUMNS (
            'Sales',
            "Product", RELATED ( 'Product'[Name] ),
            "Customer", RELATED ( 'Customer'[Name] )
        ),
        'Date'[Year] = 2025
    )
ORDER BY [Product], [Customer]
```

## Code quality

- Name filters and intermediate tables as variables, so the `EVALUATE` reads as one plain statement
- A short comment above a query says which visual it feeds
- One grain per query; a KPI row and a monthly trend are two queries
- Return the model's measure names as result column names, so a reader can trace every number back to the model

## Anti-patterns and syntax mistakes

### Re-aggregating what the model already defines

```dax
// Wrong: recomputes sales from raw columns; misses whatever [Total Sales] adds, subtracts or converts
EVALUATE SUMMARIZECOLUMNS ( 'Date'[Year], "Sales", SUM ( 'Sales'[Sales Amount] ) )

// Correct
EVALUATE SUMMARIZECOLUMNS ( 'Date'[Year], "Total Sales", [Total Sales] )
```

### Re-implementing a ratio

```dax
// Wrong: a new margin definition that may not match the model's
DEFINE MEASURE 'Sales'[Margin] = DIVIDE ( [Total Sales] - [Total Cost], [Total Sales] )

// Correct: the model's ratio, at the grain the visual needs
EVALUATE SUMMARIZECOLUMNS ( 'Product'[Category], "Gross Margin %", [Gross Margin %] )
```

### Scalar after EVALUATE

```dax
// Wrong
EVALUATE [Total Sales]

// Correct
EVALUATE ROW ( "Total Sales", [Total Sales] )
```

### SQL keywords

```dax
// Wrong
SELECT * FROM Product WHERE Category = 'Bikes'

// Correct
EVALUATE FILTER ( 'Product', 'Product'[Category] = "Bikes" )
ORDER BY 'Product'[Name]
```

### Method chaining

```dax
// Wrong
Product.FILTER(...).SELECTCOLUMNS(...)

// Correct: variables
DEFINE
    VAR _Bikes = FILTER ( 'Product', 'Product'[Category] = "Bikes" )
EVALUATE
    SELECTCOLUMNS ( _Bikes, "Name", 'Product'[Name] )
ORDER BY [Name]
```

### FORMAT in a query

```dax
// Wrong: text cannot be charted, sorted or compared
EVALUATE SUMMARIZECOLUMNS ( 'Date'[Year], "Sales", FORMAT ( [Total Sales], "#,0" ) )

// Correct: raw number; format in the dashboard with the model's format string
EVALUATE SUMMARIZECOLUMNS ( 'Date'[Year], "Total Sales", [Total Sales] )
```

### Mixing grains in one result

`UNION` of detail rows and a total row hides the grain in the data. Use two queries, except for the TopN with
"other" pattern, where every row is at the same grain.
