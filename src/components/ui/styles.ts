// src/components/ui/styles.ts
//
// Shared class recipes for the "Order Ticket" direction. Every color here is a
// design token from src/index.css, so re-skinning the app means editing the
// @theme block — not these strings.
//
// Two direction rules are enforced here rather than left to each component:
//   * Green is IDENTITY, not result. btn.primary is the only green fill in the
//     app besides the wordmark. Anything affirmative about a RESULT uses stamp.
//   * Nothing is rounded. --radius-* are all 0; a ticket has crisp corners and
//     the torn top edge (.paper-tear) carries the character instead.
//
// Focus rings are NOT declared here: a global :focus-visible rule in index.css
// covers every focusable element, so we can't miss one.

/** Merge conditional class strings. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const btnBase =
  'inline-flex items-center justify-center gap-2 rounded-field ticket-control ' +
  'transition-[background-color,transform,opacity] duration-150 ' +
  // Press feedback on the button itself, not a global button:hover lift.
  'active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100';

export const btn = {
  /** Calvada green. The confirm action, and nowhere else. */
  primary: cn(btnBase, 'bg-brand-600 text-on-brand hover:bg-brand-hover active:bg-brand-active'),
  secondary: cn(
    btnBase,
    'border border-ink bg-surface text-ink hover:bg-surface-muted active:bg-border'
  ),
  /** Destructive. The hover token moves AWAY from the resting fill in both
      color schemes — a naive hover:bg-red-700 gets lighter under dark mode. */
  danger: cn(btnBase, 'bg-danger-600 text-ink-inverse hover:bg-danger-hover active:bg-danger-active'),
  /** Inline text action inside a list row. */
  quiet:
    'inline-flex items-center gap-1.5 rounded-field px-2 py-1 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink',
  quietDanger:
    'inline-flex items-center gap-1.5 rounded-field px-2 py-1 text-sm font-medium text-danger-600 transition-colors hover:bg-danger-50 hover:text-danger-700',
} as const;

export const btnSize = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2.5 text-xs',
  lg: 'w-full px-5 py-3.5 text-sm',
} as const;

export const field =
  'w-full rounded-field border border-border-strong bg-surface px-3.5 py-2.5 text-sm text-ink ' +
  'placeholder:text-ink-subtle transition-colors hover:border-ink-subtle';

/** A sheet of ticket stock on the kraft ground. Pair with `paper-tear` and
    `relative` where the sheet should look torn off the pad. */
export const panel = 'rounded-panel border border-border bg-surface shadow-card';

export const label = 'block text-sm font-semibold text-ink';

export const hint = 'text-sm text-ink-subtle';

/** Section heading inside an admin panel. */
export const sectionTitle = 'ticket-title text-lg text-ink';

/** The rule under a ticket header — heavier than a border, like a printed line. */
export const ticketRule = 'border-b border-ink';
