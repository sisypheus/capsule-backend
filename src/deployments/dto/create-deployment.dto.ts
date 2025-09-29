import { Transform } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsInt,
  Min,
  Max,
  Matches,
  IsOptional,
  MaxLength
} from 'class-validator';

export class CreateDeploymentDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-zA-Z0-9-]+\/[a-zA-Z0-9-._]+$/)
  @MaxLength(100)
  project: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  project_name: string;

  @IsString()
  @IsOptional()
  @Matches(/^[a-zA-Z0-9-._/]+$/)
  @MaxLength(100)
  branch?: string;

  @IsString()
  @IsOptional()
  @Matches(/^([^/\\:*?"<>|]+\/)*[^/\\:*?"<>|]+$/)
  @MaxLength(255)
  dockerfile_path?: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  @Transform(({ value }) => parseInt(value, 10))
  port: number;
}
