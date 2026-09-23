import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * Contact ids for a bulk operation.
 *
 * Capped at 500 per request: these run sequentially so each row gets the same
 * validation and cleanup as a single-row call, and an unbounded list would hold a
 * request open long enough to time out behind a proxy. The UI pages at 100.
 */
export class BulkContactIdsDto {
  @ApiProperty({
    description: 'Contacts to act on',
    type: [String],
    example: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  contactIds: string[];
}

export class BulkGroupDto extends BulkContactIdsDto {
  @ApiProperty({
    description:
      'Group label. Stored in the contact\'s tags, so a contact can belong to several ' +
      'groups and a campaign audience can filter on it.',
    example: 'Agra agencies',
    maxLength: 64,
  })
  @IsString()
  @MaxLength(64)
  group: string;
}

export class BulkVerifyDto extends BulkContactIdsDto {
  @ApiPropertyOptional({
    description:
      'WhatsApp session to verify through. Defaults to the connected session, so this ' +
      'normally need not be supplied.',
  })
  @IsOptional()
  @IsString()
  sessionId?: string;
}
