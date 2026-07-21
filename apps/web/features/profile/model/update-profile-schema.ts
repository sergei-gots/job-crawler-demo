import { z } from "zod";

export const updateProfileSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().optional(),
});

export type UpdateProfileFormValues = z.infer<typeof updateProfileSchema>;
