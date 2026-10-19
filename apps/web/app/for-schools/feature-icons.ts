/**
 * Icon-name to component resolution for the feature data.
 *
 * Spec: `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md`
 *
 * `features.ts` stores icons as strings so it stays plain data — it is read by two pages now
 * (`/for-schools` and `/features`), and a data file that imported components would have to be a
 * client module or drag its imports into every consumer.
 *
 * This map lived inside `/for-schools/page.tsx` until `/features` needed the same twenty names. A
 * second copy would have gone stale the first time a feature took a new icon: the missing name falls
 * back to `Sparkles` rather than failing, so the drift would have shown up as one page quietly
 * rendering the wrong picture.
 */

import type { LucideIcon } from 'lucide-react'
import {
  Bot,
  Building2,
  CalendarCheck,
  CalendarRange,
  ClipboardList,
  Compass,
  CreditCard,
  FileSpreadsheet,
  FileText,
  Globe,
  GraduationCap,
  HandCoins,
  Landmark,
  Megaphone,
  MessageCircle,
  Plug,
  Smartphone,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react'

export const FEATURE_ICONS: Record<string, LucideIcon> = {
  Bot,
  Building2,
  CalendarCheck,
  CalendarRange,
  ClipboardList,
  Compass,
  CreditCard,
  FileSpreadsheet,
  FileText,
  Globe,
  GraduationCap,
  HandCoins,
  Landmark,
  Megaphone,
  MessageCircle,
  Plug,
  Smartphone,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
}

/** The fallback, for an icon name that has no entry. */
export const FALLBACK_ICON: LucideIcon = Sparkles

export function featureIcon(name: string): LucideIcon {
  return FEATURE_ICONS[name] ?? FALLBACK_ICON
}
