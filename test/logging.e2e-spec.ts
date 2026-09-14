import {
  BadRequestException,
  Controller,
  Get,
  type INestApplication,
  Injectable,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PARAMS_PROVIDER_TOKEN } from "nestjs-pino";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApplication } from "../src/bootstrap";
import { createLoggerConfig } from "../src/core/logger/logger.config";
import { LoggerService } from "../src/core/logger/logger.service";
import { RequestContextService } from "../src/core/request-context/request-context.service";

@Injectable()
class ProbeService {
  constructor(
    private readonly logger: LoggerService,
    private readonly context: RequestContextService,
  ) {}
  async run() {
    const requestId = this.context.getRequestId();
    this.context.setIdentity({
      userId: `user-${requestId}`,
      companyId: `company-${requestId}`,
      tenantId: `tenant-${requestId}`,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    this.logger.info("Probe completed", {
      operation: requestId,
      nested: {
        entries: [
          {
            passwordHash: "hidden-hash",
            refreshToken: "hidden-token",
            api_key: "hidden-key",
            webhookSecret: "hidden-webhook",
          },
        ],
      },
    });
    return { requestId: this.context.getRequestId() };
  }
}

@Controller("logging-probe")
class ProbeController {
  constructor(private readonly service: ProbeService) {}
  @Get() run() {
    return this.service.run();
  }
  @Get("error") fail() {
    throw new Error("Database failed postgres://dbuser:dbsecret@localhost/test");
  }
  @Get("invalid") invalid() {
    throw new BadRequestException("Invalid request");
  }
}

describe("Logging foundation", () => {
  let app: INestApplication;
  let output: string[];
  const records = () =>
    output
      .join("")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);

  beforeAll(async () => {
    output = [];
    const module = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
      providers: [ProbeService],
    })
      .overrideProvider(PARAMS_PROVIDER_TOKEN)
      .useFactory({
        inject: [RequestContextService],
        factory: (context: RequestContextService) =>
          createLoggerConfig(context, {
            write: (line) => {
              output.push(line);
            },
          }),
      })
      .compile();
    app = module.createNestApplication({ bufferLogs: true, bodyParser: false });
    configureApplication(app);
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    output.length = 0;
  });

  it("injects the logger and isolates concurrent request and tenant contexts", async () => {
    expect(app.get(LoggerService)).toBeInstanceOf(LoggerService);
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        request(app.getHttpServer())
          .get("/api/v1/logging-probe")
          .set("x-request-id", `req-${index}`)
          .expect(200),
      ),
    );
    const logs = records().filter((entry) => entry.msg === "Probe completed");
    expect(logs).toHaveLength(12);
    for (const log of logs)
      expect(log).toMatchObject({
        requestId: log.operation,
        userId: `user-${log.operation}`,
        companyId: `company-${log.operation}`,
        tenantId: `tenant-${log.operation}`,
      });
    expect(app.get(RequestContextService).getContext()).toBeUndefined();
  });

  it("generates an ID and emits exactly one HTTP completion with safe metadata", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/logging-probe?accessToken=hidden-query")
      .set("authorization", "Bearer hidden-header")
      .set("cookie", "session=hidden-cookie")
      .expect(200);
    const id = response.headers["x-request-id"];
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
    expect(response.body.data.requestId).toBe(id);
    const logs = records().filter((entry) => entry.msg === "HTTP request completed");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      requestId: id,
      method: "GET",
      path: "/api/v1/logging-probe",
      statusCode: 200,
      responseTime: expect.any(Number),
    });
    for (const secret of [
      "hidden-query",
      "hidden-header",
      "hidden-cookie",
      "hidden-hash",
      "hidden-token",
      "hidden-key",
      "hidden-webhook",
    ])
      expect(output.join("")).not.toContain(secret);
    expect(output.join("")).toContain("[REDACTED]");
    for (const line of output)
      expect((line.match(/"requestId":/g) ?? []).length).toBeLessThanOrEqual(1);
  });

  it("records error details internally while returning a generic 500", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/logging-probe/error")
      .expect(500);
    const errors = records().filter((entry) => entry.msg === "HTTP exception");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      level: 50,
      code: "INTERNAL_SERVER_ERROR",
      requestId: response.headers["x-request-id"],
      err: {
        name: "Error",
        stack: expect.any(String),
        message: expect.stringContaining("Database failed"),
      },
    });
    expect(output.join("")).not.toContain("dbsecret");
    expect(response.body.error.message).toBe("Internal server error");
    expect(JSON.stringify(response.body)).not.toMatch(/stack|dbsecret|Database failed/);
    expect(records().filter((entry) => entry.msg === "HTTP request failed")).toHaveLength(1);
  });

  it("logs client errors at warn level", async () => {
    await request(app.getHttpServer()).get("/api/v1/logging-probe/invalid").expect(400);
    expect(records().find((entry) => entry.msg === "HTTP exception")).toMatchObject({ level: 40 });
  });

  it.each(['{"password":"hidden-body"', "hidden-body", '"hidden-body"'])(
    "logs malformed JSON without exposing the rejected body: %s",
    async (body) => {
      const response = await request(app.getHttpServer())
        .post("/api/v1/logging-probe")
        .set("Content-Type", "application/json")
        .send(body)
        .expect(400);
      expect(response.headers["x-request-id"]).toBeTruthy();
      expect(records().filter((entry) => entry.msg === "HTTP request completed")).toHaveLength(1);
      expect(output.join("")).not.toContain("hidden-body");
      expect(JSON.stringify(response.body)).not.toContain("hidden-body");
    },
  );
});
