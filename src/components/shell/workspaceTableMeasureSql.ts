import type { DataSourceColumn, FilterExpression } from "@/types";

interface BuildTableMeasurePivotSqlInput {
  fromClauseSql: string;
  datasourceColumns: DataSourceColumn[];
  filters: FilterExpression[];
  rawFns: string;
}

interface BuildTableMeasurePivotSqlResult {
  sql: string;
  label: string;
}

const isNumericType = (columnType: string): boolean =>
  /int|decimal|double|float|real|numeric|hugeint|bigint|smallint|tinyint/i.test(
    columnType || "",
  );

const isTextType = (columnType: string): boolean =>
  /char|varchar|string|text|uuid/i.test(columnType || "");

const isTemporalType = (columnType: string): boolean =>
  /date|time/i.test(columnType || "");

const supportsFn = (columnType: string, fnKey: string): boolean => {
  if (
    fnKey === "geomean" ||
    fnKey === "kurtosis" ||
    fnKey === "mad" ||
    fnKey === "skewness" ||
    fnKey === "stdev" ||
    fnKey === "variance"
  ) {
    return isNumericType(columnType);
  }
  if (fnKey === "histogram" || fnKey === "list" || fnKey === "unique_values") {
    return (
      isNumericType(columnType) ||
      isTextType(columnType) ||
      isTemporalType(columnType)
    );
  }
  if (fnKey === "entropy" || fnKey === "median" || fnKey === "mode") {
    return (
      isNumericType(columnType) ||
      isTextType(columnType) ||
      isTemporalType(columnType)
    );
  }
  if (fnKey === "count" || fnKey === "count_distinct") {
    return true;
  }
  if (fnKey === "sum" || fnKey === "avg") {
    return isNumericType(columnType);
  }
  if (fnKey === "min" || fnKey === "max") {
    return (
      isNumericType(columnType) ||
      isTemporalType(columnType) ||
      isTextType(columnType)
    );
  }
  return false;
};

const quoteIdentifier = (identifier: string): string =>
  `"${identifier.split('"').join('""')}"`;

const toLabel = (value: string): string => value.split("_").join(" ");

const quoteLiteral = (value: string): string =>
  `'${value.replace(/'/g, "''")}'`;

const isNumericLikeType = (columnType?: string): boolean =>
  /int|decimal|double|float|real|numeric|hugeint|bigint|smallint|tinyint/i.test(
    columnType || "",
  );

const toTypedLiteral = (
  columnType: string | undefined,
  value: string,
): string => {
  if (isNumericLikeType(columnType)) {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
      return String(numericValue);
    }
  }
  return quoteLiteral(value);
};

const buildExpression = (fnKey: string, columnName: string): string => {
  const quoted = quoteIdentifier(columnName);
  switch (fnKey) {
    case "sum":
      return `SUM(${quoted})`;
    case "avg":
      return `AVG(${quoted})`;
    case "entropy":
      return `ENTROPY(${quoted})`;
    case "geomean":
      return `GEOMETRIC_MEAN(CASE WHEN ${quoted} > 0 THEN ${quoted} ELSE NULL END)`;
    case "kurtosis":
      return `KURTOSIS(${quoted})`;
    case "mad":
      return `MAD(${quoted})`;
    case "min":
      return `MIN(${quoted})`;
    case "max":
      return `MAX(${quoted})`;
    case "median":
      return `MEDIAN(${quoted})`;
    case "mode":
      return `MODE(${quoted})`;
    case "skewness":
      return `SKEWNESS(${quoted})`;
    case "stdev":
      return `STDDEV_SAMP(${quoted})`;
    case "variance":
      return `VAR_SAMP(${quoted})`;
    case "histogram":
      return `HISTOGRAM(${quoted})`;
    case "list":
      return `LIST(${quoted})`;
    case "unique_values":
      return `LIST(DISTINCT ${quoted})`;
    case "count_distinct":
      return `COUNT(DISTINCT ${quoted})`;
    case "count":
    default:
      return `COUNT(${quoted})`;
  }
};

export function buildTableMeasurePivotSql({
  fromClauseSql,
  datasourceColumns,
  filters,
  rawFns,
}: BuildTableMeasurePivotSqlInput): BuildTableMeasurePivotSqlResult | null {
  if (!fromClauseSql || datasourceColumns.length === 0) {
    return null;
  }

  const fnKeys = rawFns
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => (value === "distinct_count" ? "count_distinct" : value));

  const uniqueFnKeys = Array.from(new Set(fnKeys));
  if (!uniqueFnKeys.length) {
    return null;
  }

  const aliasMatch = fromClauseSql.match(
    /\bas\s+("([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/i,
  );
  const tableAlias = aliasMatch
    ? (aliasMatch[2] ?? aliasMatch[3] ?? "__drake_data_foundation")
    : "__drake_data_foundation";
  const quotedTableAlias = tableAlias.startsWith('"')
    ? tableAlias
    : `"${tableAlias}"`;

  const columnTypeByName = datasourceColumns.reduce<Record<string, string>>(
    (acc, column) => {
      acc[column.name] = column.type;
      return acc;
    },
    {},
  );

  const whereParts: string[] = [];
  const havingParts: string[] = [];
  const aggregateFilterAliases: Array<{ alias: string; expr: string }> = [];

  filters.forEach((filter) => {
    const col = `${quotedTableAlias}.${quoteIdentifier(filter.column)}`;
    const columnType = filter.columnType ?? columnTypeByName[filter.column];
    const aggregateExpr = isNumericLikeType(columnType)
      ? `AVG(${col})`
      : `MAX(${col})`;
    const expr = filter.onAggregates ? aggregateExpr : col;

    let predicate = "";
    const filterExpr = filter.onAggregates
      ? (() => {
          const alias = `__filter_${aggregateFilterAliases.length + 1}`;
          aggregateFilterAliases.push({ alias, expr: aggregateExpr });
          return quoteIdentifier(alias);
        })()
      : expr;

    switch (filter.type) {
      case "INCLUDE": {
        if (filter.values.length) {
          const vals = filter.values.map((v) => quoteLiteral(v)).join(", ");
          predicate = `${filterExpr} IN (${vals})`;
        }
        break;
      }
      case "EXCLUDE": {
        if (filter.values.length) {
          const vals = filter.values.map((v) => quoteLiteral(v)).join(", ");
          predicate = `${filterExpr} NOT IN (${vals})`;
        }
        break;
      }
      case "LIKE": {
        if (filter.values.length) {
          predicate = `${filterExpr} LIKE ${quoteLiteral(`%${filter.values[0]}%`)}`;
        }
        break;
      }
      case "EQ": {
        if (filter.values.length) {
          predicate = `${filterExpr} = ${toTypedLiteral(columnType, filter.values[0])}`;
        }
        break;
      }
      case "GT": {
        if (filter.values.length) {
          predicate = `${filterExpr} > ${toTypedLiteral(columnType, filter.values[0])}`;
        }
        break;
      }
      case "GTE": {
        if (filter.values.length) {
          predicate = `${filterExpr} >= ${toTypedLiteral(columnType, filter.values[0])}`;
        }
        break;
      }
      case "LT": {
        if (filter.values.length) {
          predicate = `${filterExpr} < ${toTypedLiteral(columnType, filter.values[0])}`;
        }
        break;
      }
      case "LTE": {
        if (filter.values.length) {
          predicate = `${filterExpr} <= ${toTypedLiteral(columnType, filter.values[0])}`;
        }
        break;
      }
      case "BETWEEN": {
        if (filter.values.length >= 2) {
          predicate = `${filterExpr} BETWEEN ${toTypedLiteral(columnType, filter.values[0])} AND ${toTypedLiteral(columnType, filter.values[1])}`;
        }
        break;
      }
      case "NOT_BETWEEN": {
        if (filter.values.length >= 2) {
          predicate = `${filterExpr} NOT BETWEEN ${toTypedLiteral(columnType, filter.values[0])} AND ${toTypedLiteral(columnType, filter.values[1])}`;
        }
        break;
      }
      case "NULL":
        predicate = `${filterExpr} IS NULL`;
        break;
      case "NOT_NULL":
        predicate = `${filterExpr} IS NOT NULL`;
        break;
    }

    if (!predicate) {
      return;
    }
    if (filter.onAggregates) {
      havingParts.push(predicate);
    } else {
      whereParts.push(predicate);
    }
  });

  const whereClause =
    whereParts.length > 0 ? `\n  WHERE ${whereParts.join("\n    AND ")}` : "";
  const havingClause =
    havingParts.length > 0
      ? `\n  HAVING ${havingParts.join("\n    AND ")}`
      : "";

  const eligibleColumns = datasourceColumns.filter((column) =>
    uniqueFnKeys.some((fnKey) => supportsFn(column.type, fnKey)),
  );
  if (!eligibleColumns.length) {
    return null;
  }

  const selectStatements = eligibleColumns.flatMap((column, columnIndex) =>
    uniqueFnKeys
      .filter((fnKey) => supportsFn(column.type, fnKey))
      .map((fnKey, fnIndex) => {
        const escapedField = column.name.split("'").join("''");
        const escapedAggregate = toLabel(fnKey).split("'").join("''");
        const filterSelect = aggregateFilterAliases.length
          ? `, ${aggregateFilterAliases
              .map((item) => `${item.expr} AS ${quoteIdentifier(item.alias)}`)
              .join(", ")}`
          : "";
        return `  SELECT ${columnIndex} AS field_order, ${fnIndex} AS aggregate_order, '${escapedField}' AS field, '${escapedAggregate}' AS aggregate, CAST(__value AS VARCHAR) AS value\n  FROM (\n    SELECT ${buildExpression(fnKey, column.name)} AS __value${filterSelect}\n    FROM ${fromClauseSql}${whereClause}${havingClause}\n  ) __drake_agg_${columnIndex}_${fnIndex}`;
      }),
  );

  const pivotAggregateColumns = uniqueFnKeys
    .map((fnKey) => {
      const aggregateLabel = toLabel(fnKey).split("'").join("''");
      return `MAX(CASE WHEN aggregate = '${aggregateLabel}' THEN value END) AS ${quoteIdentifier(aggregateLabel)}`;
    })
    .join(",\n       ");

  const sql = `SELECT field,\n       ${pivotAggregateColumns}\nFROM (\n${selectStatements.join("\n  UNION ALL\n")}\n) __drake_table_stats\nGROUP BY field\nORDER BY MIN(field_order);`;

  const label =
    uniqueFnKeys.length === 1
      ? `Table: ${toLabel(uniqueFnKeys[0])} Pivoted (All Fields)`
      : "Table: Pivoted Aggregates (All Fields)";

  return { sql, label };
}
