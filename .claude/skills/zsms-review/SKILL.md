---
name: zsms-review
description: Audit ZSMS for gaps between what is built and what is reachable, and for security and tenant-isolation mistakes. Use before a release, when asked what is missing or incomplete, after a large change, or when a module "looks unbuilt" — often the backend exists and only a screen is missing.
---

# Auditing ZSMS

Two questions, and they fail in different ways.

1. **Can a user reach what we built?** — the expensive one. Everything individually correct,
   the chain broken.
2. **Can a user reach what we built for somebody else?** — the dangerous one.

---

## Part 1 — reachability

```bash
npm run gaps
```

Prints `public` functions no source calls, and API routes no screen references. Both lists
carry curated exceptions with reasons (RLS predicates, trigger functions, worker-boundary
functions, `ENDPOINTS.md` routes the mobile app will use).

**The value is the diff.** A new entry is a chain somebody forgot to finish. Either wire it
up, or add it to `ACCEPTED` *with a reason* — the reason is what stops the list becoming a
place to hide things.

Then read the chain by hand for anything the script cannot see:

```
docs → schema → function/policy → API route → screen → a link to that screen
```

The last link is the one most often missing, and the only one no automated check finds.
`/parent/schools` was a good screen nothing pointed at.

A module that "looks unbuilt" is usually a complete backend with no screen. Check before
concluding anything is missing:

```bash
npm run db:cols -- <table>                 # does the table already hold these fields?
grep -rn "rpc('<fn>'" apps/web             # is the function called?
grep -rn "api/<route>" apps/web/app        # does a screen call the route?
```

Fee structures carried every documented field since `0070` and had GET and POST since then.
Only the editor was missing, so the whole module read as unbuilt.

### Things in the wrong schema

`supabase/config.toml` sets `schemas = ["public"]`. Anything in `afritech` is unreachable
from a route — no build error, a 404 the first time somebody clicks. It has happened four
times, most recently with a **table** (`afritech.teacher_hub_plans` granted UPDATE to
AfriTech and no route could ever use it).

```sql
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'afritech' AND p.prokind = 'f';
```

Each result needs a `public` wrapper, or a reason it does not.

---

## Part 2 — security

### Tenant isolation

```bash
npm run db:test        # 37 pgTAP suites — needs Docker, runs in CI
```

Then, for anything new, exercise against the real database what the suites do not yet cover:

- **school B must not reach school A's row** — for every new function and policy;
- **a SECURITY DEFINER function must never trust an id argument.** Taking `p_school_id` on
  trust lets any caller read any school by changing a query string. AfriTech may name a
  school; everybody else resolves from the session and the argument is ignored;
- **`anon` must be refused** every new RPC;
- **worker boundary**: `.from(` anywhere in `apps/workers` is a defect — the service role
  bypasses RLS, so all worker access goes through `worker_*` functions.

### Role checks

- `can()` in a route hides a control. It is **not** security — a direct PostgREST call skips
  the route entirely. The policy or the function's own check is the enforcement.
- One rule, one place. A route that re-checks what a function already refuses is a second
  copy that will drift, and it is the copy that can be bypassed.
- Clerk sends the **bare** role (`owner`), not `org:owner`, in `o.rol`.

### What a refusal reveals

Not found and not permitted should be **one answer**. "That fee line is not available"
rather than "forbidden", which confirms the row exists. An unknown school code is
deliberately indistinguishable from a real one, or anyone with a free account could
enumerate which schools are customers.

### Audit

Every act that changes money, a child's record, or who can see what should reach
`audit_logs` — and `afritech` tables have **no** row-change trigger, so anything written
there needs an explicit `log_audit_event()` call.

---

## Part 3 — what to report

Separate these three, because they need different decisions:

| Category | Meaning | Action |
|---|---|---|
| **Backend built, no UI** | work already paid for, unreachable | wire it up — cheapest value available |
| **Documented, no backend** | a module, not a gap | schedule it; do not "fix" it in a UI pass |
| **Blocked on configuration** | code complete, credentials missing | name the blocker; never ship a button that cannot work |

Say what you verified and how. Give counts. If a conclusion rests on a grep, say so — a
first audit pass of this codebase reported eight "dead routes" that were nothing of the
kind: one held **the only receipt-generation trigger in the codebase**, and deleting them
would have silently removed it.

Verify before recommending deletion.
