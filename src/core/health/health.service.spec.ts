import { HealthService } from "./health.service";

describe("HealthService", () => {
  const database = { isHealthy: jest.fn<Promise<boolean>, []>() };
  const logger = { info: jest.fn() };
  let service: HealthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new HealthService(database as never, logger as never);
  });

  it("reports readiness when required services are healthy", async () => {
    database.isHealthy.mockResolvedValue(true);
    await expect(service.check()).resolves.toMatchObject({
      status: "ok",
      services: { application: "healthy", database: "healthy" },
    });
  });

  it("returns unavailable while draining or when PostgreSQL is unavailable", async () => {
    database.isHealthy.mockResolvedValue(false);
    await expect(service.check()).resolves.toBeUndefined();
    database.isHealthy.mockResolvedValue(true);
    service.beforeApplicationShutdown("SIGTERM");
    await expect(service.check()).resolves.toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith("Application is draining", { signal: "SIGTERM" });
  });
});
