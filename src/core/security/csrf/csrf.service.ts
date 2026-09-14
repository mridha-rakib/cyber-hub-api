import { randomBytes, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";

@Injectable()
export class CsrfService {
  generateToken(): string {
    return randomBytes(32).toString("base64url");
  }

  matches(cookieValue: string | undefined, headerValue: string | undefined): boolean {
    if (!cookieValue || !headerValue) return false;
    const cookieBuffer = Buffer.from(cookieValue);
    const headerBuffer = Buffer.from(headerValue);
    if (cookieBuffer.length !== headerBuffer.length) return false;
    return timingSafeEqual(cookieBuffer, headerBuffer);
  }
}
