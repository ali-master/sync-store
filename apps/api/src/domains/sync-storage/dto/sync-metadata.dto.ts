import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class SyncMetadataDto {
  @ApiProperty({
    description: "Version number for conflict resolution",
    example: 1,
  })
  version: number;

  @ApiProperty({
    description: "Timestamp of last modification",
    example: 1640995200000,
  })
  timestamp: number;

  @ApiProperty({
    description: "Date of last modification",
    example: "2022-01-01T00:00:00.000Z",
  })
  lastModified: Date;

  @ApiPropertyOptional({
    description: "Instance that last modified the item",
    example: "browser-session-123",
  })
  instanceId?: string;

  @ApiPropertyOptional({
    description: "Additional metadata",
    example: { source: "mobile-app" },
  })
  metadata?: Record<string, any>;
}
