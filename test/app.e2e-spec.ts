import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApplication } from "../src/bootstrap";
import { DatabaseService } from "../src/core/database/database.service";

describe("App foundation", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DatabaseService)
      .useValue({ isHealthy: jest.fn().mockResolvedValue(true), onApplicationShutdown: jest.fn() })
      .compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("returns readiness health status without an API prefix", async () => {
    const response = await request(app.getHttpServer()).get("/health").expect(200);

    expect(response.headers["x-request-id"]).toEqual(expect.any(String));
    expect(response.body).toMatchObject({
      status: "ok",
      timestamp: expect.any(String),
      uptime: expect.any(Number),
      environment: "test",
      services: { application: "healthy", database: "healthy" },
    });
  });

  it("publishes OpenAPI JSON when Swagger is enabled", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/docs-json").expect(200);
    expect(response.body).toMatchObject({ info: { title: "Cyber Hub API", version: "1" } });
    expect(response.body.paths).toHaveProperty("/health");
    expect(response.body.components.securitySchemes).toHaveProperty("bearer");
  });
});
