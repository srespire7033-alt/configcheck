# Database migrations

Every schema change lives in a single, timestamped, append-only SQL file in this folder. Never edit a migration that has already been applied to production — write a new one.

## Naming convention

```
YYYYMMDDHHMMSS_short_snake_case_description.sql
```

Example: `20260501143000_add_scan_notes_column.sql`

The UTC timestamp prefix is what orders the files and what gets stored in `public.schema_migrations.version`.

## How to apply a new migration

1. Create a new file here with the timestamp of *right now*.
2. Write your SQL. Make it idempotent where reasonable (`create table if not exists`, `on conflict do nothing`, etc.) so re-running is safe.
3. End the file with a row insert into the tracking table:

   ```sql
   insert into public.schema_migrations (version) values ('20260501143000_add_scan_notes_column')
   on conflict (version) do nothing;
   ```

4. Paste the file contents into **Supabase Dashboard → SQL Editor** and run.
5. Commit the file.

## Checking what's applied

```sql
select version, applied_at
from public.schema_migrations
order by version;
```

## Rolling back

Forward-only. If you need to undo something, write a new migration that reverses it. This keeps every production DB reachable by replaying migrations in order.
