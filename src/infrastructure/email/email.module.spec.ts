import { SELF_DECLARED_DEPS_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import { appConfig } from "../../core/config/app.config";
import { LoggerService } from "../../core/logger/logger.service";
import { EmailVerificationService } from "../../modules/auth/services/email-verification.service";
import { PasswordResetService } from "../../modules/auth/services/password-reset.service";
import { RegistrationService } from "../../modules/auth/services/registration.service";
import { DevEmailAdapter } from "./dev-email.adapter";
import { createEmailProvider } from "./email.module";
import { EMAIL_PORT } from "./email.port";
import { ResendEmailAdapter } from "./resend-email.adapter";

const logger = {
  error: jest.fn(),
  warn: jest.fn(),
};

async function resolveEmailProvider(provider: "dev" | "resend") {
  const moduleRef = await Test.createTestingModule({
    providers: [{ provide: LoggerService, useValue: logger }, createEmailProvider(provider)],
  }).compile();

  return { moduleRef, email: moduleRef.get(EMAIL_PORT) };
}

describe("Email provider wiring", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it("injects only DevEmailAdapter when EMAIL_PROVIDER=dev", async () => {
    const { moduleRef, email } = await resolveEmailProvider("dev");

    expect(email).toBeInstanceOf(DevEmailAdapter);
    expect(() => moduleRef.get(ResendEmailAdapter)).toThrow();
    await moduleRef.close();
  });

  it("injects only ResendEmailAdapter when EMAIL_PROVIDER=resend", async () => {
    const { moduleRef, email } = await resolveEmailProvider("resend");

    expect(email).toBeInstanceOf(ResendEmailAdapter);
    expect(() => moduleRef.get(DevEmailAdapter)).toThrow();
    await moduleRef.close();
  });

  it("keeps every auth email consumer bound to the common EMAIL_PORT token", () => {
    for (const consumer of [RegistrationService, EmailVerificationService, PasswordResetService]) {
      const dependencies =
        (Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, consumer) as
          | Array<{ index: number; param: unknown }>
          | undefined) ?? [];

      expect(dependencies.map(({ param }) => param)).toContain(EMAIL_PORT);
    }
  });

  it("does not log the Resend API key when the provider request fails", async () => {
    const secret = "test-resend-secret-must-not-appear";
    jest.replaceProperty(appConfig.email, "resendApiKey", secret);
    jest.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 503 }));
    const adapter = new ResendEmailAdapter(logger as unknown as LoggerService);

    await expect(
      adapter.sendEmailVerification({
        to: "learner@example.test",
        name: "Learner",
        verificationUrl: "https://example.test/verify",
      }),
    ).rejects.toThrow("Resend request failed with status 503");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(secret);
  });
});

describe("Resend environment validation", () => {
  const original = {
    NODE_ENV: process.env.NODE_ENV,
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("fails configuration without exposing values when Resend is selected without a key", async () => {
    process.env.NODE_ENV = "production";
    process.env.EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "";

    await expect(
      jest.isolateModulesAsync(async () => {
        await import("../../core/config/env.config");
      }),
    ).rejects.toThrow(
      "Invalid environment configuration: RESEND_API_KEY is required when EMAIL_PROVIDER=resend",
    );
  });
});
