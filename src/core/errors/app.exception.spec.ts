import { HttpStatus } from "@nestjs/common";
import { ConflictException, DatabaseException } from "./app.exception";
import { ErrorCodes } from "./error.codes";

describe("AppException", () => {
  it("creates conflict exceptions with application error metadata", () => {
    const exception = new ConflictException("Duplicate request", { field: "email" });

    expect(exception.code).toBe(ErrorCodes.CONFLICT);
    expect(exception.statusCode).toBe(HttpStatus.CONFLICT);
    expect(exception.metadata).toEqual({ field: "email" });
  });

  it("creates database exceptions without leaking implementation details", () => {
    const exception = new DatabaseException();

    expect(exception.code).toBe(ErrorCodes.DATABASE_ERROR);
    expect(exception.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });
});
