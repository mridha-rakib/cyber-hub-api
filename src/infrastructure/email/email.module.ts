import { Global, Module, type Provider } from "@nestjs/common";
import { appConfig } from "../../core/config/app.config";
import { DevEmailAdapter } from "./dev-email.adapter";
import { EMAIL_PORT } from "./email.port";
import { ResendEmailAdapter } from "./resend-email.adapter";

export function createEmailProvider(provider: typeof appConfig.email.provider): Provider {
  return {
    provide: EMAIL_PORT,
    useClass: provider === "resend" ? ResendEmailAdapter : DevEmailAdapter,
  };
}

@Global()
@Module({
  providers: [createEmailProvider(appConfig.email.provider)],
  exports: [EMAIL_PORT],
})
export class EmailModule {}
