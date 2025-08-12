import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsObject } from "class-validator";

export class StorageItemDto {
  @ApiProperty({
    description: "The value to store",
    example: "any JSON serializable value",
  })
  @IsNotEmpty()
  value: any;

  @ApiPropertyOptional({
    description: "Metadata associated with the item",
    example: { tags: ["user-preference"], expires: 1234567890 },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
