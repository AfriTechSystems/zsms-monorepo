'use client'

/**
 * Renders one school-defined field as the right control for its type.
 *
 * Spec: migrations `0110` / `0111`
 *
 * ## One renderer, so the enrol form and the pupil record cannot disagree
 *
 * Both screens show the same school-defined fields. Rendered separately they
 * would drift — one would forget the help text, one would offer a text box for a
 * choice field — and a school would get different data depending on which door
 * it came through. Same argument as `coerceCustomValue` on the parsing side.
 *
 * ## A field the reader may not see says so
 *
 * When `readable` is false the value genuinely is not in the response: RLS
 * removed it. Rendering an empty box there would read as "nobody has filled
 * this in", and for a medical field that is a dangerous thing to imply. So it
 * renders as a locked note instead.
 */

import type { JSX } from 'react'
import { Lock } from 'lucide-react'

import { Field, Input, Select } from './field'
import type { CustomFieldDef } from '../../lib/custom-fields'

export interface CustomFieldState extends CustomFieldDef {
  help_text?: string | null
  /** False when the caller may not read this field's value — see below. */
  readable?: boolean
  /** Absent on the per-pupil endpoint, which returns active fields only. */
  is_active?: boolean
}

interface Props {
  field: CustomFieldState
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

export function CustomFieldInput({ field, value, onChange, disabled }: Props): JSX.Element {
  const id = `cf-${field.field_key}`

  if (field.readable === false) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-foreground">{field.label}</span>
        <p className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Lock aria-hidden="true" className="size-4 shrink-0" />
          {/* Deliberately not "empty". This field may well have a value. */}
          Only the head teacher and the school owner can see this.
        </p>
      </div>
    )
  }

  const hint = field.help_text ?? undefined

  switch (field.field_type) {
    case 'boolean':
      return (
        <Field id={id} label={field.label} hint={hint} required={field.is_required}>
          {(props) => (
            <Select
              {...props}
              value={value}
              disabled={disabled}
              onChange={(e) => onChange(e.target.value)}
            >
              {/* An empty option first: "not recorded" is a real state and must
                  not collapse into "No". */}
              <option value="">Not recorded</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Select>
          )}
        </Field>
      )

    case 'select':
      return (
        <Field id={id} label={field.label} hint={hint} required={field.is_required}>
          {(props) => (
            <Select
              {...props}
              value={value}
              disabled={disabled}
              onChange={(e) => onChange(e.target.value)}
            >
              <option value="">Not recorded</option>
              {field.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )

    case 'multi_select':
      return (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-sm font-medium text-foreground">
            {field.label}
            {field.is_required && <span aria-hidden="true" className="text-danger"> *</span>}
          </legend>
          {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
          <div className="flex flex-wrap gap-3 pt-1">
            {field.options.map((o) => {
              // Held as a semicolon-joined string so the whole form is one flat
              // Record<string,string> — the same wire shape the importer uses,
              // which is why the separator is defined in one place.
              const selected = value ? value.split(';').map((v) => v.trim()) : []
              const on = selected.includes(o)
              return (
                <label key={o} className="flex min-h-tap items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={disabled}
                    onChange={() =>
                      onChange(
                        (on ? selected.filter((s) => s !== o) : [...selected, o]).join('; '),
                      )
                    }
                    className="size-4 rounded border-border text-primary focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  {o}
                </label>
              )
            })}
          </div>
        </fieldset>
      )

    case 'number':
      return (
        <Field id={id} label={field.label} hint={hint} required={field.is_required}>
          {(props) => (
            <Input
              {...props}
              type="number"
              step="any"
              inputMode="decimal"
              value={value}
              disabled={disabled}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        </Field>
      )

    case 'date':
      return (
        <Field id={id} label={field.label} hint={hint} required={field.is_required}>
          {(props) => (
            <Input
              {...props}
              type="date"
              value={value}
              disabled={disabled}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        </Field>
      )

    case 'text':
    default:
      return (
        <Field id={id} label={field.label} hint={hint} required={field.is_required}>
          {(props) => (
            <Input
              {...props}
              value={value}
              maxLength={2000}
              disabled={disabled}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        </Field>
      )
  }
}
