import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
  ValidationPipe,
  Query
} from '@nestjs/common';
import { AuthGuard } from 'src/auth/auth.guard';
import type { Request } from 'express';
import { User } from '@supabase/supabase-js';
import { DeploymentsService } from './deployments.service';
import { CreateDeploymentDto } from './dto/create-deployment.dto';

@UseGuards(AuthGuard)
@Controller('deployments')
export class DeploymentsController {
  constructor(private readonly deploymentsService: DeploymentsService) {}

  @Get()
  findAll(
    @Req() req: Request,
    @Query('page') page: number,
    @Query('per_page') perPage: number
  ) {
    const user = req['user'] as User;
    return this.deploymentsService.findForUser(user, page, perPage);
  }

  @Post()
  create(
    @Req() req: Request,
    @Body(new ValidationPipe()) createDeploymentDto: CreateDeploymentDto
  ) {
    const user = req['user'] as User;
    return this.deploymentsService.create(user, createDeploymentDto.imageName);
  }
}
