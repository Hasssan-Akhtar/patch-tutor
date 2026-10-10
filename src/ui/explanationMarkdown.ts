import type { Depth, Explanation } from '../llm/schemas';

// Mid-tone colors that stay readable on both light and dark themes.
const COLORS = {
  what: '#3B82F6',
  how: '#10B981',
  why: '#A855F7',
  risk: '#F59E0B',
  safe: '#22C55E',
} as const;

const PILL_COLORS = ['#7C3AED', '#2563EB', '#0D9488', '#DB2777', '#EA580C'];

const DEPTH_LABEL: Record<Depth, string> = {
  simple: '🪶 Simple',
  standard: '📘 Standard',
  deep: '🔬 Deep dive',
};

/**
 * Markdown (with a little inline HTML for color) for an explanation comment.
 * All model text is escaped first so it cannot inject HTML or load remote images.
 * Kept free of `vscode` so it can be unit-tested.
 */
export function explanationMarkdown(explanation: Explanation, fromCache: boolean): string {
  const safe = (text: string) => escapeModelText(text);
  const parts = [
    `> 💡 **TL;DR:** ${safe(explanation.summary)}`,
    `${label('🔍', 'What changed', COLORS.what)} ${safe(explanation.whatChanged)}`,
    `${label('⚙️', 'How it works', COLORS.how)} ${safe(explanation.howItWorks)}`,
    `${label('🎯', 'Why it works', COLORS.why)} ${safe(explanation.whyItWorks)}`,
  ];

  if (explanation.risks.length > 0) {
    parts.push(
      `${label('⚠️', 'Watch out for', COLORS.risk)}\n\n` +
        explanation.risks.map((r) => `- ${safe(r)}`).join('\n'),
    );
  } else {
    parts.push(label('✅', 'Nothing risky spotted', COLORS.safe));
  }

  if (explanation.concepts.length > 0) {
    parts.push(`🧠 ${explanation.concepts.map((c, i) => pill(c, i)).join(' ')}`);
  }

  const meta = [DEPTH_LABEL[explanation.depth], fromCache ? '⚡ from cache' : undefined]
    .filter(Boolean)
    .join(' · ');
  parts.push(`---\n🎓 **Think you've got it?** Hit **Quiz me** above. · _${meta}_`);
  return parts.join('\n\n');
}

/** Shown when the model's reply never matched the schema; still useful, just unstructured. */
export function rawExplanationMarkdown(text: string): string {
  return `${escapeModelText(text.trim())}\n\n---\n_🤷 The reply wasn't in the usual format, so here it is as written._`;
}

/** A short headline for the thread title. */
export function threadTitle(explanation: Explanation): string {
  const summary = explanation.summary.replace(/`/g, '').trim();
  return `💡 ${summary.length > 90 ? `${summary.slice(0, 87)}…` : summary}`;
}

function label(emoji: string, text: string, color: string): string {
  return `${emoji} <span style="color:${color};"><strong>${text}</strong></span>`;
}

function pill(concept: string, index: number): string {
  const color = PILL_COLORS[index % PILL_COLORS.length];
  return `<span style="color:#FFFFFF;background-color:${color};">&nbsp;${escapeHtml(concept)}&nbsp;</span>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Escapes HTML and Markdown images outside code spans. Code spans stay as
 * written because Markdown shows their contents literally (entities included).
 */
export function escapeModelText(text: string): string {
  return text
    .split(/(`+[^`]*?`+)/g)
    .map((part, i) => (i % 2 === 1 ? part : escapeHtml(part).replace(/!\[/g, '!\\[')))
    .join('');
}
