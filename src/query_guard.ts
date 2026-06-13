import { parse, astVisitor, type Statement } from "pgsql-ast-parser";

/** Top-level statement shapes that only read. */
const READ_TYPES = new Set([
  "select",
  "union",
  "union all",
  "values",
  "with",
  "with recursive",
]);

const ALLOWED_TABLES = new Set(["products", "shops"]);

export type GuardResult = { sql: string } | { error: string };

/**
 * Validate a model-written SQL string before it runs against the read-only,
 * RLS-scoped loop_agent role. Permit exactly one read statement (SELECT / CTE /
 * UNION / VALUES) that only touches the products and shops tables.
 *
 * The DB role is the real security boundary; this gives the model fast, specific
 * errors and blocks the one write path a read top-level can still hide — a
 * data-modifying CTE like `WITH x AS (DELETE FROM products ...) SELECT ...`
 * (DDL can only appear at top level, so the type check already excludes it).
 */
export function guardQuery(raw: string): GuardResult {
  let statements: Statement[];
  try {
    statements = parse(raw);
  } catch (e) {
    return { error: `could not parse SQL: ${(e as Error).message}` };
  }

  if (statements.length === 0) return { error: "Query is empty." };
  if (statements.length > 1)
    return { error: `expected exactly one statement, got ${statements.length}.` };

  const stmt = statements[0];
  if (!READ_TYPES.has(stmt.type))
    return { error: "Only SELECT / WITH / UNION / VALUES read queries are allowed." };

  const cteNames = new Set<string>();
  const refs: string[] = [];
  let write: string | null = null;

  const visitor = astVisitor((v) => ({
    insert: () => (write = "INSERT"),
    update: () => (write = "UPDATE"),
    delete: () => (write = "DELETE"),
    with: (w) => {
      for (const b of w.bind) cteNames.add(b.alias.name.toLowerCase());
      v.super().with(w);
    },
    withRecursive: (w) => {
      cteNames.add(w.alias.name.toLowerCase());
      v.super().withRecursive(w);
    },
    tableRef: (t) => {
      refs.push(t.name.toLowerCase());
      v.super().tableRef(t);
    },
  }));
  visitor.statement(stmt);

  if (write)
    return {
      error: `${write} is not allowed; only read queries are permitted.`,
    };

  for (const name of refs)
    if (!ALLOWED_TABLES.has(name) && !cteNames.has(name))
      return {
        error: `Table "${name}" is not available. Only products and shops can be queried.`,
      };

  return { sql: raw.trim().replace(/;\s*$/, "") };
}
