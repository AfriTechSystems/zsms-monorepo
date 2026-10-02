---
name: zsms-feature
description: Build a ZSMS feature end to end so that database, API route, UI and permissions all match and the user can actually reach it. Use when adding or completing any user-facing capability in the web app. Covers the reachability chain, the permission matrix, API envelope, and what to verify before claiming it works.
---

# Building a ZSMS feature end to end

The most expensive failure in this repository is **not a bug**. It is work that is built,
tested, correct — and that no user can get to.

A 2026-10-02 audit found:

- `unlock_result_for_correction()`: a whole migration for correcting a published mark, with
  no route and no screen.
- `generated_documents`, the report-card worker, the PDF renderer: three correct pieces that
  met nowhere, so no school could produce a report card.
- `generate-receipt` enqueued from a route **no screen has ever called** — so no receipt had
  ever been generated for anybody.
- `revise_fee_records()`, `notification_templates`, `school_message_quotas`: no caller.
- `/parent/schools`: a good screen nothing linked to.

Every piece was individually fine. Only the **chain** was broken, and nothing checked chains.

```
docs → schema → function/policy → API route → screen → a link somebody can press
```

A feature is finished when all six exist. Run `npm run gaps` to see what is missing.

---

## 1. Read the spec, then check it against the schema

Find the module doc under `Official Documentation/` (folder map in `CLAUDE.md`; the
cross-reference paths inside the docs are wrong, resolve by filename).

Then verify every field it names actually exists — `npm run db:cols -- <table>`. Documents
here routinely describe what the schema cannot do. When they conflict, build what the spec
*means* and record which you followed.

Check whether the backend already exists before writing any. Several "missing" features
turned out to be complete backends with no screen:

```bash
npm run gaps                      # functions and routes nothing reaches
grep -rn "rpc('name'" apps/web    # is this function called anywhere?
```

---

## 2. Permissions: use what exists, never invent

`apps/web/lib/roles.ts` is the matrix. **Read it before gating anything.** Writing
`can(role, 'settings:read')` when only `settings:write` exists silently denies everybody —
`can()` returns false for an unknown key.

Two layers, and they are not interchangeable:

| Layer | Does | Is not |
|---|---|---|
| `can()` in a route/screen | hides and refuses early, with a readable message | security — a direct PostgREST call skips it |
| RLS policy / function role check | the actual enforcement | user-friendly |

**One rule, one place.** If a SECURITY DEFINER function already refuses non-principals, the
route does **not** re-check: a second copy drifts, and the route is the half a direct
PostgREST call bypasses. Let the function refuse and map its error code.

---

## 3. The API route

```ts
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client.rpc('thing', { p_x: parsed.data.x }).maybeSingle()

    if (error) {
      // Map the function's own codes to answers a user should read.
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      if (error.code === '22023') return fail('VALIDATION_ERROR', error.message)
      return fromPostgrestError(error)
    }
    return ok({ ... })
  })
}
```

- The envelope is fixed: `{ data, meta? }` / `{ error, code, details? }`, `code` one of
  `VALIDATION_ERROR | UNAUTHORIZED | FORBIDDEN | NOT_FOUND | CONFLICT | SERVER_ERROR`.
  Helpers: `ok`, `created`, `fail`, `validationFailed`, `fromPostgrestError`, `guard`.
  **There is no `accepted`** — don't add a fourth success shape.
- **The PostgREST `select` string must be ONE literal.** Concatenating it kills row-type
  inference, and `...data` stops being spreadable with a confusing error.
- **Not found and not permitted are one answer.** Distinguishing them confirms another
  school's row exists.
- A secondary read that fails should not fail the page. Return the main record with
  `xLoaded: false` and let the screen say so.

---

## 4. The screen, and the link to it

The screen is not the end of the chain — **something must link to it.** `/parent/schools`
existed, worked, and was unreachable because nothing pointed at it.

- A control that appears on more than one page belongs in the **shell or layout**, not
  copied per page. The parent child-picker was on three screens out of five; the Teacher Hub
  signed-out branch was on one page out of four. Both were fixed by moving the single copy
  up a level, where every current and future page gets it.
- **Two copies of one decision is how one of them drifts.** Delete the duplicate.
- Use existing primitives and their real variants: `Button` has
  `default | destructive | outline | secondary | ghost | link` — there is no `danger`.
  `StatCard` takes an optional `href` so a figure opens what it summarises.
- Tokens, never hex: `bg-surface`, `text-muted-foreground`, `border-border`, `p-card`,
  `gap-stack`, `min-h-tap`. Numeric figures get `data-numeric` so they align.
- Every list needs an empty state that says what to do, and every failure a message that
  names the cause. "Try again" on an auth failure is a lie — retrying never helps.

---

## 5. Verify the whole chain, not the piece you wrote

```bash
npm run type-check && npm run lint
npm run gaps                 # did I leave a new orphan?
npm run ci:checks            # stop the dev server first — next build wedges it
```

Then **walk the user's path**, which is where the real defects are. Two found this way in
one pass, both invisible to every automated check:

- the mark input stayed `disabled` after a correction was unlocked, because the lock was
  read from a sheet-level flag rather than the row — so the correction could not be typed;
- the Save button was hidden whenever any row was published, so the only control that could
  save a correction disappeared exactly when one was possible.

Ask: *can a real person with the right role actually complete this, start to finish?*

---

## 6. Report honestly

Say what was verified and how. If something is blocked, name the blocker rather than
shipping a button that cannot work — report cards generate correctly and cannot be
delivered, because R2 has no credentials, and the screen and `CLAUDE.md` both say so.

When a check fails, decide whether the **code** or the **test** is wrong before changing
either. Both have been wrong here; twice it was the test.
