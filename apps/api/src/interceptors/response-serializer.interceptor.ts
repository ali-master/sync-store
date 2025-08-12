import { Injectable } from "@nestjs/common";
// Utilities
import { Reflector } from "@nestjs/core";
import { getTraceId } from "@root/modules";
import { withConstructor } from "@root/utils";
import { isArray, Decimal } from "@usex/utils";
import { map } from "rxjs/internal/operators/map";
import { instanceToPlain } from "class-transformer";
// Constants
import { TRACE_ID_TOKEN_HEADER } from "@root/constants";
// DTOs
import { ResponseDto } from "@root/dtos";
// Types
import type { FastifyReply, FastifyRequest } from "fastify";
import type { CallHandler, ExecutionContext, NestInterceptor } from "@nestjs/common";

@Injectable()
export class ResponseSerializerInterceptor<T> implements NestInterceptor<T> {
  constructor(private readonly reflector: Reflector) {}
  /**
   * Intercept the request and add the timestamp
   * @param context {ExecutionContext}
   * @param next {CallHandler}
   */
  intercept(context: ExecutionContext, next: CallHandler) {
    /**
     * 1. Capture start time in high resolution before the handler executes.
     *    Using hrtime() so we can compute total processing time.
     */
    const startTime = process.hrtime();

    const req = context.switchToHttp().getRequest<FastifyRequest>();

    // Check if this request should skip serialization
    const shouldNotBeLogged = /api\/(v\d)\/(metrics)/g.test(req.url);
    if (shouldNotBeLogged) {
      return next.handle();
    }

    return next.handle().pipe(
      map((body) => {
        const res = context.switchToHttp().getResponse<FastifyReply>();

        /**
         * 2. Compute elapsed time in ms since the start of the handler.
         */
        const [seconds, nanoseconds] = process.hrtime(startTime);
        const totalMs = new Decimal(seconds).mul(1_000).add(nanoseconds).div(1_000_000).toFixed(3);

        /**
         * 3. Write the Server-Timing header to the response.
         *    The 'dur' attribute is in milliseconds;
         */
        res.header("Server-Timing", `total;dur=${totalMs};desc="Total processing time (ms)"`);
        // Set Vary header to indicate that the response varies based on Accept and Accept-Encoding headers
        res.header("Vary", "Accept, Accept-Encoding");

        // Insert the request trace header
        const requestId = getTraceId();
        res.headers[TRACE_ID_TOKEN_HEADER] = requestId;

        const contentType = res.getHeaders()["content-type"] as string;
        /**
         * If the response is not JSON, we return the body as is.
         * This is useful for cases like file downloads or other non-JSON responses.
         */
        if (contentType && !contentType.includes("application/json")) {
          return body;
        }

        /**
         * 4. Optionally apply the serializer DTO (if any).
         */
        const payload = body || {};
        const ResponsePayloadDto =
          this.reflector.get("SERIALIZER_DTO", context.getHandler()) ?? false;

        if (ResponsePayloadDto) {
          const PayloadDto = withConstructor<T>(
            isArray(ResponsePayloadDto) ? ResponsePayloadDto[0] : ResponsePayloadDto,
          );

          let data: T | T[];
          if (isArray(payload)) {
            data = [];
            let i = 0;
            for (const value of payload) {
              // @ts-expect-error
              data[i] = instanceToPlain(new PayloadDto(value), {
                enableImplicitConversion: true,
              }) as T;
              i++;
            }
          } else {
            data = instanceToPlain(new PayloadDto(payload), {
              enableImplicitConversion: true,
            }) as T;
          }

          return new ResponseDto<T | Array<T>>(data, requestId);
        }

        // If there's no custom payload DTO, just return a generic response
        return new ResponseDto<T>(payload, requestId);
      }),
    );
  }
}
