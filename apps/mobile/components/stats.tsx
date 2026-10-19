/**
 * Mobile stat and chart primitives — the phone counterparts of
 * `components/ui/stat-card.tsx` and `components/ui/chart.tsx` on the web.
 *
 * Built so the two products agree about what a figure looks like: a tinted icon, a
 * label above the number, the number sized to fit, and a line of context under it.
 * A parent who uses the web portal at the school office and the app at home should
 * not have to learn two layouts.
 *
 * ## What is deliberately different from the web
 *
 * **Everything is one column by default.** A phone is 360dp wide, and two stat cards
 * side by side leave about 160dp each — which is not enough for "K 1,250,000" without
 * shrinking the figure to the point where it stops being the thing you see first. Two
 * across is offered via `Row`, and the caller uses it only for short values.
 *
 * **No sparklines inside a tile.** At this width a 7-point line is four pixels tall
 * and reads as a smudge. The ring and the bar are used instead: both answer "how far
 * through" at a glance, which is the question the small charts were answering anyway.
 */

import type { JSX, ReactNode } from 'react'
import { Text, View, type ViewStyle } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import type { LucideIcon } from 'lucide-react-native'

import { Caption, Card, usePalette } from './ui'
import { NUMERIC, RADIUS, SPACE, TYPE } from '../theme'
import type { Palette } from '../theme'

export type StatTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger'

/** Tint and mark for each tone, read from the palette rather than hard-coded. */
function toneOf(c: Palette, tone: StatTone): { tint: string; mark: string } {
  switch (tone) {
    case 'primary':
      return { tint: c.primaryTint, mark: c.primaryMark }
    case 'success':
      return { tint: c.successTint, mark: c.success }
    case 'warning':
      return { tint: c.warningTint, mark: c.warning }
    case 'danger':
      return { tint: c.dangerTint, mark: c.danger }
    default:
      return { tint: c.surfaceSunken, mark: c.textMuted }
  }
}

/**
 * The figure, sized to what it has to hold.
 *
 * Zambian schools deal in millions, and ZSMS totals across schools reach further than
 * that — so "K 1,250,000.00" has to fit a phone card without wrapping into two lines,
 * which is what it did. The web solves this the same way and for the same reason.
 */
function figureSize(value: string): number {
  if (value.length <= 7) return TYPE.display.fontSize
  if (value.length <= 11) return TYPE.title.fontSize
  return TYPE.heading.fontSize
}

export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'neutral',
  progress,
  style,
}: {
  label: string
  value: string
  hint?: string
  icon?: LucideIcon
  tone?: StatTone
  /** 0–100. A bar under the figure, for a stat that is a proportion. */
  progress?: number
  style?: ViewStyle
}): JSX.Element {
  const c = usePalette()
  const t = toneOf(c, tone)

  return (
    <Card style={style}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Caption>{label}</Caption>
          <Text
            style={[
              NUMERIC,
              {
                fontSize: figureSize(value),
                fontWeight: '700',
                letterSpacing: -0.4,
                color: c.text,
              },
            ]}
            // One line, always. Wrapping a figure makes the card taller than its
            // neighbour and the row stops looking like a row.
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {value}
          </Text>
        </View>

        {Icon && (
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: RADIUS.md,
              backgroundColor: t.tint,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon size={18} color={t.mark} strokeWidth={2} />
          </View>
        )}
      </View>

      {typeof progress === 'number' && (
        <ProgressBar value={progress} tone={tone} style={{ marginTop: SPACE.sm }} />
      )}

      {hint ? <Caption>{hint}</Caption> : null}
    </Card>
  )
}

export function ProgressBar({
  value,
  tone = 'primary',
  style,
}: {
  /** 0–100. Clamped, because a rounding error should not paint outside the track. */
  value: number
  tone?: StatTone
  style?: ViewStyle
}): JSX.Element {
  const c = usePalette()
  const t = toneOf(c, tone)
  const pct = Math.min(Math.max(value, 0), 100)

  return (
    <View
      // The bar repeats something already written as a number beside it, so it is
      // decoration to a screen reader rather than a second thing to announce.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { height: 6, borderRadius: 3, backgroundColor: c.surfaceSunken, overflow: 'hidden' },
        style,
      ]}
    >
      <View style={{ width: `${pct}%`, height: '100%', backgroundColor: t.mark }} />
    </View>
  )
}

/**
 * A progress ring, for a single proportion that deserves to be looked at — an
 * attendance rate, a term's fee collection.
 *
 * A ring rather than a bar when the number is the point rather than the remainder:
 * the figure sits inside it, so the shape and the value are read in one glance
 * instead of two.
 */
export function Ring({
  value,
  label,
  size = 72,
  tone = 'primary',
}: {
  /** 0–100, or null when there is nothing to divide by. */
  value: number | null
  label?: string
  size?: number
  tone?: StatTone
}): JSX.Element {
  const c = usePalette()
  const t = toneOf(c, tone)

  const stroke = 7
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  /*
    `null` draws an empty track and an em dash, never a 0% ring.

    A newly enrolled pupil with nothing marked yet would otherwise show a red ring at
    zero — which reads as perfect absence, and is a false accusation about a child.
  */
  const pct = value === null ? 0 : Math.min(Math.max(value, 0), 100)

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={c.surfaceSunken}
          strokeWidth={stroke}
          fill="none"
        />
        {value !== null && (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={t.mark}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${circumference}`}
            strokeDashoffset={circumference * (1 - pct / 100)}
            // Start at twelve o'clock. The default starts at three, which reads as
            // a ring that is already part-way round before anything is counted.
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </Svg>

      <Text style={[NUMERIC, { fontSize: 18, fontWeight: '700', color: c.text }]}>
        {value === null ? '—' : `${Math.round(pct)}%`}
      </Text>
      {label ? <Caption>{label}</Caption> : null}
    </View>
  )
}

/**
 * A part-to-whole donut with a legend carrying values and percentages.
 *
 * Spec: `Official Documentation/19 Design System/ZSMS Teacher App Dashboard Flow.png`
 *       — the attendance Summary panel
 *
 * The mobile counterpart of the web's `DonutChart`, with the same contract (labelled
 * slices, value and percentage in the legend) so one register reads the same on a
 * phone and on a laptop.
 *
 * ## Why this is not `Ring` with more colours
 *
 * `Ring` answers "what is this one number out of a hundred". This answers "what is
 * this whole made of", which is a different question and needs every slice present
 * even at 0%. The two live side by side rather than one growing into the other.
 *
 * ## Zero-value slices are kept in the legend and dropped from the ring
 *
 * A zero slice drawn as an arc is a hairline somebody squints at; dropped from the
 * legend it becomes a category the reader cannot tell is zero rather than missing.
 * "Unmarked 0" is a fact a teacher is specifically looking for, so it stays listed.
 */
export function Donut({
  slices,
  centreValue,
  centreLabel,
  size = 132,
}: {
  slices: ReadonlyArray<{ label: string; value: number; colour: string }>
  /** Drawn in the hole. The mockup puts the class size there, not a percentage. */
  centreValue: string
  centreLabel?: string
  size?: number
}): JSX.Element {
  const c = usePalette()

  const total = slices.reduce((sum, s) => sum + s.value, 0)
  const stroke = 14
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r

  /*
    Arcs are laid end to end by advancing the dash offset, which is how an SVG circle
    becomes a stacked ring without a path per slice. `rotate(-90)` starts at twelve
    o'clock — the default three o'clock reads as a ring already part-way round.
  */
  let consumed = 0

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.lg }}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size} style={{ position: 'absolute' }}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={c.surfaceSunken}
            strokeWidth={stroke}
            fill="none"
          />
          {total > 0 &&
            slices
              .filter((slice) => slice.value > 0)
              .map((slice) => {
                const fraction = slice.value / total
                const dash = circumference * fraction
                const offset = -circumference * consumed
                consumed += fraction
                return (
                  <Circle
                    key={slice.label}
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    stroke={slice.colour}
                    strokeWidth={stroke}
                    fill="none"
                    // No round cap: a rounded end overlaps the next slice and invents
                    // a colour at every boundary.
                    strokeDasharray={`${dash} ${circumference - dash}`}
                    strokeDashoffset={offset}
                    transform={`rotate(-90 ${size / 2} ${size / 2})`}
                  />
                )
              })}
        </Svg>

        <Text style={[NUMERIC, { fontSize: 26, fontWeight: '700', color: c.text }]}>
          {centreValue}
        </Text>
        {centreLabel ? <Caption>{centreLabel}</Caption> : null}
      </View>

      {/* The legend is not optional. The slices are colour alone without it, and two
          of the four statuses are a red and an amber that a deuteranope reads as one
          colour. Value and percentage both, because "3" and "11%" answer different
          questions about the same class. */}
      <View style={{ flex: 1, gap: SPACE.sm }}>
        {slices.map((slice) => (
          <View key={slice.label} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: RADIUS.full,
                backgroundColor: slice.value > 0 ? slice.colour : c.border,
              }}
            />
            <Text style={[TYPE.body, { color: c.text, flex: 1 }]}>{slice.label}</Text>
            <Text style={[NUMERIC, { fontSize: 13, color: c.textMuted }]}>
              {slice.value}
              {total > 0 ? ` (${Math.round((slice.value / total) * 100)}%)` : ''}
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}

/**
 * A heading above a group of cards.
 *
 * The home screens were a flat stack with no grouping, so "how your child is doing"
 * and "everything else" ran together. A phone has no room for a sidebar to carry that
 * structure, so the headings do it.
 */
export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode
  action?: ReactNode
}): JSX.Element {
  const c = usePalette()
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: SPACE.sm,
        marginTop: SPACE.xs,
      }}
    >
      <Text style={[TYPE.heading, { color: c.text }]}>{children}</Text>
      {action}
    </View>
  )
}
