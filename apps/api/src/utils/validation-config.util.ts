// Utilities
import { omit } from "ramda";
import { getValues } from "@usex/utils";
// Types
import type { ValidationPipeOptions } from "@nestjs/common/pipes/validation.pipe";
// Exceptions
import { BadRequestException, HttpStatus } from "@nestjs/common";

export const validationPipeOptions: ValidationPipeOptions = {
  errorHttpStatusCode: HttpStatus.BAD_REQUEST,
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
  forbidUnknownValues: true,
  validateCustomDecorators: true,
  stopAtFirstError: true,
  skipNullProperties: false,
  skipUndefinedProperties: false,
  skipMissingProperties: false,
  transformOptions: {
    // enableImplicitConversion: false,
    enableCircularCheck: true,
  },
  exceptionFactory: (errors) => {
    const { constraints = {} } =
      omit(["target", "children", "property", "value"])(errors.at(0)!) || {};
    const error = getValues(constraints).at(0);

    return new BadRequestException(error);
  },
};
