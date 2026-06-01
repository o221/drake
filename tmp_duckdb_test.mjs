import duckdb from "@duckdb/node-api";
const instance = await duckdb.default.DuckDBInstance.create(":memory:");
const conn = await instance.connect();
await conn.run(`CREATE TABLE t(
  id INT,
  "Station Name" VARCHAR,
  "Time Departure" VARCHAR,
  "Time Arrival" VARCHAR,
  c INT
);`);
await conn.run(`INSERT INTO t VALUES
  (1,'Station A','08:00','08:30',10),
  (1,'Station A','08:00','08:45',20),
  (2,'Station B','09:00','09:30',30);`);
try {
  const res =
    await conn.run(`SELECT "Station Name", "Time Departure", "Time Arrival", SUM(c) AS total
    FROM t
    GROUP BY ROLLUP ("Station Name", "Time Departure", "Time Arrival");`);
  console.log("columns", res.columnNames());
  console.log("rows", await res.getRowsJS());
} catch (err) {
  console.error("error", err?.message || err);
}
