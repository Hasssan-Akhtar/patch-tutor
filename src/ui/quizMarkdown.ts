import type { QuizSummary } from '../learning/quizSession';
import type { Grade, Question, QuestionType } from '../llm/schemas';
import { COLORS, escapeModelText, label, pill } from './markdownStyle';

const TYPE_LABEL: Record<QuestionType, string> = {
  predict: '🔮 Predict',
  explain: '💬 Explain',
  'spot-the-bug': '🐞 Spot the bug',
};

export function questionMarkdown(question: Question, index: number, total: number): string {
  const intro =
    index === 0
      ? `Let's see how well this change sticks: ${total} quick question${total === 1 ? '' : 's'}.\n\n`
      : '';
  return (
    intro +
    `${label('🎓', `Question ${index + 1} of ${total}`, COLORS.violet)} · ${TYPE_LABEL[question.type]}\n\n` +
    `${escapeModelText(question.question)}\n\n` +
    `_Reply below. Short answers are fine._`
  );
}

export function gradeMarkdown(grade: Grade, question: Question): string {
  const headline = {
    correct: label('🎉', 'Nailed it!', COLORS.brightGreen),
    partly: label('👍', 'Almost there', COLORS.amber),
    wrong: label('🌱', 'Not quite yet', COLORS.blue),
  }[grade.verdict];
  const parts = [`${headline} ${escapeModelText(grade.feedback)}`];
  if (grade.verdict !== 'correct') {
    if (grade.missed.length > 0) {
      parts.push(`🧩 **Missing piece:** ${grade.missed.map(escapeModelText).join('; ')}`);
    }
    parts.push(`📝 **A good answer:** ${escapeModelText(question.expected)}`);
  }
  parts.push(`💡 **Remember:** ${escapeModelText(grade.remember)}`);
  return parts.join('\n\n');
}

/** Shown when the grade reply never matched the schema. */
export function ungradedMarkdown(raw: string, question: Question): string {
  return (
    `🤷 I couldn't grade that cleanly, but here's what I think:\n\n${escapeModelText(raw.trim())}\n\n` +
    `📝 **A good answer:** ${escapeModelText(question.expected)}`
  );
}

export function revealMarkdown(question: Question): string {
  return `🙈 **Here's the answer:** ${escapeModelText(question.expected)}\n\n_No worries. Seeing it is learning too._`;
}

export function skipMarkdown(question: Question): string {
  return `⏭️ Skipped. **A good answer:** ${escapeModelText(question.expected)}`;
}

export function summaryMarkdown(summary: QuizSummary): string {
  const { correct, partly, revealed, skipped, total, toReview } = summary;
  const attempted = total - revealed - skipped;
  let headline: string;
  if (attempted === 0) {
    headline = `${label('🙈', 'No answers this round', COLORS.blue)} Peeking is fine. Try another round once it has sunk in.`;
  } else {
    const score = `${correct}/${attempted} correct${partly > 0 ? `, ${partly} partly` : ''}`;
    if (correct === attempted) {
      headline = label('🏆', `Perfect! ${score}`, COLORS.brightGreen);
    } else if (correct + partly / 2 >= attempted / 2) {
      headline = label('✨', `Nice work: ${score}`, COLORS.green);
    } else {
      headline = `${label('🌱', score, COLORS.blue)} Every miss is something you know now.`;
    }
    const passed = [
      revealed > 0 ? `peeked at ${revealed}` : undefined,
      skipped > 0 ? `skipped ${skipped}` : undefined,
    ].filter(Boolean);
    if (passed.length > 0) {
      headline += ` _(${passed.join(', ')})_`;
    }
  }
  const parts = [`🏁 **Quiz done!** ${headline}`];
  if (toReview.length > 0) {
    parts.push(`📚 **Worth another look:** ${toReview.map((c, i) => pill(c, i)).join(' ')}`);
  }
  parts.push(
    '🔁 Want another round? Hit **Quiz me** again for fresh questions. 📊 Your scores and history are in the **Patch Tutor** sidebar.',
  );
  return parts.join('\n\n');
}

export function quizErrorMarkdown(detail: string): string {
  return `😕 **Couldn't write a quiz this time.** ${escapeModelText(detail)}\n\nTry **Quiz me** again.`;
}
