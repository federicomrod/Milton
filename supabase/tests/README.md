# supabase/tests

SQL checks that run against a database built from `supabase/migrations`.

| File               | Expected result                                                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `secdef_guard.sql` | **0 rows.** Lists SECURITY DEFINER non-trigger functions that `PUBLIC`, `anon` or `authenticated` can execute, minus an explicit allowlist (one-line reason per entry). |

`secdef_guard.sql` is a read-only catalog query. It is a required step of the
baseline validation plan: after building an empty database from the baseline
plus all migrations, it must return 0 rows, and it can also be run read-only
against production to confirm the same.

```sh
psql "$DB_URL" -X -A -t -f supabase/tests/secdef_guard.sql   # no output = pass
```

Adding a new SECURITY DEFINER function? Revoke `PUBLIC`, `anon` and
`authenticated` explicitly (Supabase default privileges grant `anon` and
`authenticated` directly, so revoking `PUBLIC` alone is not enough), or add an
allowlist entry with a reason.
