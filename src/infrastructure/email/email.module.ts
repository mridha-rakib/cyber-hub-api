import { Global, Module } from "@nestjs/common";
import { appConfig } from "../../core/config/app.config";
import { DevEmailAdapter } from "./dev-email.adapter";
import { EMAIL_PORT } from "./email.port";
import { ResendEmailAdapter } from "./resend-email.adapter";

@Global()
@Module({
  providers: [
    DevEmailAdapter,
    ResendEmailAdapter,
    {
      provide: EMAIL_PORT,
      useExisting: appConfig.email.provider === "resend" ? ResendEmailAdapter : DevEmailAdapter,
    },
  ],
  exports: [EMAIL_PORT],
})
export class EmailModule {}
