import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { SyncMetadataDto } from "./sync-metadata.dto";

export class StorageResponseDto {
  @ApiProperty({
    description: "The storage key",
    example: "user-preference",
  })
  key: string;

  @ApiProperty({
    description: "The stored value",
    example: "any JSON serializable value",
  })
  value: any;

  @ApiPropertyOptional({
    description: "Synchronization metadata",
    type: SyncMetadataDto,
  })
  metadata?: SyncMetadataDto;

  @ApiProperty({
    description: "Version number",
    example: 1,
  })
  version: number;

  @ApiProperty({
    description: "Timestamp of creation/modification",
    example: 1640995200000,
  })
  timestamp: number;
}
