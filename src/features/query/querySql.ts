import type { DataSourceColumn, FilterExpression } from "@/types";

export interface QueryOption {
  value: string;
  label: string;
}

export interface QueryBuilderModel {
  dimensionOptions: QueryOption[];
  measureOptions: QueryOption[];
}

export interface QueryBuilderSelection {
  rowDimensions: string[];
  columnDimensions: string[];
  measures: string[];
  limit: number;
  dimensionAliases?: Record<string, string>;
  rowSortDirections?: Record<string, "asc" | "desc">;
  rowSortPriority?: string[];
  columnSortDirections?: Record<string, "asc" | "desc">;
  columnSortPriority?: string[];
}

const NONE_DIMENSION = "__none__";
const DEFAULT_LIMIT = 200;

function isNumericColumnType(columnType: string): boolean {
  return /int|decimal|double|float|real|numeric|hugeint/i.test(columnType);
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.split('"').join('""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function isNumericLikeType(columnType?: string): boolean {
  return /int|decimal|double|float|real|numeric|hugeint|bigint|smallint|tinyint/i.test(
    columnType || "",
  );
}

function toTypedLiteral(filter: FilterExpression, value: string): string {
  if (isNumericLikeType(filter.columnType)) {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
      return String(numericValue);
    }
  }
  return quoteLiteral(value);
}

function toAggregateExpr(filter: FilterExpression, col: string): string {
  return isNumericLikeType(filter.columnType) ? `AVG(${col})` : `MAX(${col})`;
}

function buildFilterPredicate(filter: FilterExpression, expr: string): string | null {
  switch (filter.type) {
    case "INCLUDE":
      if (filter.values.length) {
        const vals = filter.values.map((v) => quoteLiteral(v)).join(", ");
        return `${expr} IN (${vals})`;
      }
      return null;
    case "EXCLUDE":
      if (filter.values.length) {
        const vals = filter.values.map((v) => quoteLiteral(v)).join(", ");
        return `${expr} NOT IN (${vals})`;
      }
      return null;
    case "LIKE":
      if (filter.values.length) {
        return `${expr} LIKE ${quoteLiteral(`%${filter.values[0]}%`)}`;
      }
      return null;
    case "ILIKE":
      if (filter.values.length) {
        return `${expr} ILIKE ${quoteLiteral(`%${filter.values[0]}%`)}`;
      }
      return null;
    case "EQ":
      if (filter.values.length) {
        return `${expr} = ${toTypedLiteral(filter, filter.values[0])}`;
      }
      return null;
    case "NEQ":
      if (filter.values.length) {
        return `${expr} != ${toTypedLiteral(filter, filter.values[0])}`;
      }
      return null;
    case "GT":
      if (filter.values.length) {
        return `${expr} > ${toTypedLiteral(filter, filter.values[0])}`;
      }
      return null;
    case "GTE":
      if (filter.values.length) {
        return `${expr} >= ${toTypedLiteral(filter, filter.values[0])}`;
      }
      return null;
    case "LT":
      if (filter.values.length) {
        return `${expr} < ${toTypedLiteral(filter, filter.values[0])}`;
      }
      return null;
    case "LTE":
      if (filter.values.length) {
        return `${expr} <= ${toTypedLiteral(filter, filter.values[0])}`;
      }
      return null;
    case "BETWEEN":
      if (filter.values.length >= 2) {
        return `${expr} BETWEEN ${toTypedLiteral(filter, filter.values[0])} AND ${toTypedLiteral(filter, filter.values[1])}`;
      }
      return null;
    case "NOT_BETWEEN":
      if (filter.values.length >= 2) {
        return `${expr} NOT BETWEEN ${toTypedLiteral(filter, filter.values[0])} AND ${toTypedLiteral(filter, filter.values[1])}`;
      }
      return null;
    case "NULL":
      return `${expr} IS NULL`;
    case "NOT_NULL":
      return `${expr} IS NOT NULL`;
    default:
      return null;
  }
}

function toLabel(value: string): string {
  return value.split("_").join(" ");
}

function getDefaultMeasureAlias(parsed: {
  aggregator: string;
  column?: string;
  alias?: string;
}): string {
  if (parsed.alias && parsed.alias.trim().length > 0) {
    return parsed.alias;
  }

  if (parsed.column === "*") {
    if (parsed.aggregator === "count_distinct") {
      return "Count Distinct";
    }
    return "Row Count";
  }

  const columnLabel = toLabel(parsed.column ?? "value");
  switch (parsed.aggregator) {
    case "sum":
      return `Sum ${columnLabel}`;
    case "avg":
      return `Average ${columnLabel}`;
    case "entropy":
      return `Entropy ${columnLabel}`;
    case "geomean":
      return `Geo Mean ${columnLabel}`;
    case "kurtosis":
      return `Kurtosis ${columnLabel}`;
    case "mad":
      return `MAD ${columnLabel}`;
    case "min":
      return `Min ${columnLabel}`;
    case "max":
      return `Max ${columnLabel}`;
    case "median":
      return `Median ${columnLabel}`;
    case "mode":
      return `Mode ${columnLabel}`;
    case "skewness":
      return `Skewness ${columnLabel}`;
    case "stdev":
      return `Std Dev ${columnLabel}`;
    case "variance":
      return `Variance ${columnLabel}`;
    case "histogram":
      return `Histogram ${columnLabel}`;
    case "list":
      return `List ${columnLabel}`;
    case "unique_values":
      return `Unique Values ${columnLabel}`;
    case "count":
      return `Count ${columnLabel}`;
    case "count_distinct":
      return `Distinct Count ${columnLabel}`;
    default:
      return `${toLabel(parsed.aggregator)} ${columnLabel}`;
  }
}

function getMeasureSql(measure: string, tableAlias: string, asAlias?: string): string {
  const parsed = parseMeasureString(measure);
  if (parsed.column === "*") {
    if (parsed.aggregator === "count_distinct") {
      const alias = asAlias ?? getDefaultMeasureAlias(parsed);
      return `COUNT(DISTINCT *) AS ${quoteIdentifier(alias)}`;
    }
    const alias = asAlias ?? getDefaultMeasureAlias(parsed);
    return `COUNT(*) AS ${quoteIdentifier(alias)}`;
  }

  const aggregator = parsed.aggregator;
  const columnName = parsed.column ?? "";
  const quotedColumn = `${tableAlias}.${quoteIdentifier(columnName)}`;
  const alias = asAlias ?? getDefaultMeasureAlias(parsed);
  switch (aggregator) {
    case "sum":
      return `SUM(${quotedColumn}) AS ${quoteIdentifier(alias)}`;
    case "avg":
      return `AVG(${quotedColumn}) AS ${quoteIdentifier(alias)}`;
    case "entropy":
      return `ENTROPY(${quotedColumn}) AS ${quoteIdentifier(alias)}`;
    case "geomean":
      return `GEOMETRIC_MEAN(CASE WHEN ${quotedColumn} > 0 THEN ${quotedColumn} ELSE NULL END) AS ${quoteIdentifier(alias)}`;
    case "kurtosis":
      return `KURTOSIS(${quotedColumn}) AS ${quoteIdentifier(alias)}`;
    case "mad":
      return `MAD(${quotedColumn}) AS ${quoteIdentifier(alias)}`;
    case "min":
      return `MIN(${quotedColumn}) AS ${quoteIdentifier(alias)}`;
    case "max":
      return `MAX(${quotedColumn}) AS ${quoteIdentifier(alias)}`;
    case "median":
      return `MEDIAN(${quotedColumn}) AS ${quoteIdentifier(alias)}`;
    case "mode":
      return `MODE(${quotedColumn}) AS ${quoteIdentifier(alias)}`;
    case "skewness":
      return `SKEWNESS(${quotedColumn}) AS ${quoteIdentifier(alias)}`;
    case "stdev":
      return `STDDEV_SAMP(${quotedColumn}) AS ${quoteIdentifier(alias)}`;
    case "variance":
      return `VAR_SAMP(${quotedColumn}) AS ${quoteIdentifier(alias)}`;
    case "histogram":
      return `HISTOGRAM(${quotedColumn}) AS ${quoteIdentifier(alias)}`;
    case "list":
      return `LIST(${quotedColumn}) AS ${quoteIdentifier(alias)}`;
    case "unique_values":
      return `LIST(DISTINCT ${quotedColumn}) AS ${quoteIdentifier(alias)}`;
    case "count_distinct":
      return `COUNT(DISTINCT ${quotedColumn}) AS ${quoteIdentifier(alias)}`;
    case "count":
      return `COUNT(${quotedColumn}) AS ${quoteIdentifier(alias)}`;
    default:
      return `COUNT(${quotedColumn}) AS ${quoteIdentifier(alias)}`;
  }
}

export function buildQueryBuilderModel(columns: DataSourceColumn[]): QueryBuilderModel {
  const dimensionOptions: QueryOption[] = [
    {
      value: NONE_DIMENSION,
      label: "None",
    },
    ...columns.map((column) => ({
      value: column.name,
      label: `${toLabel(column.name)} (${column.type})`,
    })),
  ];

  const numericColumns = columns.filter((column) => isNumericColumnType(column.type));
  const measureOptions: QueryOption[] = [
    {
      value: "count:*",
      label: "Count Rows",
    },
    ...columns.flatMap((column) => [
      {
        value: `sum:${column.name}`,
        label: `Sum ${toLabel(column.name)}`,
      },
      {
        value: `avg:${column.name}`,
        label: `Average ${toLabel(column.name)}`,
      },
      {
        value: `entropy:${column.name}`,
        label: `Entropy ${toLabel(column.name)}`,
      },
      {
        value: `geomean:${column.name}`,
        label: `Geo Mean ${toLabel(column.name)}`,
      },
      {
        value: `kurtosis:${column.name}`,
        label: `Kurtosis ${toLabel(column.name)}`,
      },
      {
        value: `mad:${column.name}`,
        label: `MAD ${toLabel(column.name)}`,
      },
      {
        value: `min:${column.name}`,
        label: `Min ${toLabel(column.name)}`,
      },
      {
        value: `max:${column.name}`,
        label: `Max ${toLabel(column.name)}`,
      },
      {
        value: `median:${column.name}`,
        label: `Median ${toLabel(column.name)}`,
      },
      {
        value: `mode:${column.name}`,
        label: `Mode ${toLabel(column.name)}`,
      },
      {
        value: `skewness:${column.name}`,
        label: `Skewness ${toLabel(column.name)}`,
      },
      {
        value: `stdev:${column.name}`,
        label: `Std Dev ${toLabel(column.name)}`,
      },
      {
        value: `variance:${column.name}`,
        label: `Variance ${toLabel(column.name)}`,
      },
      {
        value: `histogram:${column.name}`,
        label: `Histogram ${toLabel(column.name)}`,
      },
      {
        value: `list:${column.name}`,
        label: `List ${toLabel(column.name)}`,
      },
      {
        value: `unique_values:${column.name}`,
        label: `Unique Values ${toLabel(column.name)}`,
      },
    ]),
    ...columns.flatMap((column) => [
      {
        value: `count:${column.name}`,
        label: `Count ${toLabel(column.name)}`,
      },
      {
        value: `count_distinct:${column.name}`,
        label: `Count Distinct ${toLabel(column.name)}`,
      },
    ]),
  ];

  return {
    dimensionOptions,
    measureOptions,
  };
}

export function getDefaultQuerySelection(model: QueryBuilderModel): QueryBuilderSelection {
  // Default to an empty selection (no pre-filled rows/columns)
  return {
    rowDimensions: [],
    columnDimensions: [],
    measures: [],
    limit: DEFAULT_LIMIT,
  };
}

export function parseMeasureString(measure: string): {
  aggregator: string;
  column?: string;
  alias?: string;
} {
  // format: "agg:col" or "count:*" optionally with "|alias=custom"
  const [base, tail] = measure.split("|");
  const aliasPart = tail?.startsWith("alias=") ? tail.slice("alias=".length) : undefined;
  if (base === "count:*") return { aggregator: "count", column: "*", alias: aliasPart };
  const [aggregator, column] = base.split(":");
  return { aggregator: aggregator ?? "count", column, alias: aliasPart };
}

function decodeTokenPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseDimensionArgChain(encodedArgs: string, fnCount: number): string[] {
  const decoded = decodeTokenPart(encodedArgs);
  if (!decoded) {
    return new Array<string>(fnCount).fill("");
  }

  try {
    const parsed = JSON.parse(decoded) as unknown;
    if (Array.isArray(parsed)) {
      return new Array<string>(fnCount).fill("").map((_, index) => String(parsed[index] ?? ""));
    }
  } catch {
    // ignore and fall back to legacy single-arg parsing below
  }

  return [decoded, ...new Array<string>(Math.max(0, fnCount - 1)).fill("")];
}

function formatDerivedDimensionFnLabel(fnKey: string, columnLabel: string): string {
  switch (fnKey) {
    case "uppercase":
      return `Uppercase ${columnLabel}`;
    case "lowercase":
      return `Lowercase ${columnLabel}`;
    case "sentence_case":
      return `Sentence Case ${columnLabel}`;
    case "title_case":
      return `Title Case ${columnLabel}`;
    case "length":
      return `Length ${columnLabel}`;
    case "bar":
      return `Bar ${columnLabel}`;
    case "reverse":
      return `Reverse ${columnLabel}`;
    case "split":
      return `Split ${columnLabel}`;
    case "left":
      return `Left ${columnLabel}`;
    case "right":
      return `Right ${columnLabel}`;
    case "string":
      return `String ${columnLabel}`;
    case "date_format":
      return `Format ${columnLabel}`;
    case "date_fmt_ymd":
      return `Format ${columnLabel}`;
    case "date_fmt_y_m":
      return `Format ${columnLabel}`;
    case "date_fmt_y":
      return `Format ${columnLabel}`;
    case "date_fmt_m":
      return `Format ${columnLabel}`;
    case "date_fmt_d":
      return `Format ${columnLabel}`;
    case "date_fmt_ddd":
      return `Format ${columnLabel}`;
    case "date_fmt_dd":
      return `Format ${columnLabel}`;
    case "date_fmt_q":
      return `Format ${columnLabel}`;
    case "date_fmt_iso_time":
      return `Time ${columnLabel}`;
    case "date_fmt_hour":
      return `Hour ${columnLabel}`;
    case "date_fmt_minute":
      return `Minute ${columnLabel}`;
    case "date_fmt_second":
      return `Second ${columnLabel}`;
    case "extract_year":
      return `${columnLabel} Year`;
    case "extract_quarter":
      return `${columnLabel} Quarter`;
    case "extract_month":
      return `${columnLabel} Month`;
    case "extract_week":
      return `${columnLabel} Week`;
    case "extract_day":
      return `${columnLabel} Day`;
    case "julian":
      return `Julian ${columnLabel}`;
    case "last_day":
      return `Last Day ${columnLabel}`;
    case "least_date":
      return `Least ${columnLabel}`;
    case "greatest_date":
      return `Greatest ${columnLabel}`;
    case "age":
      return `Age ${columnLabel}`;
    case "age_year":
      return `Age ${columnLabel}`;
    case "age_quarter":
      return `Age ${columnLabel}`;
    case "age_month":
      return `Age ${columnLabel}`;
    case "age_week":
      return `Age ${columnLabel}`;
    case "age_day":
      return `Age ${columnLabel}`;
    default:
      return columnLabel;
  }
}

function unicodeDateFormatToStrftime(format: string): string {
  const normalized = (format || "").trim() || "YY-MM-DD";
  const tokenMap: Array<[RegExp, string]> = [
    [/yyyy|YYYY|YYY|YY|Y/g, "%Y"],
    [/MMMM/g, "%B"],
    [/MMM/g, "%b"],
    [/MM/g, "%m"],
    [/(^|[^%])M/g, "$1%-m"],
    [/DDDD|DDD/g, "%j"],
    [/dd/g, "%a"],
    [/DD/g, "%d"],
    [/(^|[^%])D/g, "$1%-d"],
    [/(^|[^%])d/g, "$1%-d"],
    [/HH/g, "%H"],
    [/mm/g, "%M"],
    [/ss/g, "%S"],
  ];

  return tokenMap.reduce(
    (current, [regex, replacement]) => current.replace(regex, replacement),
    normalized,
  );
}
function applyDerivedDimensionFunction(
  fnKey: string,
  expr: string,
  rawArg: string,
  useTextCoercion: boolean,
): string {
  const textExpr = useTextCoercion ? `COALESCE(CAST(${expr} AS VARCHAR), '')` : expr;

  switch (fnKey) {
    case "uppercase":
      return `upper(${textExpr})`;
    case "lowercase":
      return `lower(${textExpr})`;
    case "sentence_case":
      return `upper(substr(${textExpr}, 1, 1)) || lower(substr(${textExpr}, 2))`;
    case "title_case":
      return `list_reduce(list_transform(regexp_split_to_array(${textExpr}, '\\s+'), lambda w : upper(w[1]) || lower(w[2:])), lambda x, y : x || ' ' || y)`;
    case "length":
      return `length(${textExpr})`;
    case "bar":
      return `bar(length(${textExpr}), 0, 40, 40)`;
    case "reverse":
      return `reverse(${textExpr})`;
    case "split": {
      const delimiter = (rawArg || " ").slice(0, 1);
      return `string_split(${textExpr}, ${quoteLiteral(delimiter)})`;
    }
    case "left": {
      const length = Math.max(1, Math.floor(Number(rawArg) || 1));
      return `left(${textExpr}, ${length})`;
    }
    case "right": {
      const length = Math.max(1, Math.floor(Number(rawArg) || 1));
      return `right(${textExpr}, ${length})`;
    }
    case "string": {
      const [startRaw, endRaw] = (rawArg || "1:10").split(":");
      const start = Math.max(1, Math.floor(Number(startRaw) || 1));
      const end = Math.max(start, Math.floor(Number(endRaw) || 10));
      return `${textExpr}[${start}:${end}]`;
    }
    case "date_format":
      return `strftime(${expr}, ${quoteLiteral(unicodeDateFormatToStrftime(rawArg))})`;
    case "date_fmt_ymd":
      return `strftime(${expr}, '%Y-%m-%d')`;
    case "date_fmt_y_m":
      return `strftime(${expr}, '%Y-%m')`;
    case "date_fmt_y":
      return `strftime(${expr}, '%Y')`;
    case "date_fmt_m":
      return `strftime(${expr}, '%m')`;
    case "date_fmt_d":
      return `strftime(${expr}, '%d')`;
    case "date_fmt_ddd":
      return `strftime(${expr}, '%j')`;
    case "date_fmt_dd":
      return `strftime(${expr}, '%a')`;
    case "date_fmt_q":
      return `CAST(extract('quarter' FROM ${expr}) AS VARCHAR)`;
    case "date_fmt_iso_time":
      return `strftime(${expr}, '%H:%M:%S')`;
    case "date_fmt_hour":
      return `strftime(${expr}, '%H')`;
    case "date_fmt_minute":
      return `strftime(${expr}, '%M')`;
    case "date_fmt_second":
      return `strftime(${expr}, '%S')`;
    case "extract_year":
      return `extract('year' FROM ${expr})`;
    case "extract_quarter":
      return `extract('quarter' FROM ${expr})`;
    case "extract_month":
      return `extract('month' FROM ${expr})`;
    case "extract_week":
      return `extract('week' FROM ${expr})`;
    case "extract_day":
      return `extract('day' FROM ${expr})`;
    case "julian":
      return `julian(${expr})`;
    case "last_day":
      return `last_day(${expr})`;
    case "least_date":
      return `least(${expr}, ${expr})`;
    case "greatest_date":
      return `greatest(${expr}, ${expr})`;
    case "age": {
      const part = (rawArg || "year").trim().toLowerCase();
      const resolvedPart = part === "month" || part === "day" ? part : "year";
      return `date_diff('${resolvedPart}', ${expr}, current_date)`;
    }
    case "age_year":
      return `date_diff('year', ${expr}, current_date)`;
    case "age_quarter":
      return `date_diff('quarter', ${expr}, current_date)`;
    case "age_month":
      return `date_diff('month', ${expr}, current_date)`;
    case "age_week":
      return `date_diff('week', ${expr}, current_date)`;
    case "age_day":
      return `date_diff('day', ${expr}, current_date)`;
    default:
      return expr;
  }
}

function parseDerivedDimensionToken(
  dimension: string,
): { fnKeys: string[]; columnName: string; rawArgs: string[] } | null {
  if (dimension.startsWith("__fn__|")) {
    const [, fnKey = "", encodedColumn = "", encodedArg = ""] = dimension.split("|");
    const fnKeys = fnKey.split(".").filter(Boolean);
    return {
      fnKeys: fnKeys.length ? fnKeys : [fnKey],
      columnName: decodeTokenPart(encodedColumn),
      rawArgs: parseDimensionArgChain(encodedArg, fnKeys.length || 1),
    };
  }

  // Backward compatibility for legacy persisted tokens like _fn_lstringlColl1%3A10
  if (dimension.startsWith("_fn_")) {
    const compact = dimension.slice("_fn_".length);
    const parts = compact.split("l");
    if (parts.length >= 3) {
      const [fnKey, encodedColumn, ...argParts] = parts;
      return {
        fnKeys: [fnKey],
        columnName: decodeTokenPart(encodedColumn),
        rawArgs: [decodeTokenPart(argParts.join("l"))],
      };
    }
  }

  return null;
}

export function getDimensionDisplayLabel(
  dimension: string,
  dimensionAliases?: Record<string, string>,
): string {
  const configuredAlias = dimensionAliases?.[dimension]?.trim();
  if (configuredAlias) {
    return configuredAlias;
  }

  const parsed = parseDerivedDimensionToken(dimension);
  if (!parsed) {
    return dimension;
  }

  if (parsed.fnKeys.length === 1) {
    const [singleFn] = parsed.fnKeys;
    if (singleFn === "date_format") {
      const formatAlias = (parsed.rawArgs[0] || "").trim() || "YY-MM-DD";
      const columnLabel = toLabel(parsed.columnName || "value");
      return `${formatAlias} ${columnLabel}`;
    }

    const columnLabel = toLabel(parsed.columnName || "value");
    if (singleFn === "age") {
      const normalized = (parsed.rawArgs[0] || "year").trim().toLowerCase();
      const unit = normalized === "month" ? "Months" : normalized === "day" ? "Days" : "Years";
      return `Age in ${unit} ${columnLabel}`;
    }

    if (singleFn === "age_year") {
      return `Age in Years ${columnLabel}`;
    }
    if (singleFn === "age_month") {
      return `Age in Months ${columnLabel}`;
    }
    if (singleFn === "age_day") {
      return `Age in Days ${columnLabel}`;
    }
    if (singleFn === "age_week") {
      return `Age in Weeks ${columnLabel}`;
    }
    if (singleFn === "age_quarter") {
      return `Age in Quarters ${columnLabel}`;
    }
  }

  const columnLabel = toLabel(parsed.columnName || "value");
  const fnLabels = parsed.fnKeys.map((fnKey) => formatDerivedDimensionFnLabel(fnKey, columnLabel));
  if (fnLabels.length <= 1) {
    return fnLabels[0] ?? columnLabel;
  }
  return `${parsed.fnKeys.map((fnKey) => toLabel(fnKey)).join(".")} ${columnLabel}`;
}

function resolveDimensionExpression(
  dimension: string,
  quotedTableAlias: string,
  dimensionAliases?: Record<string, string>,
): { expr: string; alias: string } {
  const parsed = parseDerivedDimensionToken(dimension);
  if (!parsed) {
    return {
      expr: `${quotedTableAlias}.${quoteIdentifier(dimension)}`,
      alias: getDimensionDisplayLabel(dimension, dimensionAliases),
    };
  }

  const { fnKeys, columnName, rawArgs } = parsed;
  const columnExpr = `${quotedTableAlias}.${quoteIdentifier(columnName)}`;
  const aliasLabel = getDimensionDisplayLabel(dimension, dimensionAliases);
  const expr = fnKeys.reduce(
    (currentExpr, fnKey, index) =>
      applyDerivedDimensionFunction(fnKey, currentExpr, rawArgs[index] ?? "", index > 0),
    columnExpr,
  );

  return {
    expr,
    alias: aliasLabel,
  };
}

export function formatMeasureString(aggregator: string, column?: string, alias?: string): string {
  const base = column ? `${aggregator}:${column}` : `${aggregator}:*`;
  if (alias && alias.length) return `${base}|alias=${alias}`;
  return base;
}

export function deriveMeasureAliases(
  measures: string[],
): Array<{ measure: string; column?: string; alias: string }> {
  const aliasCounts = new Map<string, number>();
  return measures.map((measure) => {
    const parsed = parseMeasureString(measure);
    const baseAlias = getDefaultMeasureAlias(parsed);
    const seen = aliasCounts.get(baseAlias) ?? 0;
    aliasCounts.set(baseAlias, seen + 1);
    const uniqueAlias = seen === 0 ? baseAlias : `${baseAlias} ${seen + 1}`;
    return {
      measure,
      column: parsed.column,
      alias: uniqueAlias,
    };
  });
}

function normalizeDimensions(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  values.forEach((value) => {
    if (!value || value === NONE_DIMENSION || seen.has(value)) {
      return;
    }
    seen.add(value);
    normalized.push(value);
  });

  return normalized;
}

function buildRowOrderByClause(
  rowDimensions: string[],
  resolvedRowDimensions: Array<{ expr: string; alias: string }>,
  rowSortDirections?: Record<string, "asc" | "desc">,
  rowSortPriority?: string[],
): string | null {
  if (!resolvedRowDimensions.length) {
    return null;
  }

  const aliasByDimension = new Map<string, string>();
  rowDimensions.forEach((dimension, index) => {
    const alias = resolvedRowDimensions[index]?.alias;
    if (dimension && alias) {
      aliasByDimension.set(dimension, alias);
    }
  });

  const prioritizedDimensions = (rowSortPriority ?? []).filter((dimension) =>
    aliasByDimension.has(dimension),
  );
  const orderedDimensions = [
    ...prioritizedDimensions,
    ...rowDimensions.filter((dimension) => !prioritizedDimensions.includes(dimension)),
  ];

  return orderedDimensions
    .map((rowDimension) => {
      const alias = aliasByDimension.get(rowDimension);
      if (!alias) {
        return null;
      }
      const direction = rowSortDirections?.[rowDimension] === "desc" ? "DESC" : "ASC";
      return `${quoteIdentifier(alias)} ${direction}`;
    })
    .filter((part): part is string => Boolean(part))
    .join(", ");
}

function orderColumnDimensionsByPriority(
  columnDimensions: string[],
  resolvedColumnDimensions: Array<{ expr: string; alias: string }>,
  columnSortPriority?: string[],
): Array<{ expr: string; alias: string }> {
  if (!resolvedColumnDimensions.length) {
    return [];
  }

  const dimensionByAlias = new Map<string, { expr: string; alias: string }>();
  columnDimensions.forEach((dimension, index) => {
    const resolved = resolvedColumnDimensions[index];
    if (dimension && resolved) {
      dimensionByAlias.set(dimension, resolved);
    }
  });

  const prioritizedDimensions = (columnSortPriority ?? []).filter((dimension) =>
    dimensionByAlias.has(dimension),
  );
  const orderedDimensions = [
    ...prioritizedDimensions,
    ...columnDimensions.filter((dimension) => !prioritizedDimensions.includes(dimension)),
  ];

  return orderedDimensions
    .map((columnDimension) => dimensionByAlias.get(columnDimension) ?? null)
    .filter((part): part is { expr: string; alias: string } => Boolean(part));
}

function getPivotOnDimensionClause(alias: string): string {
  const quotedAlias = quoteIdentifier(alias);
  // DuckDB may render pivot columns for MONTH in lexical order; enforce numeric month ordering.
  if (/^month$/i.test(alias.trim())) {
    return `${quotedAlias} IN (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)`;
  }
  return quotedAlias;
}

export function setAxisDimension(
  selection: QueryBuilderSelection,
  axis: "row" | "column",
  index: number,
  dimension: string,
): QueryBuilderSelection {
  const source = axis === "row" ? selection.rowDimensions : selection.columnDimensions;
  const next = [...source];

  while (next.length <= index) {
    next.push(NONE_DIMENSION);
  }
  next[index] = dimension;

  const normalized = normalizeDimensions(next);
  if (axis === "row") {
    return {
      ...selection,
      rowDimensions: normalized,
    };
  }
  return {
    ...selection,
    columnDimensions: normalized,
  };
}

export function getAxisDimensionValue(values: string[], index: number): string {
  return values[index] ?? NONE_DIMENSION;
}

export function getAxisLabels(values: string[], options: QueryOption[]): string[] {
  return values.map((value) => options.find((option) => option.value === value)?.label ?? value);
}

export function buildQueryFromSelection(
  selection: QueryBuilderSelection,
  fromClauseSql: string | undefined,
  filters: FilterExpression[] = [],
): string {
  if (!fromClauseSql) {
    return "SELECT 'Select a data source to generate SQL.' AS message;";
  }

  // Attempt to extract the alias from the provided fromClauseSql (e.g. read_parquet('x') as "_abc")
  const aliasMatch = fromClauseSql.match(/\bas\s+("([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/i);
  const tableAlias = aliasMatch ? (aliasMatch[2] ?? aliasMatch[3]) : "__drake_data_foundation";
  const quotedTableAlias = tableAlias.startsWith('"') ? tableAlias : `"${tableAlias}"`;
  const rowDimensions = normalizeDimensions(selection.rowDimensions);
  const columnDimensions = normalizeDimensions(selection.columnDimensions);
  const resolvedRowDimensions = rowDimensions.map((dimension) =>
    resolveDimensionExpression(dimension, quotedTableAlias, selection.dimensionAliases),
  );
  const resolvedColumnDimensions = columnDimensions.map((dimension) =>
    resolveDimensionExpression(dimension, quotedTableAlias, selection.dimensionAliases),
  );
  const selectedMeasures = selection.measures;
  const rowOrderByClause = buildRowOrderByClause(
    rowDimensions,
    resolvedRowDimensions,
    selection.rowSortDirections,
    selection.rowSortPriority,
  );
  const orderedColumnDimensions = orderColumnDimensionsByPriority(
    columnDimensions,
    resolvedColumnDimensions,
    selection.columnSortPriority,
  );

  if (
    resolvedRowDimensions.length === 0 &&
    resolvedColumnDimensions.length === 0 &&
    selectedMeasures.length === 0
  ) {
    return `SELECT 'Choose attributes to view' AS "message";`;
  }

  const whereParts: string[] = [];
  const aggregateFilters: FilterExpression[] = [];
  filters.forEach((filter) => {
    const col = `${quotedTableAlias}.${quoteIdentifier(filter.column)}`;
    if (filter.onAggregates) {
      aggregateFilters.push(filter);
    } else {
      const predicate = buildFilterPredicate(filter, col);
      if (predicate) {
        whereParts.push(predicate);
      }
    }
  });

  // If we have column dimensions, use DuckDB PIVOT for efficient server-side pivoting.
  if (columnDimensions.length > 0 && selectedMeasures.length === 0) {
    const limit =
      Number.isFinite(selection.limit) && selection.limit > 0
        ? Math.min(5000, selection.limit)
        : Number.isFinite(selection.limit) && selection.limit <= 0
          ? 0 // unlimited
          : DEFAULT_LIMIT;
    const selectParts = [
      ...resolvedRowDimensions.map(
        (dimension) => `${dimension.expr} AS ${quoteIdentifier(dimension.alias)}`,
      ),
      ...orderedColumnDimensions.map(
        (dimension) => `${dimension.expr} AS ${quoteIdentifier(dimension.alias)}`,
      ),
    ];

    let sql = "SELECT\n";
    sql += `  ${selectParts.join(",\n  ")}\n`;
    sql += `FROM ${fromClauseSql}\n`;

    if (whereParts.length) {
      sql += `WHERE ${whereParts.join("\n  AND ")}\n`;
    }

    sql += "GROUP BY ALL\n";

    const havingParts: string[] = [];
    aggregateFilters.forEach((filter) => {
      if (!filter.aggregateAlias) {
        return;
      }
      const predicate = buildFilterPredicate(filter, quoteIdentifier(filter.aggregateAlias));
      if (predicate) {
        havingParts.push(predicate);
      }
    });

    if (havingParts.length) {
      sql += `HAVING ${havingParts.join("\n  AND ")}\n`;
    }

    if (rowOrderByClause) {
      sql += `ORDER BY ${rowOrderByClause}\n`;
    } else {
      sql += "ORDER BY ALL\n";
    }
    if (limit > 0) sql += `LIMIT ${limit}`;
    sql += ";";
    return sql;
  }

  if (columnDimensions.length > 0) {
    const limit =
      Number.isFinite(selection.limit) && selection.limit > 0
        ? Math.min(5000, selection.limit)
        : Number.isFinite(selection.limit) && selection.limit <= 0
          ? 0 // unlimited
          : DEFAULT_LIMIT;
    const cteParts: string[] = [];
    const measureAliasByColumn = new Map<string, string>();

    resolvedRowDimensions.forEach((dimension) => {
      cteParts.push(`${dimension.expr} AS ${quoteIdentifier(dimension.alias)}`);
    });

    orderedColumnDimensions.forEach((dimension) => {
      cteParts.push(`${dimension.expr} AS ${quoteIdentifier(dimension.alias)}`);
    });

    const measureAliases: string[] = [];
    const aliasCounts = new Map<string, number>();
    selectedMeasures.forEach((measure) => {
      const parsed = parseMeasureString(measure);
      const baseAlias = getDefaultMeasureAlias(parsed);
      const seen = aliasCounts.get(baseAlias) ?? 0;
      aliasCounts.set(baseAlias, seen + 1);
      const uniqueAlias = seen === 0 ? baseAlias : `${baseAlias} ${seen + 1}`;
      cteParts.push(getMeasureSql(measure, quotedTableAlias, uniqueAlias));
      measureAliases.push(uniqueAlias);
      if (parsed.column && parsed.column !== "*" && !measureAliasByColumn.has(parsed.column)) {
        measureAliasByColumn.set(parsed.column, uniqueAlias);
      }
    });

    const pivotHavingParts: string[] = [];
    aggregateFilters.forEach((filter) => {
      const col = `${quotedTableAlias}.${quoteIdentifier(filter.column)}`;
      const aliasExpr = measureAliasByColumn.get(filter.column);
      const predicate = buildFilterPredicate(
        filter,
        filter.aggregateAlias
          ? quoteIdentifier(filter.aggregateAlias)
          : aliasExpr
            ? quoteIdentifier(aliasExpr)
            : toAggregateExpr(filter, col),
      );
      if (predicate) {
        pivotHavingParts.push(predicate);
      }
    });

    // Build GROUP BY list (row + column dimensions)
    const groupByParts = [
      ...resolvedRowDimensions.map((d) => d.expr),
      ...resolvedColumnDimensions.map((d) => d.expr),
    ];

    let sql = "WITH __cells AS (\n";
    sql += "  SELECT\n";
    sql += `    ${cteParts.join(",\n    ")}\n`;
    sql += `  FROM ${fromClauseSql}\n`;

    if (whereParts.length) {
      sql += `  WHERE ${whereParts.join("\n    AND ")}\n`;
    }

    sql += "  GROUP BY ALL\n";
    if (pivotHavingParts.length) {
      sql += `  HAVING ${pivotHavingParts.join("\n    AND ")}\n`;
    }
    sql += ")\n\n";

    sql += "PIVOT (FROM __cells)\n";
    const pivotOnParts = orderedColumnDimensions.map((dimension) =>
      getPivotOnDimensionClause(dimension.alias),
    );
    const usesInList = pivotOnParts.some((part) => /\sIN\s*\(/i.test(part));
    if (usesInList) {
      sql += "ON " + pivotOnParts.join(", ") + "\n";
    } else {
      sql += "ON (" + pivotOnParts.join(", ") + ")\n";
    }
    sql +=
      "USING " +
      measureAliases
        .map((alias) => `FIRST(${quoteIdentifier(alias)}) AS ${quoteIdentifier(alias)}`)
        .join(", ");

    if (rowOrderByClause) {
      sql += `\nORDER BY ${rowOrderByClause}`;
    }
    if (limit > 0) sql += `\nLIMIT ${limit}`;
    sql += ";";
    return sql;
  }

  // Fallback: simple GROUP BY query (no column dimensions)
  const selectParts: string[] = [];
  const groupByParts: string[] = [];
  const measureAliasByColumn = new Map<string, string>();

  resolvedRowDimensions.forEach((dimension) => {
    selectParts.push(`${dimension.expr} AS ${quoteIdentifier(dimension.alias)}`);
    groupByParts.push(dimension.expr);
  });

  // Add all selected measures
  const aliasCounts = new Map<string, number>();
  selectedMeasures.forEach((m) => {
    const parsed = parseMeasureString(m);
    const baseAlias = getDefaultMeasureAlias(parsed);
    const seen = aliasCounts.get(baseAlias) ?? 0;
    aliasCounts.set(baseAlias, seen + 1);
    const uniqueAlias = seen === 0 ? baseAlias : `${baseAlias} ${seen + 1}`;
    selectParts.push(getMeasureSql(m, quotedTableAlias, uniqueAlias));
    if (parsed.column && parsed.column !== "*" && !measureAliasByColumn.has(parsed.column)) {
      measureAliasByColumn.set(parsed.column, uniqueAlias);
    }
  });

  const havingParts: string[] = [];
  aggregateFilters.forEach((filter) => {
    const col = `${quotedTableAlias}.${quoteIdentifier(filter.column)}`;
    const aliasExpr = measureAliasByColumn.get(filter.column);
    const predicate = buildFilterPredicate(
      filter,
      filter.aggregateAlias
        ? quoteIdentifier(filter.aggregateAlias)
        : aliasExpr
          ? quoteIdentifier(aliasExpr)
          : toAggregateExpr(filter, col),
    );
    if (predicate) {
      havingParts.push(predicate);
    }
  });

  const limit =
    Number.isFinite(selection.limit) && selection.limit > 0
      ? Math.min(5000, selection.limit)
      : Number.isFinite(selection.limit) && selection.limit <= 0
        ? 0 // unlimited
        : DEFAULT_LIMIT;

  let sql = "SELECT\n";
  sql += `  ${selectParts.join(",\n  ")}\n`;
  sql += `FROM ${fromClauseSql}\n`;

  if (whereParts.length) {
    sql += `WHERE ${whereParts.join("\n  AND ")}\n`;
  }

  if (groupByParts.length) {
    sql += "GROUP BY ALL\n";
  }

  if (havingParts.length) {
    sql += `HAVING ${havingParts.join("\n  AND ")}\n`;
  }

  if (groupByParts.length) {
    if (rowOrderByClause) {
      sql += `ORDER BY ${rowOrderByClause}\n`;
    } else {
      sql += "ORDER BY ALL\n";
    }
  }

  if (limit > 0) sql += `LIMIT ${limit};`;
  return sql;
}

function splitTopLevelCommaSeparated(text: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let current = "";

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const prev = i > 0 ? text[i - 1] : "";

    if (char === "'" && !inDouble && prev !== "\\") {
      inSingle = !inSingle;
    }
    if (char === '"' && !inSingle && prev !== "\\") {
      inDouble = !inDouble;
    }

    if (!inSingle && !inDouble) {
      if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth = Math.max(depth - 1, 0);
      } else if (char === "," && depth === 0) {
        items.push(current.trim());
        current = "";
        continue;
      }
    }

    current += char;
  }

  if (current.trim()) {
    items.push(current.trim());
  }

  return items;
}

function parseMeasureExpression(expr: string): string | null {
  const normalized = expr.trim();
  const countAll = normalized.match(/^COUNT\s*\(\s*\*\s*\)$/i);
  if (countAll) {
    return "count:*";
  }

  const distinctMatch = normalized.match(/^COUNT\s*\(\s*DISTINCT\s+(?:"[^"]+"\.)?"([^"]+)"\s*\)$/i);
  if (distinctMatch) {
    return `count_distinct:${distinctMatch[1]}`;
  }

  const aggMatch = normalized.match(
    /^(SUM|AVG|MIN|MAX|COUNT|ENTROPY|GEOMETRIC_MEAN|KURTOSIS|MAD|MEDIAN|MODE|SKEWNESS|STDDEV_SAMP|VAR_SAMP)\s*\(\s*(?:"[^"]+"\.)?"([^"]+)"\s*\)/i,
  );
  if (aggMatch) {
    const aggregator = aggMatch[1].toLowerCase();
    const column = aggMatch[2];
    if (aggregator === "count") {
      return `count:${column}`;
    }
    return `${aggregator}:${column}`;
  }

  return null;
}

function parseDimensionExpression(expr: string): string | null {
  const cleaned = expr.trim().replace(/\s+AS\s+["'][^"']+["']$/i, "");
  const colMatch = cleaned.match(/(?:"[^"]+"\.)?"([^"]+)"$/i);
  if (colMatch) {
    return colMatch[1];
  }
  const simpleMatch = cleaned.match(/^[A-Za-z_][A-Za-z0-9_]*$/);
  if (simpleMatch) {
    return simpleMatch[0];
  }
  return null;
}

function parseConditionToFilter(condition: string, onAggregates: boolean): FilterExpression | null {
  const normalized = condition.trim();

  const inMatch = normalized.match(/^(?:"[^"]+"\.)?"([^"]+)"\s+IN\s*\(([^)]+)\)$/i);
  if (inMatch) {
    const values = inMatch[2]
      .split(/\s*,\s*/)
      .map((value) => value.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
    return {
      id: crypto.randomUUID(),
      column: inMatch[1],
      type: "INCLUDE",
      values,
      onAggregates,
    };
  }

  const notInMatch = normalized.match(/^(?:"[^"]+"\.)?"([^"]+)"\s+NOT\s+IN\s*\(([^)]+)\)$/i);
  if (notInMatch) {
    const values = notInMatch[2]
      .split(/\s*,\s*/)
      .map((value) => value.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
    return {
      id: crypto.randomUUID(),
      column: notInMatch[1],
      type: "EXCLUDE",
      values,
      onAggregates,
    };
  }

  const cmpMatch = normalized.match(
    /^(?:"[^"]+"\.)?"([^"]+)"\s*(=|!=|<>|>=|<=|>|<)\s*('([^']*)'|"([^"]*)"|[0-9.\-]+)/i,
  );
  if (cmpMatch) {
    const operator = cmpMatch[2];
    const value = cmpMatch[4] ?? cmpMatch[5] ?? cmpMatch[3];
    const typedValue = value.replace(/^['"]|['"]$/g, "");
    const type: FilterExpression["type"] =
      operator === "="
        ? "EQ"
        : operator === "!=" || operator === "<>"
          ? "NEQ"
          : operator === ">"
            ? "GT"
            : operator === ">="
              ? "GTE"
              : operator === "<"
                ? "LT"
                : operator === "<="
                  ? "LTE"
                  : "EQ";
    return {
      id: crypto.randomUUID(),
      column: cmpMatch[1],
      type,
      values: [typedValue],
      onAggregates,
    };
  }

  const likeMatch = normalized.match(
    /^(?:"[^"]+"\.)?"([^"]+)"\s+(LIKE|ILIKE)\s*('(?:[^']*)'|"(?:[^"]*)")/i,
  );
  if (likeMatch) {
    const type = likeMatch[2].toUpperCase() === "ILIKE" ? "ILIKE" : "LIKE";
    const value = likeMatch[3].replace(/^['"]|['"]$/g, "");
    return {
      id: crypto.randomUUID(),
      column: likeMatch[1],
      type,
      values: [value.replace(/%/g, "")],
      onAggregates,
    };
  }

  return null;
}

function extractClause(sql: string, clause: string): string | null {
  const regex = new RegExp(
    `${clause}\\s+([\\s\\S]*?)(?:\\bGROUP BY\\b|\\bHAVING\\b|\\bORDER BY\\b|\\bLIMIT\\b|;|$)`,
    "i",
  );
  const match = sql.match(regex);
  return match ? match[1].trim() : null;
}

function splitConditions(clause: string): string[] {
  const conditions: string[] = [];
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let current = "";

  for (let i = 0; i < clause.length; i += 1) {
    const char = clause[i];
    const prev = i > 0 ? clause[i - 1] : "";

    if (char === "'" && !inDouble && prev !== "\\") {
      inSingle = !inSingle;
    }
    if (char === '"' && !inSingle && prev !== "\\") {
      inDouble = !inDouble;
    }

    if (!inSingle && !inDouble) {
      if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth = Math.max(depth - 1, 0);
      }
    }

    if (!inSingle && !inDouble && depth === 0 && clause.slice(i, i + 5).toUpperCase() === " AND ") {
      conditions.push(current.trim());
      current = "";
      i += 4;
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    conditions.push(current.trim());
  }

  return conditions;
}

export function reverseParseQueryFromSql(sql: string): {
  selection: QueryBuilderSelection;
  filters: FilterExpression[];
} {
  const selection: QueryBuilderSelection = {
    rowDimensions: [],
    columnDimensions: [],
    measures: [],
    limit: DEFAULT_LIMIT,
  };

  const cleanedSql = sql
    .replace(/--.*?(?:\r?\n|$)/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const limitMatch = cleanedSql.match(/\bLIMIT\s+(\d+)/i);
  if (limitMatch) {
    selection.limit = Number(limitMatch[1]);
  }

  const pivotMatch = cleanedSql.match(
    /WITH\s+__cells\s+AS\s*\(\s*SELECT\s+([\s\S]*?)\s+FROM\s+[\s\S]*?\)\s*PIVOT\s*\(\s*FROM\s+__cells\s*\)/i,
  );
  const filters: FilterExpression[] = [];

  if (pivotMatch) {
    const selectText = pivotMatch[1].trim();
    const parts = splitTopLevelCommaSeparated(selectText);
    const dimensions: string[] = [];

    parts.forEach((part) => {
      const cleanedPart = part.replace(/\s+AS\s+["'][^"']+["']$/i, "").trim();
      const measure = parseMeasureExpression(cleanedPart);
      if (measure) {
        selection.measures.push(measure);
      } else {
        const dimension = parseDimensionExpression(cleanedPart);
        if (dimension) {
          dimensions.push(dimension);
        }
      }
    });

    const onMatch = cleanedSql.match(/\bON\s*\(\s*([^)]+?)\s*\)/i);
    const columnDims = onMatch
      ? onMatch[1]
          .split(/\s*,\s*/)
          .map((item) => item.replace(/^["']|["']$/g, "").trim())
          .filter(Boolean)
      : [];

    selection.columnDimensions = columnDims;
    selection.rowDimensions = dimensions.filter((dimension) => !columnDims.includes(dimension));

    const whereMatch = cleanedSql.match(/\bWHERE\s+([\s\S]*?)\s+GROUP BY\b/i);
    if (whereMatch) {
      splitConditions(whereMatch[1]).forEach((condition) => {
        const filter = parseConditionToFilter(condition, false);
        if (filter) {
          filters.push(filter);
        }
      });
    }

    const havingMatch = cleanedSql.match(
      /\bHAVING\s+([\s\S]*?)(?:\s+PIVOT\b|\s+ORDER BY\b|\s+LIMIT\b|$)/i,
    );
    if (havingMatch) {
      splitConditions(havingMatch[1]).forEach((condition) => {
        const filter = parseConditionToFilter(condition, true);
        if (filter) {
          filters.push(filter);
        }
      });
    }

    const usingMatch = cleanedSql.match(/\bUSING\s+([\s\S]*?)(?:\s+ORDER BY\b|\s+LIMIT\b|$)/i);
    if (usingMatch) {
      const usingParts = splitTopLevelCommaSeparated(usingMatch[1]);
      usingParts.forEach((part) => {
        const expr = part.replace(/\s+AS\s+["'][^"']+["']$/i, "").trim();
        const innerMatch = expr.match(/FIRST\s*\(\s*([\s\S]+?)\s*\)/i);
        const measureExpr = innerMatch ? innerMatch[1] : expr;
        const measure = parseMeasureExpression(measureExpr);
        if (measure) {
          selection.measures.push(measure);
        }
      });
    }

    return { selection, filters };
  }

  const selectMatch = cleanedSql.match(/^SELECT\s+(.*?)\s+FROM\s+/i);
  if (selectMatch) {
    const selectText = selectMatch[1];
    const parts = splitTopLevelCommaSeparated(selectText);
    parts.forEach((part) => {
      const cleanedPart = part.replace(/\s+AS\s+["'][^"']+["']$/i, "").trim();
      const measure = parseMeasureExpression(cleanedPart);
      if (measure) {
        selection.measures.push(measure);
      } else {
        const dimension = parseDimensionExpression(cleanedPart);
        if (dimension) {
          selection.rowDimensions.push(dimension);
        }
      }
    });
  }

  const whereClause = extractClause(cleanedSql, "WHERE");
  const havingClause = extractClause(cleanedSql, "HAVING");
  if (whereClause) {
    splitConditions(whereClause).forEach((condition) => {
      const filter = parseConditionToFilter(condition, false);
      if (filter) {
        filters.push(filter);
      }
    });
  }
  if (havingClause) {
    splitConditions(havingClause).forEach((condition) => {
      const filter = parseConditionToFilter(condition, true);
      if (filter) {
        filters.push(filter);
      }
    });
  }

  return { selection, filters };
}
