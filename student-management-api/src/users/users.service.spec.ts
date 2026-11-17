import { UnauthorizedException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service.js';
import { AccountStatus, AccountType } from './entities/user.entity.js';
import { User } from './entities/user.entity.js';
import { Student } from '../student/entities/student.entity/student.entity.js';
import { Staff } from '../staff/entities/staff.entity.js';

describe('UsersService', () => {
  const userRepository = { findOne: vi.fn(), save: vi.fn().mockImplementation(async (record) => record) };
  const studentRepository = { findOne: vi.fn() };
  const staffRepository = { findOne: vi.fn() };
  const jwt = { signAsync: vi.fn().mockResolvedValue('signed-token') };
  const dataSource = { transaction: vi.fn() };
  const audit = { record: vi.fn() };
  let service: UsersService;
  const user = { id: 7, email: 'student@example.test', passwordHash: '', accountType: AccountType.STUDENT, status: AccountStatus.ACTIVE } as User;

  beforeEach(async () => {
    vi.clearAllMocks();
    user.status = AccountStatus.ACTIVE;
    user.temporaryPasswordExpiresAt = null;
    user.accountType = AccountType.STUDENT;
    user.email = 'student@example.test';
    user.passwordHash = await bcrypt.hash('correct-password', 4);
    userRepository.findOne.mockResolvedValue(user);
    studentRepository.findOne.mockResolvedValue({ id: 1, user } as Student);
    staffRepository.findOne.mockResolvedValue({ id: 1, user } as Staff);
    service = new UsersService(userRepository as never, studentRepository as never, staffRepository as never, jwt as never, dataSource as never, audit as never);
  });

  it('accepts an active account with a required profile and signs only the subject claim', async () => {
    await expect(service.validateUser(user.email, 'correct-password')).resolves.toBe(user);
    await expect(service.generateAccessToken(user)).resolves.toBe('signed-token');
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 7 });
  });

  it('returns the same authentication error for unknown user, wrong password, and inactive user', async () => {
    userRepository.findOne.mockResolvedValue(null);
    await expect(service.validateUser('missing@example.test', 'x')).rejects.toBeInstanceOf(UnauthorizedException);
    userRepository.findOne.mockResolvedValue(user);
    await expect(service.validateUser(user.email, 'wrong-password')).rejects.toBeInstanceOf(UnauthorizedException);
    user.status = AccountStatus.SUSPENDED;
    await expect(service.validateUser(user.email, 'correct-password')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects expired temporary passwords but clears their expiry on the first successful login', async () => {
    user.temporaryPasswordExpiresAt = new Date(Date.now() - 1);
    await expect(service.validateUser(user.email, 'correct-password')).rejects.toBeInstanceOf(UnauthorizedException);

    user.temporaryPasswordExpiresAt = new Date(Date.now() + 60_000);
    userRepository.save.mockClear();
    await expect(service.validateUser(user.email, 'correct-password')).resolves.toBe(user);
    expect(user.temporaryPasswordExpiresAt).toBeNull();
    expect(userRepository.save).toHaveBeenCalledWith(user);
  });

  it('blocks accounts that do not have the matching profile', async () => {
    studentRepository.findOne.mockResolvedValue(null);
    await expect(service.validateUser(user.email, 'correct-password')).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns safe identity fields for the current account', async () => {
    await expect(service.findCurrentUser(user.id)).resolves.toEqual({ id: 7, email: user.email, accountType: user.accountType, status: user.status });
  });

  it('normalizes and synchronizes a Student own-email update in one transaction', async () => {
    const linkedProfile = { id: 1, user, email: user.email } as Student;
    const users = {
      findOne: vi.fn().mockResolvedValue(user),
      save: vi.fn().mockImplementation(async (record) => record),
    };
    const students = {
      findOne: vi.fn().mockImplementation(({ where }) => where.email ? null : linkedProfile),
      save: vi.fn().mockImplementation(async (record) => record),
    };
    const manager = { getRepository: (entity: unknown) => entity === User ? users : students };
    dataSource.transaction.mockImplementation(async (callback) => callback(manager));

    await expect(service.updateOwnEmail(user.id, ' NEW@EXAMPLE.TEST ')).resolves.toMatchObject({ email: 'new@example.test' });
    expect(user.email).toBe('new@example.test');
    expect(linkedProfile.email).toBe('new@example.test');
    expect(users.save).toHaveBeenCalledWith(user);
    expect(students.save).toHaveBeenCalledWith(linkedProfile);
  });

  it('rejects own-email changes that conflict with an unlinked legacy Student', async () => {
    const users = { findOne: vi.fn().mockResolvedValue(user), save: vi.fn() };
    const students = {
      findOne: vi.fn().mockResolvedValue({ id: 2, user: null, email: 'taken@example.test' }),
      save: vi.fn(),
    };
    const manager = { getRepository: (entity: unknown) => entity === User ? users : students };
    dataSource.transaction.mockImplementation(async (callback) => callback(manager));

    await expect(service.updateOwnEmail(user.id, 'taken@example.test')).rejects.toBeInstanceOf(ConflictException);
    expect(users.save).not.toHaveBeenCalled();
  });

  it('changes the authenticated user password only after verifying the current password', async () => {
    const changedUser = { ...user, passwordHash: user.passwordHash };
    const users = {
      findOne: vi.fn().mockResolvedValue(changedUser),
      save: vi.fn().mockImplementation(async (record) => record),
    };
    const manager = { getRepository: (entity: unknown) => entity === User ? users : {} };
    dataSource.transaction.mockImplementation(async (callback) => callback(manager));

    await expect(service.updateOwnPassword(user.id, 'incorrect-password', 'new-password-123')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.updateOwnPassword(user.id, 'correct-password', 'new-password-123')).resolves.toMatchObject({ email: user.email });
    expect(await bcrypt.compare('new-password-123', changedUser.passwordHash)).toBe(true);
    expect(changedUser.temporaryPasswordExpiresAt).toBeNull();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'account.password_changed', targetId: user.id }), manager);
  });

  it('issues a temporary password only to pending linked accounts and revokes their invitations', async () => {
    const pendingUser = {
      id: 25,
      email: 'pending-staff@example.test',
      accountType: AccountType.STAFF,
      status: AccountStatus.PENDING,
      passwordHash: 'old-hash',
      temporaryPasswordExpiresAt: null,
    } as User;
    const users = {
      findOne: vi.fn().mockResolvedValue(pendingUser),
      save: vi.fn().mockImplementation(async (record) => record),
    };
    const invitation = { acceptedAt: null, revokedAt: null, tokenCiphertext: 'encrypted' };
    const invitationRepository = {
      find: vi.fn().mockResolvedValue([invitation]),
      save: vi.fn().mockImplementation(async (record) => record),
    };
    const manager = {
      getRepository: (entity: unknown) => entity === User ? users : invitationRepository,
    };
    dataSource.transaction.mockImplementation(async (callback) => callback(manager));
    studentRepository.findOne.mockResolvedValue({ id: 1 });
    staffRepository.findOne.mockResolvedValue({ id: 1 });

    const result = await service.issueTemporaryPassword(pendingUser.id, 1);

    expect(result).toMatchObject({ email: pendingUser.email, accountType: AccountType.STAFF });
    expect(result.temporaryPassword).toHaveLength(43);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
    expect(pendingUser.status).toBe(AccountStatus.ACTIVE);
    expect(pendingUser.temporaryPasswordExpiresAt).toEqual(result.expiresAt);
    expect(invitation.revokedAt).toBeInstanceOf(Date);
    expect(invitation.tokenCiphertext).toBe('revoked');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'account.temporary_password_issued', targetId: pendingUser.id }), manager);
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(result.temporaryPassword);
  });

  it('allows Super Admin to replace an expired, unused temporary password', async () => {
    const expiredUser = {
      id: 27,
      email: 'expired-staff@example.test',
      accountType: AccountType.STAFF,
      status: AccountStatus.ACTIVE,
      passwordHash: 'expired-hash',
      temporaryPasswordExpiresAt: new Date(Date.now() - 1),
    } as User;
    const users = {
      findOne: vi.fn().mockResolvedValue(expiredUser),
      save: vi.fn().mockImplementation(async (record) => record),
    };
    const invitations = {
      find: vi.fn().mockResolvedValue([]),
      save: vi.fn(),
    };
    const manager = { getRepository: (entity: unknown) => entity === User ? users : invitations };
    dataSource.transaction.mockImplementation(async (callback) => callback(manager));

    const result = await service.issueTemporaryPassword(expiredUser.id, 1);

    expect(result).toMatchObject({ email: expiredUser.email, accountType: AccountType.STAFF });
    expect(expiredUser.status).toBe(AccountStatus.ACTIVE);
    expect(expiredUser.temporaryPasswordExpiresAt).toEqual(result.expiresAt);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('does not activate non-pending accounts or pending accounts without a linked profile', async () => {
    const pendingUser = {
      id: 26,
      email: 'legacy-student@example.test',
      accountType: AccountType.STAFF,
      status: AccountStatus.ACTIVE,
      passwordHash: 'old-hash',
      temporaryPasswordExpiresAt: null,
    } as User;
    const users = {
      findOne: vi.fn().mockResolvedValue(pendingUser),
      save: vi.fn(),
    };
    const invitationRepository = { find: vi.fn().mockResolvedValue([]), save: vi.fn() };
    const manager = { getRepository: (entity: unknown) => entity === User ? users : invitationRepository };
    dataSource.transaction.mockImplementation(async (callback) => callback(manager));
    const generateCredential = vi.spyOn(service, 'generateTemporaryCredential');

    await expect(service.issueTemporaryPassword(pendingUser.id, 1)).rejects.toBeInstanceOf(ConflictException);
    pendingUser.accountType = AccountType.STUDENT;
    pendingUser.status = AccountStatus.PENDING;
    studentRepository.findOne.mockResolvedValue(null);
    await expect(service.issueTemporaryPassword(pendingUser.id, 1)).rejects.toBeInstanceOf(ConflictException);

    expect(generateCredential).not.toHaveBeenCalled();
    expect(users.save).not.toHaveBeenCalled();
  });
});
