import { Injectable } from "@nestjs/common";
import type { User } from "../../../infrastructure/database/schema";
import { EmployersRepository } from "../repositories/employers.repository";

@Injectable()
export class SessionViewBuilder {
  constructor(private readonly employersRepository: EmployersRepository) {}

  async build(user: User) {
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
