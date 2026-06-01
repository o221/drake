export interface DataSourceColumn {
  name: string;
  type: string;
}

export type FilterType =
  | "INCLUDE"
  | "EXCLUDE"
  | "LIKE"
  | "ILIKE"
  | "EQ"
  | "NEQ"
  | "GT"
  | "GTE"
  | "LT"
  | "LTE"
  | "BETWEEN"
  | "NOT_BETWEEN"
  | "NULL"
  | "NOT_NULL";

export type FilterConjunction = "AND" | "OR";

export interface FilterExpression {
  id: string;
  column: string;
  columnType?: string;
  type: FilterType;
  values: string[];
  onAggregates: boolean;
  aggregateAlias?: string;
  conjunction?: FilterConjunction;
}

export interface QueryModel {
  table: string | null;
  dimensions: string[];
  measures: string[];
  filters: FilterExpression[];
}
