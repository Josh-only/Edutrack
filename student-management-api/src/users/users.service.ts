import { Injectable, UnauthorizedException, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, QueryFailedError, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import { AccountStatus, AccountType, User } from './entities/user.entity.js';
import { Student } from '../student/entities/student.entity/student.entity.js';
import { Staff } from '../staff/entities/staff.entity.js';
import { AuditService } from '../audit/audit.service.js';
import { Invitation } from '../invitations/entities/invitation.entity.js';

const TEMPORARY_PASSWORD_TTL_MS = 24 * 60 * 60 * 1000;

export interface TemporaryCredential {
  temporaryPassword: string;
  expiresAt: Date;
}

interface HashedTemporaryCredential extends TemporaryCredential {
  passwordHash: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(Student) private readonly studentRepository: Repository<Student>,
    @InjectRepository(Staff) private readonly staffRepository: Repository<Staff>,
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { email: email.trim().toLowerCase() } });
  }

  async findCurrentUser(id: number) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new UnauthorizedException('Invalid session.');
    return { id: user.id, email: user.email, accountType: user.accountType, status: user.status };
  }

  async updateOwnEmail(id: number, inputEmail: string) {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(User);
        const user = await repository.findOne({ where: { id } });
        if (!user) throw new UnauthorizedException('Invalid session.');
        const before = user.email;
        const email = inputEmail.trim().toLowerCase();
        const matchingStudent = await manager.getRepository(Student).findOne({ where: { email }, relations: { user: true } });
        if (matchingStudent && matchingStudent.user?.id !== id) {
          throw new ConflictException('Email is already registered.');
        }
        user.email = email;
        await repository.save(user);
        if (user.accountType === AccountType.STUDENT) {
          const studentRepository = manager.getRepository(Student);
          const profile = await studentRepository.findOne({ where: { user: { id } } });
          if (!profile) throw new ConflictException('Account setup is incomplete. Contact an administrator.');
          profile.email = user.email;
          await studentRepository.save(profile);
        }
        await this.audit.record({ actorUserId: id, action: 'account.email_updated', targetType: 'user', targetId: id, changes: { before: { email: before }, after: { email: user.email } } }, manager);
        return { id: user.id, email: user.email, accountType: user.accountType, status: user.status };
      });
    } catch (error) {
      if (UsersService.isUniqueViolation(error)) throw new ConflictException('Email is already registered.');
      throw error;
    }
  }

  async updateOwnPassword(id: number, currentPassword: string, newPassword: string) {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(User);
      const user = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
        throw new UnauthorizedException('Current password is incorrect.');
      }
      if (await bcrypt.compare(newPassword, user.passwordHash)) {
        throw new ConflictException('Choose a password different from your current password.');
      }
      user.passwordHash = await bcrypt.hash(newPassword, 12);
      user.temporaryPasswordExpiresAt = null;
      await repository.save(user);
      await this.audit.record({
        actorUserId: id,
        action: 'account.password_changed',
        targetType: 'user',
        targetId: id,
      }, manager);
      return { id: user.id, email: user.email, accountType: user.accountType, status: user.status };
    });
  }

  async generateTemporaryCredential(): Promise<HashedTemporaryCredential> {
    const temporaryPassword = randomBytes(32).toString('base64url');
    return {
      temporaryPassword,
      passwordHash: await bcrypt.hash(temporaryPassword, 12),
      expiresAt: new Date(Date.now() + TEMPORARY_PASSWORD_TTL_MS),
    };
  }

  async issueTemporaryPassword(userId: number, actorUserId: number) {
    return this.dataSource.transaction(async (manager) => {
      const invitationRepository = manager.getRepository(Invitation);
      const pendingInvitations = await invitationRepository.find({
        where: { user: { id: userId }, acceptedAt: IsNull(), revokedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      const users = manager.getRepository(User);
      const user = await users.findOne({ where: { id: userId }, lock: { mode: 'pessimistic_write' } });
      if (!user) throw new NotFoundException('Account not found.');
      if (![AccountType.STAFF, AccountType.STUDENT].includes(user.accountType) || user.status !== AccountStatus.PENDING) {
        throw new ConflictException('Temporary passwords can only be issued to pending Staff or Student accounts.');
      }
      await this.assertProfileExists(user);

      const credential = await this.generateTemporaryCredential();
      user.passwordHash = credential.passwordHash;
      user.temporaryPasswordExpiresAt = credential.expiresAt;
      user.status = AccountStatus.ACTIVE;
      await users.save(user);

      for (const invitation of pendingInvitations) {
        invitation.revokedAt = new Date();
        invitation.tokenCiphertext = 'revoked';
        await invitationRepository.save(invitation);
      }

      await this.audit.record({
        actorUserId,
        action: 'account.temporary_password_issued',
        targetType: 'user',
        targetId: user.id,
      }, manager);
      return {
        email: user.email,
        accountType: user.accountType,
        temporaryPassword: credential.temporaryPassword,
        expiresAt: credential.expiresAt,
      };
    });
  }

  async validateUser(email: string, password: string): Promise<User> {
    const user = await this.findByEmail(email);
    if (
      !user ||
      !(await bcrypt.compare(password, user.passwordHash)) ||
      user.status !== AccountStatus.ACTIVE ||
      (user.temporaryPasswordExpiresAt && user.temporaryPasswordExpiresAt <= new Date())
    ) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    await this.assertProfileExists(user);
    if (user.temporaryPasswordExpiresAt) {
      user.temporaryPasswordExpiresAt = null;
      await this.userRepository.save(user);
    }
    return user;
  }

  async generateAccessToken(user: User): Promise<string> {
    return this.jwtService.signAsync({ sub: user.id });
  }

  async hashPassword(password: string): Promise<string> { return bcrypt.hash(password, 10); }

  private async assertProfileExists(user: User) {
    if (user.accountType === AccountType.STUDENT && !(await this.studentRepository.findOne({ where: { user: { id: user.id } } }))) {
      throw new ConflictException('Account setup is incomplete. Contact an administrator.');
    }
    if (user.accountType === AccountType.STAFF && !(await this.staffRepository.findOne({ where: { user: { id: user.id } } }))) {
      throw new ConflictException('Account setup is incomplete. Contact an administrator.');
    }
  }

  static isUniqueViolation(error: unknown): boolean {
    return error instanceof QueryFailedError && typeof error.driverError === 'object' && error.driverError !== null && 'code' in error.driverError && error.driverError.code === '23505';
  }
}
