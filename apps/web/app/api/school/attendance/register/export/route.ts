/**
 * GET /api/school/attendance/register/export?classId=…&date=YYYY-MM-DD
 *
 * Spec: `Official Documentation/10 Attendance/ATTENDANCE.md` → *Attendance Reports*
 *       `Official Documentation/13 Document and PDF System/PDF_GENERATION.md`
 *       `Official Documentation/19 Design System/ZSMS Teacher App Dashboard Flow.png`
 *         — the "Download Attendance Report" button on the register's Summary panel
 *
 * ## Synchronous, and nothing is stored
 *
 * Report cards are queued because it is four hundred documents at once and the batch
 * takes ninety seconds. This is one register a teacher is standing still waiting for,
 * and queuing it would make a download depend on Redis and on a worker being up. The
 * teaching-resource export made the same call for the same reason.
 *
 * It also writes no `generated_documents` row and puts nothing in R2. That table
 * exists so a receipt or a report card can be found again later, because those are
 * records a parent may ask for months afterwards. A register is reproducible from the
 * attendance rows at any time, so storing the rendering would be storing a second
 * copy of a fact the database already holds — and one that silently goes stale the
 * moment a mark is corrected.
 *
 * ## Entitlement is the policy's, and the roll is the register
 *
 * Performed as the caller with `createUserClient()`. The same query the register
 * screen runs, so a teacher who may not read this class's attendance gets the same
 * empty answer here as there, and no `schoolId` is accepted from the request —
 * taking one would move the decision out of the policies and into this file.
 *
 * Only pupils on the roll are included, and `status` stays NULL for anybody unmarked.
 * The renderer prints an em dash for those and says so in its footer: an unopened
 * register must never read as a day of absence, and on paper that error outlives the
 * correction.
 */

import type { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { getAuthProvider, type Role } from '@zsms/auth-provider'
import { renderAttendanceRegister } from '@zsms/documents'

import { createUserClient } from '../../../../../../lib/supabase'
import { AFRITECH_ORG_SLUG } from '../../../../../../lib/admin-context'
import { can } from '../../../../../../lib/roles'
import { fail, fromPostgrestError, guard, validationFailed } from '../../../../../../lib/api-response'

const querySchema = z.object({
  classId: z.string().min(1).max(32),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD.'),
})

/*
  The same helper the sibling register route keeps, and for the same reason: a
  `route.ts` may export nothing but handlers — an extra export builds cleanly and
  fails at runtime, which this repository has already paid for once. Three routes now
  carry this copy; consolidating them into `lib/` is a worthwhile cleanup and not one
  to bundle inside a feature.
*/
async function resolveCaller(): Promise<
  { ok: true; role: Role | 'none'; userId: string } | { ok: false; response: NextResponse }
> {
  const session = await getAuthProvider().getSessionUser()
  if (!session) return { ok: false, response: fail('UNAUTHORIZED', 'Authentication required.') }
  if (session.organisationSlug === AFRITECH_ORG_SLUG || !session.organisationId) {
    return { ok: false, response: fail('FORBIDDEN', 'This is a school endpoint.') }
  }
  return { ok: true, role: session.role, userId: session.userId }
}

export async function GET(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const caller = await resolveCaller()
    if (!caller.ok) return caller.response

    if (!can(caller.role, 'attendance:read')) {
      return fail('FORBIDDEN', 'Your role does not include attendance.')
    }

    const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams))
    if (!parsed.success) return validationFailed(parsed.error)

    const { classId, date } = parsed.data

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const [pupils, marks, school] = await Promise.all([
      client
        .from('students')
        .select('student_id, id, first_name, last_name')
        .eq('class_id', classId)
        .eq('is_deleted', false)
        .in('status', ['active', 'on_leave'])
        .order('last_name', { ascending: true }),
      client
        .from('attendance_records')
        .select('student_id, status, excuse_reason')
        .eq('class_id', classId)
        .eq('attendance_date', date),
      client.from('schools').select('name, school_id').limit(1).maybeSingle(),
    ])

    if (pupils.error) return fromPostgrestError(pupils.error)
    if (marks.error) return fromPostgrestError(marks.error)

    /*
      An empty roll is a 404 rather than an empty PDF. A register for a class with
      nobody in it is not a document anybody wants filed, and handing one over invites
      the reader to conclude the class was absent.
    */
    if ((pupils.data ?? []).length === 0) {
      return fail('NOT_FOUND', 'No pupils are enrolled in this class.')
    }

    const byStudent = new Map((marks.data ?? []).map((m) => [m.student_id as string, m]))

    const rendered = await renderAttendanceRegister({
      school: {
        name: (school.data?.name as string) ?? 'School',
        schoolCode: (school.data?.school_id as string) ?? '',
      },
      className: classId,
      date,
      rows: (pupils.data ?? []).map((p) => {
        const mark = byStudent.get(p.id as string)
        return {
          studentNumber: (p.student_id as string) ?? '',
          studentName: `${p.first_name as string} ${p.last_name as string}`,
          status: (mark?.status as string | undefined) ?? null,
          note: (mark?.excuse_reason as string | undefined) ?? null,
        }
      }),
    })

    return new Response(rendered.bytes as BodyInit, {
      headers: {
        'Content-Type': rendered.contentType,
        /*
          `attachment`, so a phone saves it rather than opening a PDF viewer over the
          register the teacher is still working in.
        */
        'Content-Disposition': `attachment; filename="${rendered.suggestedFilename}"`,
        // A register changes when a mark is corrected, and a cached copy of yesterday's
        // rendering is exactly the stale evidence this route avoids storing.
        'Cache-Control': 'no-store',
      },
    })
  })
}
