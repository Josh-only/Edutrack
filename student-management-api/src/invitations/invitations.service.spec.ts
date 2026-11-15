import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  AccountStatus,
  AccountType,
  User,
} from '../users/entities/user.entity.js';
import { Invitation } from './entities/invitation.entity.js';
import { InvitationsService } from './invitations.service.js';
import {
  InvitationStatus,
  ListInvitationsQueryDto,
} from './dto/list-invitations-query.dto.js';
import { EmailOutbox } from '../notifications/entities/email-outbox.entity.js';
import { digestInvitationToken } from './invitation-crypto.js';

function listBuilder(rows: Record<string, unknown>[] = []) {
  const builder = {
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    addSelect: vi.fn().mockReturnThis(),
    setParameter: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    getCount: vi.fn().mockResolvedValue(rows.length),
    orderBy: vi.fn().mockReturnThis(),
    addOrderBy: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    take: vi.fn().mockReturnThis(),
    getRawMany: vi.fn().mockResolvedValue(rows),
  };
  return builder;
}

function makeService(
  repository: Record<string, unknown>,
  dataSource = {},
  audit = {},
  config: Record<string, unknown> = {
    get: vi.fn().mockReturnValue(undefined),
    getOrThrow: vi.fn().mockReturnValue('test-secret'),
  },
) {
  return new InvitationsService(
    dataSource as never,
    audit as never,
    config as never,
    repository as never,
  );
}

const admin = {
  userId: 1,
  email: 'admin@example.test',
  accountType: AccountType.SUPER_ADMIN,
  status: AccountStatus.ACTIVE,
};
const staff = {
  userId: 7,
  email: 'staff@example.test',
  accountType: AccountType.STAFF,
  status: AccountStatus.ACTIVE,
};

describe('InvitationsService.list', () => {
  it('filters and paginates a safe administrative projection for Super Admin', async () => {
    const builder = listBuilder([
      {
        id: 12,
        email: 'student@example.test',
        accountType: AccountType.STUDENT,
        purpose: 'account_activation',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        expiresAt: new Date('2025-01-03T00:00:00.000Z'),
        acceptedAt: null,
        revokedAt: null,
        status: InvitationStatus.PENDING,
        creatorId: 1,
        creatorEmail: 'admin@example.test',
        tokenDigest: 'secret',
        tokenCiphertext: 'secret',
      },
    ]);
    const service = makeService({
      createQueryBuilder: vi.fn().mockReturnValue(builder),
    });
    const query = {
      status: InvitationStatus.PENDING,
      accountType: AccountType.STUDENT,
      email: 'STUDENT@example.test',
      page: 2,
      limit: 10,
    } as ListInvitationsQueryDto;

    const result = await service.list(query, admin);

    expect(builder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('recipient.accountType'),
      { accountType: AccountType.STUDENT },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'LOWER(recipient.email) = :email',
      { email: 'student@example.test' },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('invitation.expiresAt'),
      { status: InvitationStatus.PENDING },
    );
    expect(builder.addSelect).toHaveBeenCalledWith(
      expect.stringContaining('WHEN invitation.expiresAt <= :now'),
      'status',
    );
    expect(builder.skip).toHaveBeenCalledWith(10);
    expect(builder.take).toHaveBeenCalledWith(10);
    expect(result).toEqual({
      items: [
        {
          id: 12,
          email: 'student@example.test',
          accountType: AccountType.STUDENT,
          purpose: 'account_activation',
          createdAt: new Date('2025-01-01T00:00:00.000Z'),
          expiresAt: new Date('2025-01-03T00:00:00.000Z'),
          acceptedAt: null,
          revokedAt: null,
          status: InvitationStatus.PENDING,
          creator: { id: 1, email: 'admin@example.test' },
        },
      ],
      total: 1,
      page: 2,
      limit: 10,
      totalPages: 1,
    });
    expect(JSON.stringify(result)).not.toContain('tokenDigest');
    expect(JSON.stringify(result)).not.toContain('tokenCiphertext');
  });

  it('restricts Staff queries to Student invitations they created', async () => {
    const builder = listBuilder();
    const service = makeService({
      createQueryBuilder: vi.fn().mockReturnValue(builder),
    });

    await service.list(
      { page: 1, limit: 25 } as ListInvitationsQueryDto,
      staff,
    );

    expect(builder.andWhere).toHaveBeenCalledWith(
      'recipient.accountType = :studentType',
      { studentType: AccountType.STUDENT },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'invitation.createdByUserId = :actorUserId',
      { actorUserId: 7 },
    );
  });

  it('rejects Student access even when called outside the HTTP controller', async () => {
    const service = makeService({ createQueryBuilder: vi.fn() });
    await expect(
      service.list({ page: 1, limit: 25 } as ListInvitationsQueryDto, {
        userId: 8,
        email: 'student@example.test',
        accountType: AccountType.STUDENT,
        status: AccountStatus.ACTIVE,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('InvitationsService.createFor', () => {
  function makeCreationContext() {
    const invitationRepository = {
      create: vi.fn((value) => value),
      save: vi.fn(async (value) => ({ id: 17, ...value })),
    };
    const outboxRepository = {
      create: vi.fn((value) => value),
      save: vi.fn(async (value) => value),
    };
    const manager = {
      getRepository: vi.fn((entity: unknown) => {
        if (entity === Invitation) return invitationRepository;
        if (entity === EmailOutbox) return outboxRepository;
        throw new Error('Unexpected repository request.');
      }),
    };
    return { manager };
  }

  it('returns a local invitation URL only for explicitly enabled development without SMTP', async () => {
    const { manager } = makeCreationContext();
    const configValues: Record<string, string> = {
      NODE_ENV: 'development',
      LOCAL_INVITATION_LINKS: 'true',
      JWT_SECRET: 'test-secret',
    };
    const config = {
      get: vi.fn((name: string) => configValues[name]),
      getOrThrow: vi.fn((name: string) => configValues[name]),
    };
    const service = makeService({}, {}, { record: vi.fn() }, config);
    const user = { id: 22, email: 'invitee@example.test' } as User;

    const result = await service.createFor(manager as never, user, admin.userId);

    expect(result.invitationUrl).toBeDefined();
    const url = result.invitationUrl;
    const token = new URL(url ?? '').searchParams.get('token');
    expect(token).toBeTruthy();
    if (token) expect(digestInvitationToken(token)).toBe(result.invitation.tokenDigest);
    expect(new URL(url ?? '').origin).toBe('http://localhost:5173');
  });

  it.each([
    {
      label: 'without explicit opt-in',
      values: { NODE_ENV: 'development', JWT_SECRET: 'test-secret' },
    },
    {
      label: 'when SMTP is configured',
      values: { NODE_ENV: 'development', LOCAL_INVITATION_LINKS: 'true', SMTP_HOST: 'smtp.example.test', JWT_SECRET: 'test-secret' },
    },
  ])('does not return a local invitation URL $label', async ({ values }) => {
    const { manager } = makeCreationContext();
    const config = {
      get: vi.fn((name: string) => values[name as keyof typeof values]),
      getOrThrow: vi.fn((name: string) => values[name as keyof typeof values]),
    };
    const service = makeService({}, {}, { record: vi.fn() }, config);
    const user = { id: 22, email: 'invitee@example.test' } as User;

    await expect(service.createFor(manager as never, user, admin.userId)).resolves.not.toHaveProperty('invitationUrl');
  });
});

describe('InvitationsService invitation actions', () => {
  it('rejects Staff revocation of an invitation created by someone else', async () => {
    const invitation = {
      id: 4,
      createdByUserId: 99,
      acceptedAt: null,
      revokedAt: null,
      user: { id: 30, accountType: AccountType.STUDENT },
    } as Invitation;
    const repository = { findOne: vi.fn().mockResolvedValue(invitation) };
    const manager = { getRepository: vi.fn().mockReturnValue(repository) };
    const dataSource = {
      transaction: (callback: (manager: unknown) => unknown) =>
        callback(manager),
    };
    const service = makeService({}, dataSource);

    await expect(service.revoke(4, staff)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('invalidates the previous encrypted delivery token when resending', async () => {
    const old = {
      id: 4,
      createdByUserId: 7,
      acceptedAt: null,
      revokedAt: null,
      tokenCiphertext: 'encrypted-token',
      user: {
        id: 30,
        accountType: AccountType.STUDENT,
        status: AccountStatus.PENDING,
      },
    } as Invitation;
    const outstanding = {
      id: 6,
      revokedAt: null,
      tokenCiphertext: 'another-encrypted-token',
    } as Invitation;
    const outstandingQuery = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      setLock: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([outstanding]),
    };
    const repository = {
      findOne: vi.fn().mockResolvedValue(old),
      save: vi.fn().mockImplementation(async (record) => record),
      createQueryBuilder: vi.fn().mockReturnValue(outstandingQuery),
    };
    const userRepository = {
      findOne: vi.fn().mockResolvedValue({ ...old.user }),
    };
    const manager = {
      getRepository: (entity: unknown) =>
        entity === User ? userRepository : repository,
    };
    const dataSource = {
      transaction: (callback: (manager: unknown) => unknown) =>
        callback(manager),
    };
    const service = makeService({}, dataSource, {
      record: vi.fn().mockResolvedValue(undefined),
    });
    vi.spyOn(service, 'createFor').mockResolvedValue({
      invitation: {
        id: 5,
        expiresAt: new Date('2025-01-03T00:00:00.000Z'),
      } as Invitation,
      invitationUrl: 'http://localhost:5173/accept-invitation?token=local-token',
    });

    await expect(service.resend(4, staff)).resolves.toMatchObject({
      id: 5,
      status: 'pending_delivery',
      invitationUrl: 'http://localhost:5173/accept-invitation?token=local-token',
    });
    expect(old.tokenCiphertext).toBe('revoked');
    expect(old.revokedAt).toBeInstanceOf(Date);
    expect(outstanding.tokenCiphertext).toBe('revoked');
    expect(outstanding.revokedAt).toBeInstanceOf(Date);
  });

  it.each([
    {
      label: 'expired',
      acceptedAt: null as Date | null,
      revokedAt: null as Date | null,
      expiresAt: new Date(Date.now() - 1),
    },
    {
      label: 'revoked',
      acceptedAt: null,
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    },
    {
      label: 'accepted',
      acceptedAt: new Date(),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    },
  ])(
    'rejects a $label invitation before changing account state',
    async ({ acceptedAt, revokedAt, expiresAt }) => {
      const invitation = {
        acceptedAt,
        revokedAt,
        expiresAt,
        user: { id: 3, status: AccountStatus.PENDING },
      } as Invitation;
      const query = {
        innerJoinAndSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        setLock: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(invitation),
      };
      const repository = {
        createQueryBuilder: vi.fn().mockReturnValue(query),
        save: vi.fn(),
      };
      const manager = { getRepository: vi.fn().mockReturnValue(repository) };
      const dataSource = {
        transaction: (callback: (manager: unknown) => unknown) =>
          callback(manager),
      };
      const service = makeService({}, dataSource);

      await expect(
        service.accept({
          token: 'fictional-token',
          password: 'fictional-password',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(repository.save).not.toHaveBeenCalled();
    },
  );
});
