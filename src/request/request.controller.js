import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { RolesGuard, Roles } from './roles.guard';
import { RequestService } from './request.service';

@Controller('time-off-requests')
@UseGuards(RolesGuard)
export class RequestController {
  constructor(requestService) {
    this.requestService = requestService;
  }

  @Post()
  @Roles('employee')
  create(@Body() dto, @Req() req) {
    const actorId = req.headers['x-user-id'] ?? 'unknown';
    return this.requestService.create(dto, actorId);
  }

  @Get()
  @Roles('employee', 'manager')
  findAll(@Query() query) {
    return this.requestService.findAll(query);
  }

  @Get(':id')
  @Roles('employee', 'manager')
  findOne(@Param('id') id) {
    return this.requestService.findOne(id);
  }

  @Patch(':id')
  @Roles('manager', 'employee')
  updateStatus(@Param('id') id, @Body() dto, @Req() req) {
    const actorId = req.headers['x-user-id'] ?? 'unknown';
    return this.requestService.updateStatus(id, dto, actorId);
  }

  @Delete(':id')
  @Roles('employee')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id') id, @Req() req) {
    const actorId = req.headers['x-user-id'] ?? 'unknown';
    return this.requestService.delete(id, actorId);
  }
}
