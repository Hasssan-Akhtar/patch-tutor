import type { Depth, Explanation } from '../llm/schemas';
import { COLORS, escapeModelText, label, pill } from './markdownStyle';

const DEPTH_LABEL: Record<Depth, string> = {
  simple: '🪶 Simple',
  standard: '📘 Standard',
  deep: '🔬 Deep dive',
};

/** Markdown (with a little inline HTML for color) for an explanation comment. */
export function explanationMarkdown(
  explanation: Explanation,
  fromCache: boolean,
  revised = false,
): string {
  const safe = escapeModelText;
  const parts = [
    `> 💡 **TL;DR:** ${safe(explanation.summary)}`,
    `${label('🔍', 'What changed', COLORS.blue)} ${safe(explanation.whatChanged)}`,
    `${label('⚙️', 'How it works', COLORS.green)} ${safe(explanation.howItWorks)}`,
    `${label('🎯', 'Why it works', COLORS.purple)} ${safe(explanation.whyItWorks)}`,
  ];

  if (explanation.risks.length > 0) {
    parts.push(
      `${label('⚠️', 'Watch out for', COLORS.amber)}\n\n` +
        explanation.risks.map((r) => `- ${safe(r)}`).join('\n'),
    );
  } else {
    parts.push(label('✅', 'Nothing risky spotted', COLORS.brightGreen));
  }

  if (explanation.concepts.length > 0) {
    parts.push(`🧠 ${explanation.concepts.map((c, i) => pill(c, i)).join(' ')}`);
  }

  const meta = [
    DEPTH_LABEL[explanation.depth],
    revised ? '✏️ Revised after your reply' : undefined,
    fromCache ? '⚡ from cache' : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  parts.push(
    `---\n🎓 **Think you've got it?** Hit **Quiz me** above, or reply below with a question. · _${meta}_`,
  );
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
