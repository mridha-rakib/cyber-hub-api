import { HttpStatus, RequestMethod } from "@nestjs/common";
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { IS_PUBLIC_ROUTE } from "../../../common/decorators/public.decorator";
import { API_AUTHORIZATION_MAP } from "../../../core/security/authorization/api-authorization-map";
import { API_OPERATION_METADATA } from "../../../core/security/authorization/authorize-operation.decorator";
import { ResourcesController } from "./resources.controller";

/** Route contract: exactly the nine G4-B operations, each bound to its API_AUTHORIZATION_MAP row. */
describe("ResourcesController route contract", () => {
  const proto = ResourcesController.prototype as unknown as Record<string, unknown>;
  const handlers = Object.getOwnPropertyNames(proto)
    .filter((name) => name !== "constructor")
    .map((name) => ({ name, fn: proto[name] as object }));

  const toMapPath = (path: string) => `/${path.replace(/:(\w+)/g, "{$1}")}`;
  const routes = handlers.map(({ name, fn }) => ({
    name,
    method: RequestMethod[Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod],
    path: toMapPath(Reflect.getMetadata(PATH_METADATA, fn) as string),
    isPublic: Reflect.getMetadata(IS_PUBLIC_ROUTE, fn) === true,
    apiId: Reflect.getMetadata(API_OPERATION_METADATA, fn) as string | undefined,
    httpCode: Reflect.getMetadata(HTTP_CODE_METADATA, fn) as number | undefined,
  }));

  it("exposes exactly nine routes", () => {
    expect(routes).toHaveLength(9);
  });

  it("only API-RES-001/002 are public; every other route is bound to an ADMRES operation", () => {
    const publicRoutes = routes.filter((r) => r.isPublic);
    expect(publicRoutes.map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      "GET /resources",
      "GET /resources/{resourceId}",
    ]);
    for (const r of publicRoutes) expect(r.apiId).toBeUndefined();
    const adminIds = routes.filter((r) => !r.isPublic).map((r) => r.apiId);
    expect(adminIds.sort()).toEqual([1, 2, 3, 4, 5, 6, 7].map((n) => `API-ADMRES-00${n}`));
  });

  it("method and path of each route match the authorization map (public routes match RES-001/002)", () => {
    const expected = (apiId: string) => API_AUTHORIZATION_MAP.find((op) => op.apiId === apiId);
    for (const r of routes) {
      const apiId = r.apiId ?? (r.path === "/resources" ? "API-RES-001" : "API-RES-002");
      const op = expected(apiId);
      expect({ apiId, method: r.method, path: r.path }).toEqual({
        apiId,
        method: op?.method,
        path: op?.path,
      });
    }
  });

  it("uses 201 for create, 200 for publish/archive and 204 for delete", () => {
    const code = (apiId: string) => routes.find((r) => r.apiId === apiId)?.httpCode;
    expect(code("API-ADMRES-001")).toBe(HttpStatus.CREATED);
    expect(code("API-ADMRES-003")).toBe(HttpStatus.OK);
    expect(code("API-ADMRES-004")).toBe(HttpStatus.OK);
    expect(code("API-ADMRES-005")).toBe(HttpStatus.NO_CONTENT);
  });
});
