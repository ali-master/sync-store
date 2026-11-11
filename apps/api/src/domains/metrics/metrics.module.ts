import {
  type CallHandler,
  type ExecutionContext,
  Global,
  Injectable,
  Module,
  type NestInterceptor,
} from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { McpExecutionContext } from "@nestjs/mcp";
import { tap } from "rxjs";
import { SyncStorageModule } from "../sync-storage/sync-storage.module";
import { MetricsController } from "./metrics.controller";
import { MetricsService, metrics, transport } from "./metrics.service";

/**
 * Tags each handler with its transport so storage mutations can be counted per transport, and
 * counts Socket.IO events and MCP calls. `@nestjs/mcp` runs global interceptors with type "mcp".
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const type = context.getType<string>();
    if (type === "http") return transport.run("http", () => next.handle());
    if (type === "ws") {
      // @SubscribeMessage stores the event name under the "message" metadata key.
      const event = String(Reflect.getMetadata("message", context.getHandler()) ?? "unknown");
      return transport
        .run("socket", () => next.handle())
        .pipe(
          tap({
            next: (result) =>
              metrics.socketEvents.inc({
                event,
                outcome: result?.type === "error" ? "error" : "ok",
              }),
            error: () => metrics.socketEvents.inc({ event, outcome: "error" }),
          }),
        );
    }
    if (type === "mcp") {
      const call = McpExecutionContext.create(context);
      const labels = { kind: call.getKind() ?? "unknown", name: call.getName() ?? "unknown" };
      const end = metrics.mcpDuration.startTimer(labels);
      return transport
        .run("mcp", () => next.handle())
        .pipe(
          tap({
            next: (result) => {
              end();
              metrics.mcpCalls.inc({ ...labels, outcome: result?.isError ? "error" : "ok" });
            },
            error: () => {
              end();
              metrics.mcpCalls.inc({ ...labels, outcome: "error" });
            },
          }),
        );
    }
    return next.handle();
  }
}

@Global()
@Module({
  imports: [SyncStorageModule],
  controllers: [MetricsController],
  providers: [
    { provide: MetricsService, useValue: metrics },
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
