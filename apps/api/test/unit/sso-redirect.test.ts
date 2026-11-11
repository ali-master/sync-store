import "reflect-metadata";
import { afterAll, expect, test } from "bun:test";
import { UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { SsoController } from "../../src/domains/admin/sso.controller";
import { SsoService } from "../../src/domains/admin/sso.service";

let refused = false;

// Boot at module scope, matching the existing Fastify tests under Bun 1.4.
const module = await Test.createTestingModule({
  controllers: [SsoController],
  providers: [
    {
      provide: SsoService,
      useValue: {
        begin: async () => {
          if (refused) throw new UnauthorizedException("Sign-in refused");
          return { url: "https://id.example/authorize", state: "test-state" };
        },
        complete: async () => {
          if (refused) throw new UnauthorizedException("Sign-in refused");
          return { token: "test-handoff" };
        },
      },
    },
  ],
}).compile();
const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
app.setGlobalPrefix("api/v1");
await app.init();
await app.getHttpAdapter().getInstance().ready();

afterAll(async () => {
  await app?.close();
});

test("SSO login and callback send browser redirects on success and refusal", async () => {
  for (const fail of [false, true]) {
    refused = fail;
    for (const route of ["login", "callback"]) {
      const response = await app.inject({ method: "GET", url: `/api/v1/sso/${route}` });
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe(
        fail
          ? "/dashboard/#sso-error=Sign-in%20refused"
          : route === "login"
            ? "https://id.example/authorize"
            : "/dashboard/#sso",
      );
      expect(response.headers["cache-control"]).toBe("no-store");
    }
  }
});
