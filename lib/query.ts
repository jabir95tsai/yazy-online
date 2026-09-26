import { sql, type SQLWrapper } from "drizzle-orm";

/** One bound JSON parameter, regardless of the number of IDs (D1 allows 100). */
export function idsIn(column: SQLWrapper, ids: string[]) {
  return sql`${column} IN (SELECT value FROM json_each(${JSON.stringify([...new Set(ids)])}))`;
}
