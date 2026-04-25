import 'reflect-metadata';
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RolesGuard, Roles } from './roles.guard';
import { RequestService } from './request.service';

// NestJS RouteParamtypes: REQUEST=0, BODY=3, QUERY=4, PARAM=5
const RouteParamtypes = { REQUEST: 0, BODY: 3, QUERY: 4, PARAM: 5 };

// Replaces @Body(), @Param(), @Query(), @Req() parameter decorators — those are not
// supported by Babel's legacy decorator plugin, so we set the reflection metadata directly.
function defineRouteArgs(target, key, ...args) {
  const metadata = {};
  for (const { paramtype, index, data } of args) {
    const entry = { index, pipes: [] };
    if (data !== undefined) entry.data = data;
    metadata[`${paramtype}:${index}`] = entry;
  }
  Reflect.defineMetadata(ROUTE_ARGS_METADATA, metadata, target, key);
}

@Controller('time-off-requests')
@UseGuards(RolesGuard)
export class RequestController {
  constructor(requestService) {
    this.requestService = requestService;
  }

  @Post()
  @Roles('employee')
  create(dto, req) {
    const actorId = req.headers['x-user-id'] ?? 'unknown';
    return this.requestService.create(dto, actorId);
  }

  @Get()
  @Roles('employee', 'manager')
  findAll(query) {
    return this.requestService.findAll(query);
  }

  @Get(':id')
  @Roles('employee', 'manager')
  findOne(id) {
    return this.requestService.findOne(id);
  }

  @Patch(':id')
  @Roles('manager', 'employee')
  updateStatus(id, dto, req) {
    const actorId = req.headers['x-user-id'] ?? 'unknown';
    return this.requestService.updateStatus(id, dto, actorId);
  }

  @Delete(':id')
  @Roles('employee')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(id, req) {
    const actorId = req.headers['x-user-id'] ?? 'unknown';
    return this.requestService.delete(id, actorId);
  }
}

// Register route argument bindings after class definition
defineRouteArgs(RequestController, 'create',
  { paramtype: RouteParamtypes.BODY, index: 0 },
  { paramtype: RouteParamtypes.REQUEST, index: 1 },
);
defineRouteArgs(RequestController, 'findAll',
  { paramtype: RouteParamtypes.QUERY, index: 0 },
);
defineRouteArgs(RequestController, 'findOne',
  { paramtype: RouteParamtypes.PARAM, index: 0, data: 'id' },
);
defineRouteArgs(RequestController, 'updateStatus',
  { paramtype: RouteParamtypes.PARAM, index: 0, data: 'id' },
  { paramtype: RouteParamtypes.BODY, index: 1 },
  { paramtype: RouteParamtypes.REQUEST, index: 2 },
);
defineRouteArgs(RequestController, 'delete',
  { paramtype: RouteParamtypes.PARAM, index: 0, data: 'id' },
  { paramtype: RouteParamtypes.REQUEST, index: 1 },
);
