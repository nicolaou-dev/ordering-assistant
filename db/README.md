# Database (Neon Postgres)

Schema is managed by
[node-pg-migrate](https://github.com/salsita/node-pg-migrate); migrations are
plain SQL in `db/migrations/`, tracked in the `pgmigrations` table.

```sh
pnpm db:migrate          # apply pending migrations
pnpm db:migrate:down     # roll back the last migration
pnpm db:migrate:new foo  # scaffold db/migrations/<ts>_foo.sql
```

Migrations connect as `DATABASE_URL_ADMIN` (the owner). `.dev.vars` holds both
that and `DATABASE_URL` (the read-only role the Worker uses).

## Required role

The Worker connects as a `loop_agent` Postgres role, which must be:

- `LOGIN`, read-only (`SELECT` on the tables it queries — granted by the migration)
- **`NOBYPASSRLS`** (must be `false`) — otherwise it bypasses the row-level
  security policies and sees every shop's data.

Create it **once**, via SQL, as a role with owner access — **not** via
neonctl / the Neon Console / the API, which grant `neon_superuser` membership
and therefore `BYPASSRLS`:

```sql
CREATE ROLE loop_agent LOGIN NOBYPASSRLS PASSWORD '...';
```

Then point `DATABASE_URL` at it:
`postgresql://loop_agent:<password>@<host>/neondb?sslmode=require`.

## Per-request RLS pattern

Every query the Worker runs must name the shop first, in the **same
transaction**:

```sql
set_config('app.shop_id', '<phone_number_id>', true)  -- true = transaction-local
```

The `withShop()` helper in `src/db.ts` does this. Without it the policies hide
every row: an unset `app.shop_id` reads as `NULL`, which matches nothing.
