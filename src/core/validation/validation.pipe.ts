import {
  type ArgumentMetadata,
  HttpException,
  HttpStatus,
  Injectable,
  type PipeTransform,
} from "@nestjs/common";
import type { ZodType } from "zod";
import { ErrorCodes } from "../errors/error.codes";

@Injectable()
export class ValidationPipe implements PipeTransform {
  constructor(private readonly schema?: ZodType) {}

  transform(value: unknown, _metadata: ArgumentMetadata) {
    if (!this.schema) {
      return value;
    }

    const parsed = this.schema.safeParse(value);

    if (!parsed.success) {
      throw new HttpException(
        {
          code: ErrorCodes.VALIDATION_ERROR,
          message: "Validation failed",
          errors: parsed.error.flatten(),
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    return parsed.data;
  }
}
