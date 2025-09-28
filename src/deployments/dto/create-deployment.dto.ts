import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateDeploymentDto {
  @IsString()
  @IsNotEmpty()
  project: string;

  @IsString()
  @IsNotEmpty()
  project_name: string;

  @IsNumber()
  port: number;

  @IsString()
  branch?: string;

  @IsString()
  dockerfile_path?: string;
}
