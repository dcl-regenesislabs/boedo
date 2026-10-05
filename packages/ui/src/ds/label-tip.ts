// An icon-only control's name: read by screen readers, and shown as its tooltip.
export function labelTip(text: string | undefined): { 'aria-label': string | undefined; 'data-tip': string | undefined } {
  return { 'aria-label': text, 'data-tip': text }
}
