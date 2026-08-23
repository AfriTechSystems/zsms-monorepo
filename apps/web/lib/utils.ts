import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merges class names, with later Tailwind utilities beating earlier ones.
 *
 * `clsx` alone would leave `px-2 px-4` both in the string and let CSS order
 * decide; `twMerge` resolves it to `px-4`. That is what makes a `className`
 * prop on a component reliably override its own defaults.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
