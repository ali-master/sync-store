import { ApiProperty } from "@nestjs/swagger";

export class ErrorResponseDto {
  @ApiProperty({
    description: "کد وضعیت HTTP",
  })
  statusCode: number;

  @ApiProperty({
    description: "زمان دریافت درخواست",
  })
  readonly date: string;

  @ApiProperty({
    description: "مسیر درخواست",
  })
  readonly path: string;

  @ApiProperty({
    description: "متن خطا سرور",
  })
  readonly message: string;

  @ApiProperty({
    description: "شناسهٔ یکتاء پیگیری درخواست",
  })
  readonly requestId: string;
}
