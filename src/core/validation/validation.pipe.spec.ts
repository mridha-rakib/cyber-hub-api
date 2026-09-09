import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { ErrorCodes } from "../errors/error.codes";
import { ValidationPipe } from "./validation.pipe";

describe("ValidationPipe", () => {
  it("returns parsed Zod data", () => {
    const schema = z.object({ page: z.coerce.number().int().positive() });
    const pipe = new ValidationPipe(schema);

    expect(pipe.transform({ page: "2" }, { type: "query" })).toEqual({
      page: 2,
    });
  });

  it("throws standardized validation errors", () => {
    const schema = z.object({ email: z.string().email() });
    const pipe = new ValidationPipe(schema);

    expect(() => pipe.transform({ email: "invalid" }, { type: "body" })).toThrow(
      BadRequestException,
    );

    try {
      pipe.transform({ email: "invalid" }, { type: "body" });
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: ErrorCodes.VALIDATION_ERROR,
        message: "Validation failed",
      });
    }
  });
});
