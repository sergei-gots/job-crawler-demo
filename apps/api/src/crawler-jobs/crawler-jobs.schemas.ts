import { z } from "zod";

export const createJobSchema = z.object({
  name: z.string().min(1, "Crawler job name is required"),
  description: z.string().optional(),
  sources: z.array(z.number().int()).min(1, "Select at least one source"),
  keywords: z.string().optional(),
});

export type CreateJobInput = z.infer<typeof createJobSchema>;
