import type { Request, Response } from "express";
import type { Params } from "nestjs-pino";
import { type DestinationStream, stdTimeFunctions } from "pino";
import { appConfig } from "../config/app.config";
import type { RequestContextService } from "../request-context/request-context.service";
import { createRequestId } from "../request-context/request-id.util";
import { sanitizeLog, sanitizeText } from "./log-sanitizer";

const sensitiveFields = [
  "password",
  "passwordHash",
  "accessToken",
  "refreshToken",
  "token",
  "secret",
  "apiKey",
  "databaseUrl",
  "DATABASE_URL",
  "paymentSecret",
  "webhookSecret",
  "authorization",
  "cookie",
];

export function createLoggerConfig(
  context: RequestContextService,
  stream?: DestinationStream,
): Params<Request, Response> {
  const options: Exclude<
    Params<Request, Response>["pinoHttp"],
    DestinationStream | unknown[] | undefined
  > = {
    level:
      appConfig.isProduction && ["debug", "trace"].includes(appConfig.logLevel)
        ? "info"
        : appConfig.logLevel,
    base: { service: "cyber-hub-api", environment: appConfig.nodeEnv },
    timestamp: stdTimeFunctions.isoTime,
    transport:
      appConfig.isDevelopment && !stream
        ? {
            target: "pino-pretty",
            options: { colorize: true, singleLine: true, translateTime: "SYS:standard" },
          }
        : undefined,
    redact: {
      paths: sensitiveFields
        .flatMap((field) => [field, `*.${field}`])
        .concat(["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]']),
      censor: "[REDACTED]",
    },
    formatters: { log: (fields) => sanitizeLog(fields) as Record<string, unknown> },
    hooks: {
      logMethod(args, method) {
        const safeArgs = args.map((arg) =>
          typeof arg === "string" ? sanitizeText(arg) : arg,
        ) as typeof args;
        if (
          this.bindings().requestId &&
          typeof safeArgs[0] === "object" &&
          safeArgs[0] !== null &&
          !(safeArgs[0] instanceof Error)
        ) {
          const fields = { ...safeArgs[0] } as Record<string, unknown>;
          delete fields.requestId;
          safeArgs[0] = fields;
        }
        method.apply(this, safeArgs);
      },
    },
    mixin: (_fields, _level, logger) => {
      const fields: Record<string, unknown> = { category: "application", ...context.getContext() };
      if (logger.bindings().requestId) delete fields.requestId;
      return fields;
    },
    quietReqLogger: true,
    quietResLogger: true,
    customAttributeKeys: { reqId: "requestId" },
    genReqId: (req, res) => {
      const id = req.requestId ?? createRequestId(req.headers["x-request-id"]);
      req.requestId = id;
      res.setHeader("x-request-id", id);
      return id;
    },
    serializers: {
      req: (req: { method?: string; url?: string }) => ({
        method: req.method,
        path: req.url?.split("?")[0],
      }),
      res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
      err: (error: unknown) => sanitizeLog(error),
    },
    customLogLevel: (_req, res, err) =>
      err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
    customSuccessMessage: () => "HTTP request completed",
    customErrorMessage: () => "HTTP request failed",
    customSuccessObject: (req, res, value: { responseTime?: number }) =>
      httpFields(req, res, value.responseTime, context),
    customErrorObject: (req, res, _err, value: { responseTime?: number }) =>
      httpFields(req, res, value.responseTime, context),
  };
  return { pinoHttp: stream ? [options, stream] : options };
}

function httpFields(
  req: Request,
  res: Response,
  responseTime: number | undefined,
  context: RequestContextService,
) {
  return {
    ...context.getContext(),
    requestId: req.requestId,
    method: req.method,
    path: (req.originalUrl ?? req.url).split("?")[0],
    statusCode: res.statusCode,
    responseTime,
  };
}
