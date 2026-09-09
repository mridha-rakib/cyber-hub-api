import { type LoggerOptions, pino } from "pino";
import { appConfig } from "../config/app.config";
import { RequestContextService } from "../request-context/request-context.service";
import { createLoggerConfig } from "./logger.config";

describe("logger configuration", () => {
  afterEach(() => jest.restoreAllMocks());

  it("uses readable development output without a production transport", () => {
    jest.replaceProperty(appConfig, "isDevelopment", true);
    expect(createLoggerConfig(new RequestContextService()).pinoHttp).toHaveProperty(
      "transport.target",
      "pino-pretty",
    );
  });

  it("emits JSON, redacts fields, and suppresses production debug logs", () => {
    jest.replaceProperty(appConfig, "isProduction", true);
    jest.replaceProperty(appConfig, "isDevelopment", false);
    jest.replaceProperty(appConfig, "logLevel", "debug");
    const context = new RequestContextService();
    const config = createLoggerConfig(context);
    const lines: string[] = [];
    const logger = pino(config.pinoHttp as LoggerOptions, {
      write: (line) => {
        lines.push(line);
      },
    });
    context.run({ requestId: "job-123" }, () => {
      logger.debug("Debug hidden");
      logger.info(
        {
          password: "hidden",
          headers: { authorization: "hidden" },
          nested: { deep: { apiKey: "hidden" } },
        },
        "Operation completed",
      );
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("hidden");
    expect(JSON.parse(lines[0])).toMatchObject({
      level: 30,
      requestId: "job-123",
      password: "[REDACTED]",
      time: expect.stringMatching(/Z$/),
    });
    expect(config.pinoHttp).not.toHaveProperty("transport.target");
  });
});
