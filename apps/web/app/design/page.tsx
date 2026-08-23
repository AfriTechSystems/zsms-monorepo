/**
 * Design foundation preview.
 *
 * Not a portal screen and not shipped to users — this is the reference for the
 * design system, and the place where the contrast audit is visible rather than
 * only asserted in a test file.
 *
 * Everything on this page reads from `@zsms/design-tokens`. Nothing is
 * hardcoded, so the page is also the proof that the token pipeline works
 * end-to-end: change a token, reload, see it here.
 */

import {
  auditTheme,
  BRAND,
  contrastRatio,
  NEUTRAL,
  resolveTheme,
  TYPOGRAPHY,
  type ColorScale,
} from '@zsms/design-tokens'
import {
  BookOpen,
  CalendarCheck,
  Clock,
  Download,
  Plus,
  Receipt,
  Trash2,
  TriangleAlert,
  Users,
  Wallet,
} from 'lucide-react'

import { Alert } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/empty-state'
import { Field, Input, Select } from '../../components/ui/field'
import { Skeleton, LoadingRegion } from '../../components/ui/skeleton'
import { StatCard, type StatTone } from '../../components/ui/stat-card'
import { ThemeToggle } from '../../components/ui/theme-toggle'
import { BrandSplash } from '../../components/brand/brand-splash'
import { SchoolLogo } from '../../components/brand/school-logo'
import { AttendanceCard } from '../../components/domain/attendance-card'
import { FeeCard } from '../../components/domain/fee-card'
import type { JSX } from 'react'

export const metadata = { title: 'Design foundation · ZSMS' }

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <section id={id} className="scroll-mt-8 space-y-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-1 max-w-3xl text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  )
}

function Swatch({ hex, label, on }: { hex: string; label: string; on?: string }): JSX.Element {
  const ratio = on ? contrastRatio(on, hex) : contrastRatio(hex, '#FFFFFF')
  return (
    <div className="space-y-1">
      <div
        className="flex h-16 items-end justify-between rounded-md border border-border p-2"
        style={{ backgroundColor: hex, color: on ?? undefined }}
      >
        {on && <span className="text-xs font-medium">Aa</span>}
      </div>
      <div className="space-y-0.5">
        <p className="text-xs font-medium">{label}</p>
        <p data-numeric className="font-mono text-xs text-subtle">
          {hex}
        </p>
        <p data-numeric className="text-xs text-muted-foreground">
          {ratio.toFixed(2)}:1 {on ? 'text' : 'vs white'}
        </p>
      </div>
    </div>
  )
}

const SCALE_STEPS: Array<{ key: keyof ColorScale; label: string; role: string }> = [
  { key: 50, label: '50', role: 'wash' },
  { key: 100, label: '100', role: 'chip' },
  { key: 200, label: '200', role: 'edge' },
  { key: 500, label: '500', role: 'brand' },
  { key: 'mark', label: 'mark', role: 'icon' },
  { key: 600, label: '600', role: 'solid' },
  { key: 700, label: '700', role: 'text' },
  { key: 800, label: '800', role: 'deep' },
]

function ScaleRow({ name, scale, note }: { name: string; scale: ColorScale; note: string }): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3 className="text-base font-semibold capitalize">{name}</h3>
        <p className="text-sm text-muted-foreground">{note}</p>
      </div>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
        {SCALE_STEPS.map(({ key, label, role }) => (
          <div key={label} className="space-y-1">
            <div
              className="h-12 rounded-md border border-border"
              style={{ backgroundColor: scale[key] }}
            />
            <p className="text-xs font-medium">
              {label} <span className="font-normal text-subtle">{role}</span>
            </p>
            <p data-numeric className="font-mono text-[11px] text-subtle">
              {scale[key]}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * A row of stat cards rendered inside a forced theme.
 *
 * The dark row is drawn with the dark tokens applied inline rather than by
 * toggling the page, so both modes are visible at once — which is the only way
 * to judge whether they are the same design or two designs.
 */
function TintRow({ tone }: { tone: 'light' | 'dark' }): JSX.Element {
  const cards: Array<{ label: string; value: string; hint: string; tone: StatTone; icon: JSX.Element }> = [
    { label: 'Collected this term', value: 'K 412,900', hint: '78% of billed', tone: 'success', icon: <Wallet /> },
    { label: 'Due within 7 days', value: 'K 68,400', hint: '54 families', tone: 'warning', icon: <Clock /> },
    { label: 'In arrears', value: 'K 91,250', hint: '31 families', tone: 'danger', icon: <TriangleAlert /> },
    { label: 'Students enrolled', value: '1,284', hint: 'across 34 classes', tone: 'neutral', icon: <Users /> },
    { label: 'Attendance today', value: '94.2%', hint: '74 absent', tone: 'info', icon: <CalendarCheck /> },
    { label: 'Receipts issued', value: '318', hint: 'this week', tone: 'primary', icon: <Receipt /> },
  ]

  return (
    <div data-theme={tone} className="rounded-xl border border-border bg-background p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <StatCard key={c.label} {...c} />
        ))}
      </div>
    </div>
  )
}

export default function DesignFoundationPage(): JSX.Element {
  const zsms = resolveTheme(null)
  // A plausible school theme — deep maroon and forest green, nothing like the
  // ZSMS defaults, to show the derivation holding up on unfamiliar input.
  const school = resolveTheme({
    anchorColor: '#5B1A1A',
    primaryColor: '#1F6F3F',
    schoolName: 'Kabulonga Girls Secondary School',
  })

  const lightAudit = auditTheme(zsms.light)
  const darkAudit = auditTheme(zsms.dark)
  const allPass = [...lightAudit, ...darkAudit].every((r) => r.ok)

  const typeScale: Array<[string, string, string]> = [
    ['4xl', 'text-4xl', 'Page title'],
    ['3xl', 'text-3xl', 'Section heading'],
    ['2xl', 'text-2xl', 'Card group heading'],
    ['xl', 'text-xl', 'Card title'],
    ['lg', 'text-lg', 'Subheading'],
    ['base', 'text-base', 'Body — the default'],
    ['sm', 'text-sm', 'Secondary text, table cells'],
    ['xs', 'text-xs', 'Labels, metadata'],
  ]

  return (
    <div className="min-h-screen bg-background">
      {/*
        The navigation is a white surface with navy INK on it, not a navy block.
        That is the single most visible consequence of the retune: the anchor
        colour now does its work as text and structure, and the airiness comes
        from what is left uncoloured.
      */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <SchoolLogo initials="ZS" schoolName="ZSMS" />
            <div>
              <p className="text-base font-semibold text-foreground">ZSMS Design Foundation</p>
              <p className="text-sm text-muted-foreground">Phase 4 · Step 1</p>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main id="main" className="mx-auto max-w-6xl space-y-14 px-4 py-10 sm:px-6">
        <Alert variant={allPass ? 'success' : 'danger'} title={allPass ? 'WCAG AA: all pairings pass' : 'WCAG AA: failures found'}>
          <p>
            {lightAudit.length + darkAudit.length} foreground/background pairings measured across light
            and dark. These are the same assertions the token test suite runs.
          </p>
        </Alert>

        {/* ---------------------------------------------------------------- */}
        <Section
          id="palette"
          title="Palette"
          description="The brand colours as supplied, and what had to be derived from them. Only navy is safe as text at its given value — the rest are measured below."
        >
          <div>
            <h3 className="mb-3 text-base font-semibold">Brand, as supplied</h3>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {Object.entries(BRAND).map(([name, hex]) => (
                <Swatch key={name} hex={hex} label={name} />
              ))}
            </div>
            <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
              Measured against the page ground, <strong>five of the six fail</strong> the 4.5:1 minimum
              for normal text, and amber and teal fail even the 3:1 bar for interface elements. Used
              flat, blue would fail both as a link and as a white label on a button — so each hue
              becomes a scale. Only the anchor navy, which is deliberately a near-charcoal, is safe as
              ink at its given value.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-card p-5">
            <h3 className="mb-2 text-base font-semibold">Surfaces</h3>
            <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
              The page is a soft lavender-grey and the cards are white — not the other way round. A
              white page with white cards has to draw every boundary with a line; a tinted ground lets
              a card sit on the page without one.
            </p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Swatch hex={zsms.light.surface.background} label="page (light)" />
              <Swatch hex={zsms.light.surface.surface} label="card (light)" />
              <Swatch hex={zsms.dark.surface.background} label="page (dark)" on={zsms.dark.surface.text} />
              <Swatch hex={zsms.dark.surface.surface} label="card (dark)" on={zsms.dark.surface.text} />
            </div>
          </div>

          <div className="space-y-6 rounded-lg border border-border bg-card p-5">
            <p className="max-w-3xl text-sm text-muted-foreground">
              <strong>Light scales.</strong> <code className="font-mono text-xs">500</code> is the brand
              hex untouched. <code className="font-mono text-xs">mark</code> is derived to clear 3:1
              against this hue&rsquo;s own <code className="font-mono text-xs">100</code> chip — flat brand
              amber measures 1.80:1 there, which is a status dot nobody can see.
            </p>
            <ScaleRow name="anchor" scale={zsms.light.colors.anchor} note="Navy — ink, structure, the lavender chip" />
            <ScaleRow name="primary" scale={zsms.light.colors.primary} note="Blue — the single action colour" />
            <ScaleRow name="success" scale={zsms.light.colors.success} note="Green — paid, present" />
            <ScaleRow name="warning" scale={zsms.light.colors.warning} note="Amber — due soon, partial" />
            <ScaleRow name="danger" scale={zsms.light.colors.danger} note="Coral — overdue, arrears, destructive" />
            <ScaleRow name="accent" scale={zsms.light.colors.accent} note="Teal — informational" />
          </div>

          <div data-theme="dark" className="space-y-6 rounded-lg border border-border bg-card p-5">
            <p className="max-w-3xl text-sm text-muted-foreground">
              <strong>Dark scales</strong>, derived against the dark card rather than inverted. Every
              step is desaturated: a fully saturated hue on charcoal vibrates rather than glows, and
              that is fatigue over a long shift rather than emphasis.
            </p>
            <ScaleRow name="anchor" scale={zsms.dark.colors.anchor} note="Now a light ink, not a dark block" />
            <ScaleRow name="primary" scale={zsms.dark.colors.primary} note="Blue" />
            <ScaleRow name="success" scale={zsms.dark.colors.success} note="Green" />
            <ScaleRow name="warning" scale={zsms.dark.colors.warning} note="Amber" />
            <ScaleRow name="danger" scale={zsms.dark.colors.danger} note="Coral" />
            <ScaleRow name="accent" scale={zsms.dark.colors.accent} note="Teal" />
          </div>

          <div>
            <h3 className="mb-3 text-base font-semibold">Neutrals</h3>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-12">
              {Object.entries(NEUTRAL).map(([step, hex]) => (
                <div key={step} className="space-y-1">
                  <div className="h-10 rounded-md border border-border" style={{ backgroundColor: hex }} />
                  <p className="text-xs font-medium">{step}</p>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          id="contrast"
          title="Contrast audit"
          description="Every pairing the interface actually renders, measured. This table is generated, not written."
        >
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">WCAG AA contrast measurements for light and dark themes</caption>
              <thead className="bg-sunken text-left">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Pairing</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Light</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Dark</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {lightAudit.map((row, i) => {
                  const dark = darkAudit[i]
                  const ok = row.ok && (dark?.ok ?? false)
                  return (
                    <tr key={row.pair} className="border-t border-border">
                      <th scope="row" className="px-4 py-2.5 text-left font-normal">{row.pair}</th>
                      <td data-numeric className="px-4 py-2.5 text-right">{row.ratio.toFixed(2)}</td>
                      <td data-numeric className="px-4 py-2.5 text-right">{dark?.ratio.toFixed(2) ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant={ok ? 'success' : 'danger'}>{ok ? 'Pass' : 'Fail'}</Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          id="typography"
          title="Typography"
          description="Inter throughout, self-hosted. Body is 15px rather than 16px — at 16px a fees table fits noticeably fewer rows, and this is a product people scan all day."
        >
          <Card>
            <CardContent className="divide-y divide-border p-0">
              {typeScale.map(([name, cls, use]) => (
                <div key={name} className="flex flex-wrap items-baseline justify-between gap-3 px-5 py-3">
                  <p className={cls}>The quick brown fox</p>
                  <div className="text-right">
                    <p className="font-mono text-xs text-subtle">{name}</p>
                    <p className="text-xs text-muted-foreground">{use}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tabular figures</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-sm text-muted-foreground">Proportional — ragged</p>
                <div style={{ fontVariantNumeric: 'proportional-nums' }} className="space-y-0.5 font-mono text-sm">
                  <p>1,200.00</p>
                  <p>990.00</p>
                  <p>11,145.50</p>
                </div>
              </div>
              <div>
                <p className="mb-1 text-sm text-muted-foreground">Tabular — aligned (the default here)</p>
                <div data-numeric className="space-y-0.5 font-mono text-sm">
                  <p>1,200.00</p>
                  <p>990.00</p>
                  <p>11,145.50</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          id="buttons"
          title="Buttons"
          description="One filled blue action per view. Everything else steps down in weight so the primary action is never in competition."
        >
          <Card>
            <CardContent className="space-y-6 pt-5">
              <div className="flex flex-wrap items-center gap-3">
                <Button><Plus aria-hidden="true" />Add student</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline"><Download aria-hidden="true" />Export</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="link">Link style</Button>
                <Button variant="destructive"><Trash2 aria-hidden="true" />Delete</Button>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm">Small</Button>
                <Button>Default (44px target)</Button>
                <Button size="lg">Large</Button>
                <Button size="icon" aria-label="Add"><Plus aria-hidden="true" /></Button>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button loading loadingText="Saving…">Save</Button>
                <Button disabled>Disabled</Button>
                <Button variant="outline" disabled>Disabled outline</Button>
              </div>
            </CardContent>
          </Card>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          id="forms"
          title="Form fields"
          description="Label, hint, control, and error wired together as one unit — htmlFor, aria-describedby, aria-invalid, and a role=alert error that is actually announced."
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>States</CardTitle></CardHeader>
              <CardContent className="space-y-5">
                <Field id="demo-name" label="Student full name" required hint="As it appears on the birth certificate.">
                  {(p) => <Input {...p} defaultValue="Chanda Mwale" />}
                </Field>

                <Field
                  id="demo-amount"
                  label="Amount paid"
                  required
                  error="Enter an amount greater than zero."
                >
                  {(p) => <Input {...p} defaultValue="0" inputMode="decimal" />}
                </Field>

                <Field id="demo-term" label="Term">
                  {(p) => (
                    <Select {...p} defaultValue="1">
                      <option value="1">Term 1</option>
                      <option value="2">Term 2</option>
                      <option value="3">Term 3</option>
                    </Select>
                  )}
                </Field>

                <Field id="demo-locked" label="School code" hint="Assigned by AfriTech and cannot be changed.">
                  {(p) => <Input {...p} defaultValue="ZM-LSK-0001" disabled />}
                </Field>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader><CardTitle>Loading</CardTitle></CardHeader>
                <CardContent>
                  <LoadingRegion label="Loading students">
                    <div className="space-y-3">
                      {[0, 1, 2].map((i) => (
                        <div key={i} className="flex items-center gap-3">
                          <Skeleton className="size-10 rounded-full" />
                          <div className="flex-1 space-y-1.5">
                            <Skeleton className="h-3.5 w-1/3" />
                            <Skeleton className="h-3 w-1/4" />
                          </div>
                          <Skeleton className="h-3.5 w-16" />
                        </div>
                      ))}
                    </div>
                  </LoadingRegion>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Empty</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <EmptyState
                    icon={Users}
                    title="No students enrolled yet"
                    description="Add your first student, or import a class list from a spreadsheet."
                    action={<Button><Plus aria-hidden="true" />Add student</Button>}
                  />
                </CardContent>
              </Card>

              <div className="space-y-3">
                <Alert variant="info" title="Term 2 starts on 12 May">Fee structures roll over automatically.</Alert>
                <Alert variant="warning" title="WhatsApp quota at 80%">400 of 500 messages used this month.</Alert>
                <Alert variant="danger" title="Payment could not be verified">The reference number does not match any pending payment.</Alert>
              </div>
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          id="loading"
          title="Loading"
          description="Two mechanisms, chosen by how long the wait actually is. The branded splash is for a cold start or a heavy dashboard; skeletons are for everything else, because a full-screen takeover on a 120ms navigation makes a fast app feel slower."
        >
          <div className="grid gap-cards lg:grid-cols-2">
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>Branded splash</CardTitle>
                <CardDescription>Initial load, and entering a heavy dashboard.</CardDescription>
              </CardHeader>
              <div className="border-t border-border">
                <BrandSplash inline message="Preparing your workspace" />
              </div>
              <CardContent className="pt-card">
                <p className="text-sm text-muted-foreground">
                  <strong>No percentage, deliberately.</strong> A counted figure needs a denominator, and
                  a server render over an unknown connection has none — so every number would be
                  invented, and a progress bar that stalls at 87% teaches people the number was never
                  measuring anything. The sweeping indicator makes one claim it cannot be wrong about.
                </p>
                <p className="mt-3 text-sm text-muted-foreground">
                  It also <strong>fades in after 180ms</strong>, in CSS rather than with a timer, so a
                  fast load unmounts it before it was ever visible.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Skeletons</CardTitle>
                <CardDescription>In-app navigation between screens.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <LoadingRegion label="Loading students">
                  <div className="space-y-3">
                    <Skeleton className="h-6 w-2/5" />
                    <Skeleton className="h-24 w-full" />
                    <div className="grid grid-cols-3 gap-2">
                      <Skeleton className="h-16" />
                      <Skeleton className="h-16" />
                      <Skeleton className="h-16" />
                    </div>
                  </div>
                </LoadingRegion>
                <p className="text-sm text-muted-foreground">
                  Shaped like the content that replaces them, so the layout does not jump when data
                  arrives.
                </p>
              </CardContent>
            </Card>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          id="responsive"
          title="Small screens"
          description="Below 480px the type scale, card padding, and gaps tighten — through the token layer, so no component carries a breakpoint modifier. Tap targets are the explicit exception."
        >
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">Token values above and below the 480px breakpoint</caption>
              <thead className="bg-sunken text-left">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Token</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">≥ 480px</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">&lt; 480px</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Page title (4xl)', '36px', '26px', 'A 36px title costs most of the fold before any content'],
                  ['Section heading (3xl)', '30px', '22px', ''],
                  ['Card title (xl)', '20px', '17px', ''],
                  ['Body (base)', '15px', '15px', 'Does not shrink — already at the comfortable floor'],
                  ['Card padding', '20px', '14px', ''],
                  ['Gap between cards', '20px', '12px', ''],
                  ['Page gutter', '24px', '16px', ''],
                  ['Tap target', '44px', '44px', 'WCAG 2.5.5. Never shrinks.'],
                ].map(([token, wide, narrow, note]) => (
                  <tr key={token} className="border-t border-border">
                    <th scope="row" className="px-4 py-2.5 text-left font-normal">{token}</th>
                    <td data-numeric className="px-4 py-2.5 text-right">{wide}</td>
                    <td data-numeric className="px-4 py-2.5 text-right">
                      {wide === narrow ? <Badge variant="success">{narrow}</Badge> : narrow}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Alert variant="info" title="Resize this window below 480px">
            <p>
              Everything on this page reflows through the same tokens — nothing here is a special mobile
              layout. The buttons and inputs stay 44px while the headings and padding tighten around
              them.
            </p>
          </Alert>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          id="tints"
          title="Soft tints"
          description="The unit a dashboard is built from: a pale tinted panel with a figure, a label, and a mark. Colour applied as a chip rather than as a block — a row of saturated cards competes with the data underneath it, so every card shouts equally and none of them signals anything."
        >
          <div className="space-y-3">
            <h3 className="text-base font-semibold">Light</h3>
            <TintRow tone="light" />
          </div>

          <div className="space-y-3">
            <h3 className="text-base font-semibold">Dark</h3>
            <TintRow tone="dark" />
            <p className="max-w-3xl text-sm text-muted-foreground">
              The same six components, the same tokens, no dark-specific markup. Both rows are rendered
              on this page at once because side by side is the only way to tell whether they are one
              design or two.
            </p>
          </div>

          <Alert variant="info" title="The tone is a meaning, not a colour">
            <p>
              Green is paid, amber is due soon, coral is in arrears — the same mapping as the badges and
              the fee cards below. Lavender-grey carries counts that imply no judgement, and blue and
              teal carry figures that are notable without being good or bad. A stat card cannot ask for
              &ldquo;the teal one&rdquo;.
            </p>
          </Alert>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          id="semantic"
          title="Semantic colour in use"
          description="Green is paid, amber is due soon, coral is overdue — and every status is written in words as well as coloured, so the meaning survives a colour vision deficiency or a photocopied page."
        >
          <div className="flex flex-wrap gap-2">
            <Badge variant="success">Paid</Badge>
            <Badge variant="warning">Due soon</Badge>
            <Badge variant="danger">Overdue</Badge>
            <Badge variant="primary">Active</Badge>
            <Badge variant="info">Draft</Badge>
            <Badge variant="neutral">Archived</Badge>
          </div>

          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            <FeeCard
              studentName="Chanda Mwale"
              termLabel="Term 1, 2026 · Grade 7A"
              currency="ZMW"
              termCharge="1,500.00"
              amountPaid="1,500.00"
              balance="0.00"
              status="paid"
            />
            <FeeCard
              studentName="Bwalya Phiri"
              termLabel="Term 1, 2026 · Grade 5B"
              currency="ZMW"
              termCharge="1,500.00"
              amountPaid="800.00"
              balance="700.00"
              status="due_soon"
              dueDate="28 August 2026"
              action={<Button className="w-full"><Receipt aria-hidden="true" />Pay now</Button>}
            />
            <FeeCard
              studentName="Mutale Banda"
              termLabel="Term 1, 2026 · Grade 9C"
              currency="ZMW"
              termCharge="1,500.00"
              broughtForward="2,200.00"
              broughtForwardFrom="Term 3, 2025"
              amountPaid="500.00"
              balance="3,200.00"
              status="overdue"
              daysOverdue={34}
              action={<Button className="w-full"><Receipt aria-hidden="true" />Pay now</Button>}
            />

            <AttendanceCard title="Grade 7A" subtitle="Term 1, 2026" present={52} late={4} absent={2} />
            <AttendanceCard title="Mutale Banda" subtitle="Term 1, 2026" present={38} late={6} absent={16} />
            <AttendanceCard title="Grade 4B" subtitle="Term 1, 2026" present={0} late={0} absent={0} />
          </div>

          <Alert variant="info" title="Arrears report, they do not gate">
            <p>
              The overdue card shows a balance and offers a payment. Per ADR-038 it never withholds
              results or certificates — any such gating is a school-controlled setting, off by default.
            </p>
          </Alert>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section
          id="theming"
          title="Per-school theming"
          description="A school sets two colours and a logo. Everything else — semantic colours, layout, spacing — is fixed, and the derived scales are re-checked against WCAG AA on save."
        >
          <div className="grid gap-5 md:grid-cols-2">
            {[
              { label: 'ZSMS default', theme: zsms, name: 'ZSMS', initials: 'ZS' },
              { label: 'A school theme', theme: school, name: 'Kabulonga Girls Secondary School', initials: school.initials },
            ].map(({ label, theme, name, initials }) => (
              <Card key={label} className="overflow-hidden">
                {/*
                  A school's identity on a light bar, not a colour block: the
                  anchor tint as the ground, the anchor itself as the ink. This
                  is the treatment the school portal header uses.
                */}
                <div
                  className="flex items-center gap-3 border-b px-5 py-4"
                  style={{
                    backgroundColor: theme.light.colors.anchor[100],
                    borderColor: theme.light.colors.anchor[200],
                    color: theme.light.colors.anchor[700],
                  }}
                >
                  <span
                    className="inline-flex size-9 items-center justify-center rounded-md text-sm font-semibold"
                    style={{
                      backgroundColor: theme.light.colors.anchor[600],
                      color: theme.light.surface.textOnFill,
                    }}
                    aria-hidden="true"
                  >
                    {initials}
                  </span>
                  <span className="truncate text-sm font-semibold">{name}</span>
                </div>
                <CardContent className="space-y-3 pt-5">
                  <p className="text-sm text-muted-foreground">{label}</p>
                  <div className="flex flex-wrap gap-2">
                    <span
                      className="inline-flex h-10 items-center rounded-md px-4 text-sm font-medium"
                      style={{
                        backgroundColor: theme.light.colors.primary[600],
                        color: theme.light.surface.textOnFill,
                      }}
                    >
                      Primary action
                    </span>
                    <span
                      className="inline-flex h-10 items-center rounded-md border px-4 text-sm font-medium"
                      style={{ borderColor: theme.light.surface.borderStrong }}
                    >
                      Secondary
                    </span>
                  </div>
                  {/* Semantic colours are identical in both — deliberately not themeable. */}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Badge variant="success">Paid</Badge>
                    <Badge variant="warning">Due soon</Badge>
                    <Badge variant="danger">Overdue</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Semantic colours stay fixed across both themes — green must always mean paid.
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader><CardTitle>Logo fallback</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap items-center gap-6">
              {[
                ['Kabulonga Girls Secondary School', 'KGS'],
                ['The Lusaka Academy of Science', 'LS'],
                ['Chipata', 'CH'],
                ['—', 'ZS'],
              ].map(([name, initials]) => (
                <div key={name} className="flex items-center gap-2">
                  <SchoolLogo initials={initials as string} schoolName={name as string} variant="icon" />
                  <span className="text-sm text-muted-foreground">{name}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </Section>

        <footer className="border-t border-border pt-6 text-sm text-muted-foreground">
          <p>
            Tokens: <code className="font-mono">@zsms/design-tokens</code> · Font:{' '}
            {TYPOGRAPHY.fontFamily.sans.split(',')[0]?.replace(/'/g, '')} · Icons: Lucide
          </p>
          <p className="mt-1">
            <BookOpen className="mr-1 inline size-3.5" aria-hidden="true" />
            This page is the design reference, not a portal screen.
          </p>
        </footer>
      </main>
    </div>
  )
}
