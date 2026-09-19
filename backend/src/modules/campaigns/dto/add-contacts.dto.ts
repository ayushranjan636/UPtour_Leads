import { IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddContactsDto {
  @ApiProperty({ type: [String], description: 'Array of contact UUIDs to add to the campaign' })
  @IsArray()
  @IsUUID('4', { each: true })
  contactIds: string[];
}
