import { IsNotEmpty, IsString } from 'class-validator';

export class CreateDeploymentDto {
  @IsString()
  @IsNotEmpty()
  project: string;

  @IsString()
  @IsNotEmpty()
  project_name: string;

  @IsString()
  branch?: string;

  @IsString()
  dockerfile_path?: string;
}
