import { ApiProperty } from "@nestjs/swagger";

// !!! TODO: All services' response should be extends this dto automatically
/**
 * Dto for the response
 */
export class ResponseDto<T> {
  @ApiProperty({
    description: "Data",
  })
  payload: T;

  @ApiProperty({
    description: "Request ID",
    example: "e96a05f0-1fbf-417a-830d-82e24db73454",
  })
  requestId: string;

  constructor(payload: T, requestId: string) {
    this.payload = payload;
    this.requestId = requestId;
  }
}
