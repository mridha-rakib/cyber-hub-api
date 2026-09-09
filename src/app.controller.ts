import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";

@ApiTags("System")
@Controller()
export class AppController {
  @Get("health")
  health() {
    return {
      status: "ok",
      service: "cyber-hub-api",
    };
  }
}
