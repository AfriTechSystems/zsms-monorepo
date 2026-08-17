/**
 * Tailwind configuration.
 *
 * Every colour here resolves to a CSS custom property, never to a hex. That is
 * the mechanism behind per-school theming: the same compiled stylesheet serves
 * every school, and the variables are swapped server-side per request. A hex
 * typed into this file would be a colour no school could override.
 *
 * Token definitions live in `@zsms/design-tokens`. This file only *names* them
 * for Tailwind.
 */

import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
          fill: 'var(--zsms-primary-fill)',
          tint: 'var(--zsms-primary-tint)',
          text: 'var(--zsms-primary-text)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
          tint: 'var(--zsms-accent-tint)',
          text: 'var(--zsms-accent-text)',
        },
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },

        // ZSMS semantic roles. Named for meaning, not hue — a component asks
        // for `success`, never for "the green one", so a status colour cannot
        // drift into decoration.
        anchor: {
          DEFAULT: 'var(--zsms-anchor)',
          strong: 'var(--zsms-anchor-strong)',
          foreground: 'var(--zsms-anchor-foreground)',
        },
        success: {
          DEFAULT: 'var(--zsms-success)',
          tint: 'var(--zsms-success-tint)',
          text: 'var(--zsms-success-text)',
        },
        warning: {
          DEFAULT: 'var(--zsms-warning)',
          tint: 'var(--zsms-warning-tint)',
          text: 'var(--zsms-warning-text)',
        },
        danger: {
          DEFAULT: 'var(--zsms-danger)',
          tint: 'var(--zsms-danger-tint)',
          text: 'var(--zsms-danger-text)',
        },
        sunken: 'var(--zsms-surface-sunken)',
        subtle: 'var(--zsms-text-subtle)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'var(--zsms-radius-md)',
        sm: 'var(--zsms-radius-sm)',
        xl: 'var(--zsms-radius-xl)',
      },
      boxShadow: {
        sm: 'var(--zsms-shadow-sm)',
        md: 'var(--zsms-shadow-md)',
        lg: 'var(--zsms-shadow-lg)',
      },
      fontFamily: {
        sans: ['var(--zsms-font-sans)'],
      },
      fontSize: {
        // Paired with line-heights from the token scale. Body is 15px rather
        // than Tailwind's 16px default: at 16px a fees table fits noticeably
        // fewer rows per screen, and this is a product people scan all day.
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.9375rem', { lineHeight: '1.5rem' }],
        lg: ['1.0625rem', { lineHeight: '1.625rem' }],
        xl: ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.375rem' }],
        '4xl': ['2.25rem', { lineHeight: '2.75rem' }],
      },
      keyframes: {
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [animate],
}

export default config
