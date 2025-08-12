import { Global, Module } from "@nestjs/common";
// Modules
import { ClsModule } from "nestjs-cls";
// Interceptors
import { ClsInterceptor } from "nestjs-cls";
// Services
import { ClsService } from "nestjs-cls";
import { ContextService } from "@root/modules/context/context.service";
import { ContextRepository } from "@root/modules/context/context.repository";
// Utilities
import { createUniqueId } from "@usex/utils";
import { assignMetadata } from "@root/utils/assign-metadata.util";
// Constants
import { APP_INTERCEPTOR } from "@nestjs/core";
import { TRACE_ID_TOKEN_HEADER } from "@root/constants";
// Types
import type { Type } from "@nestjs/common";
import type { ClsModuleProxyProviderOptions } from "nestjs-cls/dist/src/lib/proxy-provider/proxy-provider.interfaces";

@Global()
@Module({
  imports: [
    ClsModule.forRootAsync({
      global: true,
      useFactory: () => ({
        middleware: {
          mount: true,
        },
        interceptor: {
          mount: true,
          idGenerator: (ctx) => {
            const req = ctx.switchToHttp().getRequest();
            const requestId = req.headers[TRACE_ID_TOKEN_HEADER] ?? createUniqueId();
            req.headers[TRACE_ID_TOKEN_HEADER] = requestId;

            return requestId;
          },
          setup: async (cls, context) => {
            await assignMetadata(cls, context);
          },
        },
      }),
    }),
    ClsModule.forFeature(),
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: ClsInterceptor,
    },
    {
      provide: ContextService,
      useExisting: ClsService,
    },
    {
      provide: ContextRepository,
      useExisting: ClsService,
    },
  ],
  exports: [ContextService, ContextRepository],
})
export class ContextModule {
  /**
   * Register proxy services for the ClsModule globally
   * @param feature
   */
  static registerProxyAsync(feature: ClsModuleProxyProviderOptions) {
    return ClsModule.forFeatureAsync(feature);
  }

  /**
   * Register proxy services for the ClsModule globally
   * @param proxyProviderClasses The classes to register as proxy providers
   */
  static registerProxy(...proxyProviderClasses: Array<Type>) {
    return ClsModule.forFeature(...proxyProviderClasses);
  }
}
