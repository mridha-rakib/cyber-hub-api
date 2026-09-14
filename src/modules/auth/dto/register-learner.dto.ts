import { z } from "zod";

// profile leaf fields are not yet enumerated anywhere in the approved docs
// (ERD: "exact leaf fields come from UI/API contract"), so only an empty
// object is accepted until a future contract revision defines them.
const profileSchema = z.object({}).strict().optional();

export const registerLearnerSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required"),
    email: z.string().trim().email(),
    password: z.string().min(8).max(256),
    profile: profileSchema,
  })
  .strict();

export type RegisterLearnerInput = z.infer<typeof registerLearnerSchema>;
