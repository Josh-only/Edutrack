import { ConflictException, ForbiddenException } from '@nestjs/common';
import { StudentsService } from './students.service.js';
import { AccountStatus, AccountType, User } from '../users/entities/user.entity.js';
import { Student } from '../student/entities/student.entity/student.entity.js';
import type { AuthenticatedUser } from '../auth/current-user.decorator.js';

describe('StudentsService', () => {
  const studentRepository = { find: vi.fn(), findOne: vi.fn() };
  const dataSource = { transaction: vi.fn() };
  const usersService = {
    generateTemporaryCredential: vi.fn().mockResolvedValue({
      temporaryPassword: 'a-generated-temporary-password',
      passwordHash: 'temporary-hash',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }),
  };
  const audit = { record: vi.fn() };
  let service: StudentsService;
  const studentUser = { id: 14, email: 'learner@example.test', accountType: AccountType.STUDENT, status: AccountStatus.ACTIVE } as User;
  const student = { id: 9, user: studentUser, firstName: 'Ada', lastName: 'Okafor', email: studentUser.email } as Student;
  const actor: AuthenticatedUser = { userId: 14, email: studentUser.email, accountType: AccountType.STUDENT, status: AccountStatus.ACTIVE };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new StudentsService(dataSource as never, usersService as never, audit as never, studentRepository as never);
  });

  it('returns a Student only to its linked account', async () => {
    studentRepository.findOne.mockResolvedValue(student);
    await expect(service.findOne(student.id, actor)).resolves.toMatchObject({ id: 9, userId: 14, email: student.email });
    await expect(service.findOne(student.id, { ...actor, userId: 15 })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns the authenticated Student profile without accepting a client user ID', async () => {
    studentRepository.findOne.mockResolvedValue(student);
    await expect(service.findMine(actor)).resolves.toMatchObject({ userId: actor.userId, email: student.email });
    expect(studentRepository.findOne).toHaveBeenCalledWith({ where: { user: { id: actor.userId } }, relations: { user: true } });
  });

  it('preserves and returns legacy Student records as unlinked', async () => {
    studentRepository.find.mockResolvedValue([{ ...student, id: 3, user: null }]);
    await expect(service.findAll()).resolves.toEqual([{
      id: 3, userId: null, firstName: 'Ada', lastName: 'Okafor',
      email: student.email, status: null, temporaryPasswordExpired: false,
    }]);
  });

  it('includes a local invitation URL when the invitation service returns one', async () => {
    const users = {
      findOne: vi.fn().mockResolvedValue(null),
      create: vi.fn((value) => value),
      save: vi.fn(async (value) => ({ id: 24, ...value })),
    };
    const students = {
      findOne: vi.fn().mockResolvedValue(null),
      create: vi.fn((value) => value),
      save: vi.fn(async (value) => ({ id: 25, ...value })),
    };
    const manager = { getRepository: (entity: unknown) => entity === User ? users : students };
    dataSource.transaction.mockImplementation(async (callback) => callback(manager));
    const response = await service.createStudent({
      email: 'new-student@example.test',
      firstName: 'Ada',
      lastName: 'Okafor',
    }, { ...actor, accountType: AccountType.SUPER_ADMIN });

    expect(response.status).toBe(AccountStatus.ACTIVE);
    expect(response.credential.temporaryPassword).toBe('a-generated-temporary-password');
    expect(response.credential.expiresAt).toBeInstanceOf(Date);
  });

  it('rejects Student email updates that conflict with a different User account', async () => {
    const linkedStudent = { ...student, user: { ...studentUser } };
    const studentRepo = { findOne: vi.fn().mockResolvedValue(linkedStudent), save: vi.fn() };
    const userRepo = { findOne: vi.fn().mockResolvedValue({ id: 99 }), save: vi.fn() };
    const manager = { getRepository: (entity: unknown) => entity === User ? userRepo : studentRepo };
    dataSource.transaction.mockImplementation(async (callback) => callback(manager));

    await expect(service.updateStudent(9, { email: 'other@example.test' }, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(studentRepo.save).not.toHaveBeenCalled();
  });
});
