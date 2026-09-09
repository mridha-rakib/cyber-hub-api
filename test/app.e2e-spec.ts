import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApplication } from "../src/bootstrap";

describe("App foundation", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns health status", async () => {
    const response = await request(app.getHttpServer()).get("/api/health").expect(200);

    expect(response.headers["x-request-id"]).toEqual(expect.any(String));
    expect(response.body).toMatchObject({
      success: true,
      message: "Success",
      data: {
        status: "ok",
        service: "cyber-hub-api",
      },
    });
  });
});
