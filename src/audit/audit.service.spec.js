import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { AuditLog, AuditEntityType, AuditAction, AuditSource } from '../entities/audit-log.entity';
import { AuditService } from './audit.service';

const BASE = {
  entityType: AuditEntityType.BALANCE,
  entityId: 'bal-001',
  action: AuditAction.CREATED,
  actor: 'test-actor',
  source: AuditSource.SYSTEM,
};

describe('AuditService', () => {
  let service;
  let app;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [AuditLog],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([AuditLog]),
      ],
      providers: [
        {
          provide: AuditService,
          useFactory: (repo) => new AuditService(repo),
          inject: [getRepositoryToken(AuditLog)],
        },
      ],
    }).compile();

    service = app.get(AuditService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a record with correct fields', async () => {
    const result = await service.log({ ...BASE, deltaDays: 5 });

    expect(result.id).toBeDefined();
    expect(result.entityType).toBe(AuditEntityType.BALANCE);
    expect(result.entityId).toBe('bal-001');
    expect(result.action).toBe(AuditAction.CREATED);
    expect(result.actor).toBe('test-actor');
    expect(result.source).toBe(AuditSource.SYSTEM);
    expect(Number(result.deltaDays)).toBe(5);
    expect(result.createdAt).toBeDefined();
  });

  it('serialises metadata object to a JSON string before storage', async () => {
    const metadata = { reason: 'annual leave', approved: true, days: 3 };
    const result = await service.log({ ...BASE, metadata });

    expect(typeof result.metadata).toBe('string');
    expect(JSON.parse(result.metadata)).toEqual(metadata);
  });

  it('creates two separate records when called twice — no upsert', async () => {
    const first = await service.log({ ...BASE });
    const second = await service.log({ ...BASE });

    expect(first.id).not.toBe(second.id);

    const repo = app.get(getRepositoryToken(AuditLog));
    const [row1, row2] = await Promise.all([
      repo.findOneBy({ id: first.id }),
      repo.findOneBy({ id: second.id }),
    ]);
    expect(row1).not.toBeNull();
    expect(row2).not.toBeNull();
  });

  it('does not throw and stores null when metadata is undefined', async () => {
    const result = await service.log({ ...BASE });

    expect(result.id).toBeDefined();
    expect(result.metadata).toBeNull();
  });
});
