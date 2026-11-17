import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AccountStatus, AccountType, User } from '../users/entities/user.entity.js';
import { UsersService } from '../users/users.service.js';
import { CreateStaffDto } from './dto/create-staff.dto.js';
import { UpdateStaffDto } from './dto/update-staff.dto.js';
import { Staff } from './entities/staff.entity.js';
import { Student } from '../student/entities/student.entity/student.entity.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthenticatedUser } from '../auth/current-user.decorator.js';

export interface StaffResponse {
  id: number; userId: number; email: string; firstName: string; lastName: string;
  phoneNumber: string; department: string; designation: string; status: AccountStatus;
  temporaryPasswordExpired: boolean;
}

@Injectable()
export class StaffService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
    private readonly audit: AuditService,
    @InjectRepository(Staff) private readonly staffRepository: Repository<Staff>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
  ) {}

  async create(dto: CreateStaffDto, actor: AuthenticatedUser) {
    const email = dto.email.trim().toLowerCase();
    try {
      return await this.dataSource.transaction(async (manager) => {
        const users = manager.getRepository(User);
        if (await users.findOne({ where: { email } }) || await manager.getRepository(Student).findOne({ where: { email } })) {
          throw new ConflictException('Email is already registered.');
        }
        const credential = await this.usersService.generateTemporaryCredential();
        const user = await users.save(users.create({
          email,
          passwordHash: credential.passwordHash,
          accountType: AccountType.STAFF,
          status: AccountStatus.ACTIVE,
          temporaryPasswordExpiresAt: credential.expiresAt,
        }));
        const staffs = manager.getRepository(Staff);
        const profile = await staffs.save(staffs.create({
          user, firstName: dto.firstName.trim(), lastName: dto.lastName.trim(),
          phoneNumber: dto.phoneNumber.trim(), department: dto.department.trim(), designation: dto.designation.trim(),
        }));
        await this.audit.record({ actorUserId: actor.userId, action: 'staff.created', targetType: 'staff', targetId: profile.id }, manager);
        return {
          ...this.toResponse(profile),
          credential: {
            temporaryPassword: credential.temporaryPassword,
            expiresAt: credential.expiresAt,
          },
        };
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (this.isUniqueViolation(error)) throw new ConflictException('Email is already registered.');
      throw error;
    }
  }

  async findAll(): Promise<StaffResponse[]> {
    const profiles = await this.staffRepository.find({ relations: { user: true }, order: { id: 'ASC' } });
    return profiles.map((profile) => this.toResponse(profile));
  }

  async findMine(actor: AuthenticatedUser): Promise<StaffResponse> {
    const profile = await this.staffRepository.findOne({ where: { user: { id: actor.userId } }, relations: { user: true } });
    if (!profile) throw new ConflictException('Account setup is incomplete. Contact an administrator.');
    return this.toResponse(profile);
  }

  async findOne(id: number): Promise<StaffResponse> {
    const profile = await this.staffRepository.findOne({ where: { id }, relations: { user: true } });
    if (!profile) throw new NotFoundException('Staff profile not found.');
    return this.toResponse(profile);
  }

  async update(id: number, dto: UpdateStaffDto, actor: AuthenticatedUser): Promise<StaffResponse> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const profile = await manager.getRepository(Staff).findOne({ where: { id }, relations: { user: true } });
        if (!profile) throw new NotFoundException('Staff profile not found.');
        const before = { email: profile.user.email, firstName: profile.firstName, lastName: profile.lastName, department: profile.department, designation: profile.designation };
        if (dto.email !== undefined) {
          const email = dto.email.trim().toLowerCase();
          if (await manager.getRepository(Student).findOne({ where: { email } })) {
            throw new ConflictException('Email is already registered.');
          }
          profile.user.email = email;
        }
        if (dto.firstName !== undefined) profile.firstName = dto.firstName.trim();
        if (dto.lastName !== undefined) profile.lastName = dto.lastName.trim();
        if (dto.phoneNumber !== undefined) profile.phoneNumber = dto.phoneNumber.trim();
        if (dto.department !== undefined) profile.department = dto.department.trim();
        if (dto.designation !== undefined) profile.designation = dto.designation.trim();
        await manager.getRepository(User).save(profile.user);
        await manager.getRepository(Staff).save(profile);
        await this.audit.record({ actorUserId: actor.userId, action: 'staff.profile_updated', targetType: 'staff', targetId: id, changes: { before, after: { email: profile.user.email, firstName: profile.firstName, lastName: profile.lastName, department: profile.department, designation: profile.designation } } }, manager);
        return this.toResponse(profile);
      });
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) throw error;
      if (this.isUniqueViolation(error)) throw new ConflictException('Email is already registered.');
      throw error;
    }
  }

  async setStatus(id: number, status: AccountStatus, reason: string | undefined, actor: AuthenticatedUser) {
    return this.dataSource.transaction(async (manager) => {
      const profile = await manager.getRepository(Staff).findOne({ where: { id }, relations: { user: true } });
      if (!profile) throw new NotFoundException('Staff profile not found.');
      const previous = profile.user.status;
      this.assertTransition(previous, status, reason);
      profile.user.status = status;
      await manager.getRepository(User).save(profile.user);
      await this.audit.record({ actorUserId: actor.userId, action: `staff.status_${status}`, targetType: 'staff', targetId: id, reason: reason?.trim() ?? null, changes: { before: { status: previous }, after: { status } } }, manager);
      return { id, userId: profile.user.id, status };
    });
  }

  private assertTransition(from: AccountStatus, to: AccountStatus, reason?: string) {
    const allowed: Record<AccountStatus, AccountStatus[]> = {
      [AccountStatus.PENDING]: [], [AccountStatus.ACTIVE]: [AccountStatus.INACTIVE, AccountStatus.SUSPENDED],
      [AccountStatus.INACTIVE]: [AccountStatus.ACTIVE], [AccountStatus.SUSPENDED]: [AccountStatus.ACTIVE, AccountStatus.INACTIVE],
    };
    if (!allowed[from].includes(to)) throw new BadRequestException(`Invalid account status transition: ${from} to ${to}.`);
    if (to === AccountStatus.SUSPENDED && !reason?.trim()) throw new BadRequestException('A reason is required when suspending an account.');
  }

  private toResponse(profile: Staff): StaffResponse {
    return {
      id: profile.id, userId: profile.user.id, email: profile.user.email,
      firstName: profile.firstName, lastName: profile.lastName,
      phoneNumber: profile.phoneNumber, department: profile.department, designation: profile.designation,
      status: profile.user.status,
      temporaryPasswordExpired: Boolean(profile.user.temporaryPasswordExpiresAt && profile.user.temporaryPasswordExpiresAt <= new Date()),
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
  }
}
