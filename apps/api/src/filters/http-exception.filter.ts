import { Catch, HttpException, Logger } from "@nestjs/common";
import { isObject } from "@usex/utils";
import { getTraceId } from "@root/modules";
// Constants
import { HttpStatus } from "@nestjs/common";
// Types
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ExceptionFilter, ArgumentsHost } from "@nestjs/common";

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    // Get status code and error message
    let statusCode: number;
    let message: string | object;
    let error: string;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const errorResponse = exception.getResponse();

      if (isObject(errorResponse)) {
        message = (errorResponse as any).message || exception.message;
        error = (errorResponse as any).error || "Error";
      } else {
        message = errorResponse;
        error = "Error";
      }
    } else {
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      message = "Internal server error";
      error = "Internal Server Error";

      // Log unexpected errors
      this.logger.error(
        `Unhandled exception: ${exception instanceof Error ? exception.message : exception}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    // Return standardized error response
    response.type("application/problem+json").status(statusCode).send({
      error,
      message,
      path: request.url,
      requestId: getTraceId(),
    });
  }
}
