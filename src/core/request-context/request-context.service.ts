import { AsyncLocalStorage } from "node:async_hooks";
import { Injectable } from "@nestjs/common";
import type { RequestContext } from "../../common/types/request-context.type";

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContext>();

  run<T>(context: RequestContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  getContext(): RequestContext | undefined {
    return this.storage.getStore();
  }

  getRequestId(): string | undefined {
    return this.getContext()?.requestId;
  }

  setIdentity(identity: Pick<RequestContext, "userId" | "companyId" | "tenantId">): void {
    const context = this.storage.getStore();
    if (!context) throw new Error("No active request context");
    Object.assign(context, identity);
  }
}
