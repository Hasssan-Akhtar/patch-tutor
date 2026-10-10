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
