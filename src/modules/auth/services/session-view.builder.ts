import { Injectable } from "@nestjs/common";
import { EmployersRepository } from "../repositories/employers.repository";
import type { SafeUser } from "./session-authentication.types";

@Injectable()
export class SessionViewBuilder {
  constructor(private readonly employersRepository: EmployersRepository) {}

  async build(user: SafeUser) {
    const employer = user.employerId
      ? await this.employersRepository.findById(user.employerId)
      : null;

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        verified: user.verified,
      },
      ...(employer
        ? {
            employer: {
              id: employer.id,
              companyName: employer.companyName,
              status: employer.status,
            },
          }
        : {}),
    };
  }
}
