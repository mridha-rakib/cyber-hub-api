declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      userId?: string;
      companyId?: string;
      idempotencyKey?: string;
    }
  }
}

export {};
