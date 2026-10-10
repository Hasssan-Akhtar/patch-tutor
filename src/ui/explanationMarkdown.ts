import type { Depth, Explanation } from '../llm/schemas';

const DEPTH_LABEL: Record<Depth, string> = {
  simple: 'Simpler',
  standard: 'Standard',
  deep: 'Deeper',
};

/** Markdown for an explanation comment. Kept free of `vscode` so it can be unit-tested. */
export function explanationMarkdown(explanation: Explanation, fromCache: boolean): string {
  const parts = [
    `**${explanation.summary}**`,
    `#### What changed\n${explanation.whatChanged}`,
    `#### How it works\n${explanation.howItWorks}`,
    `#### Why it works\n${explanation.whyItWorks}`,
  ];
  if (explanation.risks.length > 0) {
    parts.push(`#### Watch out for\n${explanation.risks.map((r) => `- ${r}`).join('\n')}`);
  }
  const footer = [
    explanation.concepts.length > 0
      ? `Concepts: ${explanation.concepts.map((c) => `\`${c}\``).join(' ')}`
      : undefined,
    `${DEPTH_LABEL[explanation.depth]} explanation${fromCache ? ' · cached' : ''}`,
  ].filter(Boolean);
  parts.push(`---\n${footer.join(' · ')}`);
  return parts.join('\n\n');
}

/** Shown when the model's reply never matched the schema; still useful, just unstructured. */
export function rawExplanationMarkdown(text: string): string {
  return `${text.trim()}\n\n---\n_The model's reply was not in the expected format, so it is shown as is._`;
}
