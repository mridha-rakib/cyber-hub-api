import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";

export interface OpaqueSecret {
  raw: string;
  hash: string;
}

@Injectable()
export class OpaqueSecretService {
  generate(byteLength = 32): OpaqueSecret {
    const raw = randomBytes(byteLength).toString("base64url");
    return { raw, hash: this.hash(raw) };
  }

  hash(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }
}
