import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Public } from "../../common/decorators/public.decorator";
import { RawResponse } from "../../common/decorators/raw-response.decorator";
import { HealthService } from "./health.service";
import type { HealthResponse } from "./health.types";

@ApiTags("System")
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  @RawResponse()
  @ApiOperation({ summary: "Readiness health check" })
  @ApiOkResponse({
    description: "Application and required infrastructure are healthy.",
    schema: {
      example: {
        status: "ok",
        timestamp: "2026-09-09T00:00:00.000Z",
        uptime: 120,
        environment: "production",
        services: { application: "healthy", database: "healthy" },
      },
    },
  })
  @ApiServiceUnavailableResponse({
    description: "Application is draining or a required service is unavailable.",
  })
  async check(): Promise<HealthResponse> {
    const status = await this.health.check();
    if (!status) throw new ServiceUnavailableException("Service unavailable");
    return status;
  }
}
