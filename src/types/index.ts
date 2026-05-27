export interface DataSourceColumn {
  name: string;
  type: string;
}

export type FilterType =
  | "INCLUDE"
  | "EXCLUDE"
  | "LIKE"
  | "EQ"
  | "GT"
  | "GTE"
  | "LT"
  | "LTE"
  | "BETWEEN"
  | "NOT_BETWEEN"
  | "NULL"
  | "NOT_NULL";

export interface FilterExpression {
  id: string;
  column: string;
  columnType?: string;
  type: FilterType;
  values: string[];
  onAggregates: boolean;
  aggregateAlias?: string;
}

export interface QueryModel {
  table: string | null;
  dimensions: string[];
  measures: string[];
  filters: FilterExpression[];
}
