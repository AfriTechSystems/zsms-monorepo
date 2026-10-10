/**
 * Coercing a submitted or imported value into the column its field declares.
 *
 * Spec: migrations `0110` / `0111`
 *
 * ## One implementation, used by the form and the importer
 *
 * A CSV cell and a form input are both strings that have to land in
 * `value_text`, `value_number`, `value_date`, `value_boolean` or `value_json`. If
 * the form and the importer each did their own coercion they would disagree —
 * typically about blanks and about how forgiving "yes" is — and a school would
 * get different data depending on which door it came through.
 *
 * The database validates independently (`validate_student_custom_value`), so
 * this is about *good messages and consistent parsing*, not about safety. A value
 * that slips past here is still refused there.
 */

export type FieldType = 'text' | 'number' | 'date' | 'boolean' | 'select' | 'multi_select'

export interface CustomFieldDef {
  id: string
  field_key: string
  label: string
  field_type: FieldType
  options: string[]
  is_required: boolean
  sensitivity: 'standard' | 'sensitive'
}

/** The five value columns, exactly one of which may be populated. */
export interface CustomValueColumns {
  value_text: string | null
  value_number: number | null
  value_date: string | null
  value_boolean: boolean | null
  value_json: string[] | null
}

const EMPTY: CustomValueColumns = {
  value_text: null,
  value_number: null,
  value_date: null,
  value_boolean: null,
  value_json: null,
}

/**
 * Words a Zambian school actually types for yes and no.
 *
 * Deliberately not `Boolean(cell)` — that makes the string "no" true, which is
 * the kind of bug that quietly marks every pupil as a boarder.
 */
const TRUE_WORDS = new Set(['true', 'yes', 'y', '1', 'boarding', 'boarder'])
const FALSE_WORDS = new Set(['false', 'no', 'n', '0', 'day'])

export type CoerceResult =
  | { ok: true; columns: CustomValueColumns; empty: boolean }
  | { ok: false; message: string }

/**
 * Turns one raw cell into the right column for `field`.
 *
 * An empty cell is `empty: true` with all columns null — meaning "no answer",
 * which is a legitimate state and distinct from a wrong answer. The caller
 * decides whether an empty answer is acceptable for a required field, because
 * the right response differs: a form blocks, an import reports the row.
 */
export function coerceCustomValue(field: CustomFieldDef, raw: unknown): CoerceResult {
  const cell = typeof raw === 'string' ? raw.trim() : raw
  const isEmpty =
    cell === null ||
    cell === undefined ||
    cell === '' ||
    (Array.isArray(cell) && cell.length === 0)

  if (isEmpty) return { ok: true, columns: { ...EMPTY }, empty: true }

  switch (field.field_type) {
    case 'number': {
      const n = typeof cell === 'number' ? cell : Number(String(cell).replace(/,/g, ''))
      if (!Number.isFinite(n)) {
        return { ok: false, message: `"${String(cell)}" is not a number.` }
      }
      return { ok: true, columns: { ...EMPTY, value_number: n }, empty: false }
    }

    case 'date': {
      const text = String(cell)
      // ISO only. Accepting `03/04/2026` would silently read as March in one
      // place and April in another, and a pupil's date is not worth that guess —
      // the importer's template says YYYY-MM-DD for the same reason.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return { ok: false, message: `"${text}" is not a date. Use YYYY-MM-DD.` }
      }
      const d = new Date(`${text}T00:00:00Z`)
      if (Number.isNaN(d.getTime())) {
        return { ok: false, message: `"${text}" is not a real date.` }
      }
      return { ok: true, columns: { ...EMPTY, value_date: text }, empty: false }
    }

    case 'boolean': {
      if (typeof cell === 'boolean') {
        return { ok: true, columns: { ...EMPTY, value_boolean: cell }, empty: false }
      }
      const word = String(cell).toLowerCase()
      if (TRUE_WORDS.has(word)) {
        return { ok: true, columns: { ...EMPTY, value_boolean: true }, empty: false }
      }
      if (FALSE_WORDS.has(word)) {
        return { ok: true, columns: { ...EMPTY, value_boolean: false }, empty: false }
      }
      return { ok: false, message: `"${String(cell)}" is not yes or no.` }
    }

    case 'select': {
      const text = String(cell)
      // Checked here so the message can list the choices. The database refuses
      // it too — this is the better sentence, not the guarantee.
      if (!field.options.includes(text)) {
        return {
          ok: false,
          message: `"${text}" is not one of: ${field.options.join(', ')}.`,
        }
      }
      return { ok: true, columns: { ...EMPTY, value_text: text }, empty: false }
    }

    case 'multi_select': {
      // A CSV carries several choices as one cell, so a separator is needed.
      // Semicolon rather than comma: a comma inside a quoted CSV cell survives
      // parsing but reads as a separator here, which would split "Netball, Choir"
      // differently depending on the quoting.
      const parts = Array.isArray(cell)
        ? cell.map(String)
        : String(cell)
            .split(';')
            .map((p) => p.trim())
            .filter(Boolean)

      const unknown = parts.filter((p) => !field.options.includes(p))
      if (unknown.length > 0) {
        return {
          ok: false,
          message: `${unknown.map((u) => `"${u}"`).join(', ')} not among: ${field.options.join(', ')}.`,
        }
      }
      return { ok: true, columns: { ...EMPTY, value_json: parts }, empty: false }
    }

    case 'text':
    default: {
      const text = String(cell)
      if (text.length > 2000) {
        return { ok: false, message: 'That answer is too long (2000 characters maximum).' }
      }
      return { ok: true, columns: { ...EMPTY, value_text: text }, empty: false }
    }
  }
}

/** Reads whichever column a stored row populated back into one display value. */
export function readCustomValue(
  field: CustomFieldDef,
  row: Partial<CustomValueColumns> | null | undefined,
): string {
  if (!row) return ''
  switch (field.field_type) {
    case 'number':
      return row.value_number === null || row.value_number === undefined
        ? ''
        : String(row.value_number)
    case 'date':
      return row.value_date ?? ''
    case 'boolean':
      return row.value_boolean === null || row.value_boolean === undefined
        ? ''
        : row.value_boolean
          ? 'Yes'
          : 'No'
    case 'multi_select':
      return Array.isArray(row.value_json) ? row.value_json.join('; ') : ''
    default:
      return row.value_text ?? ''
  }
}
