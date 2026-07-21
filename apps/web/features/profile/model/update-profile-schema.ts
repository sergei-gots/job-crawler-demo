import { z } from "zod";

export const updateProfileSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Enter a valid email"),
  currentPassword: z.string().min(1, "Current password is required"),
});

export type UpdateProfileFormValues = z.infer<typeof updateProfileSchema>;
