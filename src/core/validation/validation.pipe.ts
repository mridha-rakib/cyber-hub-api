import { ErrorCodes } from "@core/errors/error.codes";
import {
  type ArgumentMetadata,
  Injectable,
  BadRequestException as NestBadRequestException,
  type PipeTransform,
} from "@nestjs/common";
import type { ZodType } from "zod";

@Injectable()
export class ValidationPipe implements PipeTransform {
  constructor(private readonly schema?: ZodType) {}

  transform(value: unknown, _metadata: ArgumentMetadata) {
    if (!this.schema) {
      return value;
    }

    const parsed = this.schema.safeParse(value);

    if (!parsed.success) {
      throw new NestBadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: "Validation failed",
        errors: parsed.error.flatten(),
      });
    }

    return parsed.data;
  }
}
