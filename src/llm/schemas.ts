import { z } from 'zod';

export const DepthSchema = z.enum(['simple', 'standard', 'deep']);
export type Depth = z.infer<typeof DepthSchema>;

export const ExplanationSchema = z.object({
  summary: z.string().min(1),
  whatChanged: z.string().min(1),
  howItWorks: z.string().min(1),
  whyItWorks: z.string().min(1),
  concepts: z.array(z.string().min(1)),
  risks: z.array(z.string()),
  depth: DepthSchema,
});
export type Explanation = z.infer<typeof ExplanationSchema>;

const QUESTION_TYPES = ['predict', 'explain', 'spot-the-bug'] as const;

export const QuestionTypeSchema = z.preprocess(
  // Small models write "Spot the bug" or "spot_the_bug"; accept those spellings.
  (value) =>
    typeof value === 'string'
      ? value
          .trim()
          .toLowerCase()
          .replace(/[\s_]+/g, '-')
      : value,
  z.enum(QUESTION_TYPES),
);
export type QuestionType = z.infer<typeof QuestionTypeSchema>;

export const QuestionSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String).optional(),
  type: QuestionTypeSchema,
  question: z.string().min(1),
  concept: z.string().min(1),
  expected: z.string().min(1),
});
export type Question = z.infer<typeof QuestionSchema>;

export const QuizSchema = z.object({
  // Three are asked for; tolerate a model that returns a few more or fewer.
  questions: z.array(QuestionSchema).min(1).max(5),
});
export type Quiz = z.infer<typeof QuizSchema>;

export const VerdictSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
  z.enum(['correct', 'partly', 'wrong']),
);
export type Verdict = z.infer<typeof VerdictSchema>;

export const GradeSchema = z.object({
  verdict: VerdictSchema,
  feedback: z.string().min(1),
  missed: z.array(z.string()),
  /** The one idea worth remembering. */
  remember: z.string().min(1),
});
export type Grade = z.infer<typeof GradeSchema>;

export const FollowUpSchema = z.object({
  answer: z.string().min(1),
  // Some models send null instead of leaving the field out.
  revised: ExplanationSchema.nullish().transform((value) => value ?? undefined),
});
export type FollowUp = z.infer<typeof FollowUpSchema>;
