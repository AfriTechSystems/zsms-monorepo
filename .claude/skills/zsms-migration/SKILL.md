---
name: zsms-migration
description: Write and apply a ZSMS database migration. Use whenever a task needs a new table, column, function, policy, index or trigger — before writing any SQL. Covers the numbering rule, mandatory schema introspection, SECURITY DEFINER and grant patterns, exercising against the real database, and the ledger update.
---

# Writing a ZSMS migration

A migration here is applied to a **live shared database** the moment it is pushed. There is
no local Postgres on this machine and no staging to catch a mistake first. Everything below
exists because it has gone wrong in this repository, not because it is tidy.

---

## 1. Read the columns BEFORE writing a line of SQL

```bash
npm run db:cols -- students student_parent_links
```

Non-negotiable, including for a table you believe you know. Four separate bugs in one
session came from assuming a column's shape:

| Assumed | Reality | Cost |
|---|---|---|
| `schools.school_code` | the column is `school_id`; the UUID is `id` | a correcting migration |
| `student_parent_links.school_id` | scopes through the pupil, by design | a correcting migration |
| `student_parent_links.updated_at` | does not exist — `42703` on first call | nothing could be linked |
| `students.class_id` nullable | `NOT NULL` — `23502` on first run | promoted nobody |

The fourth is the instructive one. Three were *inventions* that failed loudly. The third
also **ignored `unlinked_at` and `unlinked_by`, which do exist** — that one SUCCEEDED, and
quietly recorded less than the schema was built to hold. A column you fail to use is more
dangerous than one you invent.

`db:cols` prints nullability, defaults and CHECK constraints, because "`class_id` is NOT
NULL" and "`status` admits exactly five values" are the facts that break code.

---

## 2. Take the number from the ledger, never from the filesystem

`Official Documentation/05 Core Database and API Reference/MIGRATIONS.md` →
*Next Available Sequence Number*.

Most of the sequence is planned there long before it exists as a file. Reading the highest
file on disk is how `0019`–`0021` were written onto numbers already claimed, which is why
**`0022`–`0068` are void** — they sort below the applied high-water mark, so `db push`
skips them silently.

Create the file **by hand** as `NNNN_description.sql`. Never `supabase migration new` — it
generates a timestamp name, and a timestamp sorts after every four-digit version.

---

## 3. Rules that are absolute

- **Never add to an applied migration.** A new file, always. If `0182` was wrong, `0183`
  fixes it — and says in its header what `0182` got wrong and why, because the next person
  reading `0182` needs to know.
- **A function the application calls lives in `public`.** `supabase/config.toml` sets
  `schemas = ["public"]`, so PostgREST cannot see `afritech` at all. A function or table
  there is reachable from SQL, a migration and pgTAP — and **never from a route**. Nothing
  fails at build time; it is a 404 the first time somebody clicks the button. This has
  happened four times, most recently with a *table* (`afritech.teacher_hub_plans`), which
  the existing rule did not catch.
- **A new table without an RLS policy is a defect.** So is one without the `0149` status
  guard, which is attached by iterating the catalogue *at migration time* — a table created
  later has none, and nothing reminds anybody.
- **No hard deletes** on students, fee records, payments or exam results. `is_deleted`, or a
  status column.
- **`NUMERIC(12,2)` for money. `TIMESTAMPTZ` for time.** Never FLOAT, never bare timestamp.

---

## 4. The shape of a SECURITY DEFINER function

```sql
CREATE OR REPLACE FUNCTION public.do_the_thing(p_arg UUID)
RETURNS TABLE (out_ok BOOLEAN, out_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp     -- always; without it the function is hijackable
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_role   TEXT := auth.jwt() -> 'o' ->> 'rol';
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  -- The role check belongs HERE, not in the GRANT: `authenticated` covers every
  -- member of staff, so the grant cannot express "owner or principal".
  IF v_role NOT IN ('owner', 'principal') THEN
    RAISE EXCEPTION 'Only the owner or principal may do this' USING ERRCODE = '42501';
  END IF;

  -- A DEFINER function bypasses RLS. Every query it runs needs its own tenant
  -- clause, or one school reaches another's rows through it.
  IF NOT EXISTS (
    SELECT 1 FROM public.students s WHERE s.id = p_arg AND s.school_id = v_school
  ) THEN
    RAISE EXCEPTION 'Not at this school' USING ERRCODE = '42501';
  END IF;
  ...
END;
$$;
```

**Never trust an id passed as an argument.** A DEFINER function taking `p_school_id` on
trust lets any caller read any school by changing a query string. AfriTech may name a
school; everybody else is resolved from the session and the argument is ignored.

Clerk sends the **bare** role form (`owner`, not `org:owner`) in `o.rol`. Compare against
that — `npm run clerk:check` shows a real token.

**Grants, and assert them:**

```sql
REVOKE ALL ON FUNCTION public.do_the_thing(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.do_the_thing(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.do_the_thing(UUID) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.do_the_thing(UUID)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute do_the_thing';
  END IF;
END;
$$;
```

**Triggers that raise a message about tenant state must be AFTER.** A BEFORE ROW trigger
runs ahead of the RLS `WITH CHECK`, so `0101` told School B the exact pupil ceiling of a
full School A before establishing B could write there at all.

**Two triggers on one table fire in NAME order.** If one reads what the other sets, name
them so they sort correctly — `0153`/`0154` got this wrong once.

---

## 5. Assert the property that matters, not the one that is easy

`0173` attached an audit trigger and asserted the trigger was **attached**. It was. Every
write through it then failed, because the trigger assumed `school_id` was a UUID and on
`schools` it is the business identifier. The migration applied cleanly and broke renaming a
school.

> Attachment is not the property that matters. Surviving a write is.

So: perform a real write inside the migration and fail if the effect is absent.

---

## 6. Apply, exercise, regenerate, record

```bash
npm run db:push        # applies to the linked project
npm run db:types       # ALWAYS after a schema change
```

Then **exercise it against the real database** — in a transaction, rolled back:

```sql
BEGIN;
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','user_x','role','authenticated',
      'o', json_build_object('id', v_org, 'rol','principal'))::text, TRUE);
  ...
  RAISE NOTICE 'PASS  what was proved';
END;
$$;
ROLLBACK;
```

Run it with `npx supabase db query --linked --file <file>`.

**What to exercise, every time:**

1. the happy path
2. **each refusal** — wrong role, missing reason, bad input
3. **cross-tenant** — school B must not reach school A's row
4. idempotency, if the operation can run twice
5. `anon` cannot execute it:

```bash
node --env-file-if-exists=.env.local -e "
const url=process.env.NEXT_PUBLIC_SUPABASE_URL, anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
fetch(url+'/rest/v1/rpc/do_the_thing',{method:'POST',headers:{apikey:anon,'Content-Type':'application/json'},body:'{}'})
  .then(r=>console.log(r.status, (r.status===401||r.status===404)?'refused':'REACHABLE'));"
```

A test that fails teaches something. When one does, work out whether the **code** or the
**test** is wrong before changing either — both have been wrong in this repository, and
twice the test was.

Finally: update *Next Available Sequence Number* and the applied range in `MIGRATIONS.md`,
then `npm run ci:checks`.

---

## 7. Docs are a claim, the schema is the fact

Repeatedly a document has specified something the schema does not have. `STUDENTS.md` lists
`examination_number` (genuinely missing — added) and `alumni_status` (**correctly refused**,
because `status` already admits graduated/transferred/withdrawn, and two columns meaning one
thing is a question with no answer).

Build what the specification *means*. When it conflicts with the schema, say which you
followed and why — in the migration header, where the next person will find it.
