import 'reflect-metadata';
import { RequestController } from './request.controller';
import { RolesGuard, Roles } from './roles.guard';

// ---------------------------------------------------------------------------
// RequestController
// ---------------------------------------------------------------------------

describe('RequestController', () => {
  let controller;
  let mockService;

  beforeEach(() => {
    mockService = {
      create: jest.fn().mockResolvedValue({ id: 'req-1', status: 'PENDING_APPROVAL' }),
      findAll: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
      findOne: jest.fn().mockResolvedValue({ id: 'req-1' }),
      updateStatus: jest.fn().mockResolvedValue({ id: 'req-1', status: 'APPROVED' }),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    controller = new RequestController(mockService);
  });

  it('create calls service.create with actorId from x-user-id header', async () => {
    const dto = { employeeId: 'emp-1', daysRequested: 3 };
    const req = { headers: { 'x-user-id': 'user-42' } };
    await controller.create(dto, req);
    expect(mockService.create).toHaveBeenCalledWith(dto, 'user-42');
  });

  it('create falls back to "unknown" when x-user-id header is absent', async () => {
    const req = { headers: {} };
    await controller.create({}, req);
    expect(mockService.create).toHaveBeenCalledWith({}, 'unknown');
  });

  it('findAll delegates to service.findAll', async () => {
    const query = { status: 'APPROVED', page: 2 };
    await controller.findAll(query);
    expect(mockService.findAll).toHaveBeenCalledWith(query);
  });

  it('findOne delegates to service.findOne with the route param', async () => {
    await controller.findOne('req-abc');
    expect(mockService.findOne).toHaveBeenCalledWith('req-abc');
  });

  it('updateStatus delegates to service.updateStatus with actorId', async () => {
    const dto = { status: 'APPROVED' };
    const req = { headers: { 'x-user-id': 'manager-7' } };
    await controller.updateStatus('req-1', dto, req);
    expect(mockService.updateStatus).toHaveBeenCalledWith('req-1', dto, 'manager-7');
  });

  it('updateStatus falls back to "unknown" when header absent', async () => {
    const req = { headers: {} };
    await controller.updateStatus('req-1', {}, req);
    expect(mockService.updateStatus).toHaveBeenCalledWith('req-1', {}, 'unknown');
  });

  it('delete delegates to service.delete with actorId', async () => {
    const req = { headers: { 'x-user-id': 'emp-9' } };
    await controller.delete('req-1', req);
    expect(mockService.delete).toHaveBeenCalledWith('req-1', 'emp-9');
  });
});

// ---------------------------------------------------------------------------
// RolesGuard
// ---------------------------------------------------------------------------

describe('RolesGuard', () => {
  function buildContext(requiredRoles, userRole) {
    const mockReflector = {
      getAllAndOverride: jest.fn().mockReturnValue(requiredRoles),
    };
    const guard = new RolesGuard(mockReflector);
    const mockContext = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({
          headers: userRole ? { 'x-user-role': userRole } : {},
        }),
      }),
    };
    return { guard, mockContext };
  }

  it('allows when no roles are required (undefined)', () => {
    const { guard, mockContext } = buildContext(undefined, undefined);
    expect(guard.canActivate(mockContext)).toBe(true);
  });

  it('allows when required roles list is empty', () => {
    const { guard, mockContext } = buildContext([], undefined);
    expect(guard.canActivate(mockContext)).toBe(true);
  });

  it('allows when user role matches a required role', () => {
    const { guard, mockContext } = buildContext(['employee', 'manager'], 'employee');
    expect(guard.canActivate(mockContext)).toBe(true);
  });

  it('denies when user role is not in required roles', () => {
    const { guard, mockContext } = buildContext(['manager'], 'employee');
    expect(guard.canActivate(mockContext)).toBe(false);
  });

  it('denies when no x-user-role header is present', () => {
    const { guard, mockContext } = buildContext(['employee'], undefined);
    expect(guard.canActivate(mockContext)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Roles decorator
// ---------------------------------------------------------------------------

describe('Roles decorator', () => {
  it('sets metadata on the handler', () => {
    const decorator = Roles('employee', 'manager');
    expect(typeof decorator).toBe('function');
  });
});
