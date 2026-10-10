// Shared styling for Patch Tutor comments: colored labels, pills and escaping.
// Kept free of `vscode` so it can be unit-tested.

/** Mid-tone colors that stay readable on both light and dark themes. */
export const COLORS = {
  blue: '#3B82F6',
  green: '#10B981',
  purple: '#A855F7',
  amber: '#F59E0B',
  brightGreen: '#22C55E',
  violet: '#8B5CF6',
} as const;

const PILL_COLORS = ['#7C3AED', '#2563EB', '#0D9488', '#DB2777', '#EA580C'];

/** An emoji followed by a bold colored label. */
export function label(emoji: string, text: string, color: string): string {
  return `${emoji} <span style="color:${color};"><strong>${text}</strong></span>`;
}

/** A colored tag, e.g. for a concept name. */
export function pill(text: string, index: number): string {
  const color = PILL_COLORS[index % PILL_COLORS.length];
  return `<span style="color:#FFFFFF;background-color:${color};">&nbsp;${escapeHtml(text)}&nbsp;</span>`;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Escapes HTML and Markdown images outside code spans, so model text cannot
 * inject markup or load remote images. Code spans stay as written because
 * Markdown shows their contents literally (entities included).
 */
export function escapeModelText(text: string): string {
  return text
    .split(/(`+[^`]*?`+)/g)
    .map((part, i) => (i % 2 === 1 ? part : escapeHtml(part).replace(/!\[/g, '!\\[')))
    .join('');
}
