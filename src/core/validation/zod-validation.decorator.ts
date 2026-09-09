import { SetMetadata } from "@nestjs/common";
import type { ZodType } from "zod";

export const ZOD_SCHEMA_METADATA = "zod:schema";

export interface ZodValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

export const ValidateWith = (schemas: ZodValidationSchemas) =>
  SetMetadata(ZOD_SCHEMA_METADATA, schemas);
