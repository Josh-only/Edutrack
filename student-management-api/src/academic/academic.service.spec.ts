import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/current-user.decorator.js';
import { AccountStatus, AccountType } from '../users/entities/user.entity.js';
import { Staff } from '../staff/entities/staff.entity.js';
import { Student } from '../student/entities/student.entity/student.entity.js';
import {
  Assessment,
  AttendanceRecord,
  Course,
  Enrollment,
  Grade,
  InAppNotification,
} from './entities/academic.entity.js';
import { AcademicService } from './academic.service.js';

function createService(roster: Enrollment[] = []) {
  const query = {
    innerJoinAndSelect: vi.fn().mockReturnThis(),
    leftJoinAndSelect: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    addOrderBy: vi.fn().mockReturnThis(),
    getMany: vi.fn().mockResolvedValue(roster),
  };
  const dataSource = { transaction: vi.fn() };
  const audit = { record: vi.fn() };
  const courses = { findOne: vi.fn() };
  const enrollments = { createQueryBuilder: vi.fn().mockReturnValue(query) };
  const attendance = {};
  const assessments = { findOne: vi.fn() };
  const grades = {};
  const notifications = {};
  const staff = {};
  const students = {};
  const service = new AcademicService(
    dataSource as unknown as DataSource,
    audit as unknown as AuditService,
    courses as unknown as Repository<Course>,
    enrollments as unknown as Repository<Enrollment>,
    attendance as unknown as Repository<AttendanceRecord>,
    assessments as unknown as Repository<Assessment>,
    grades as unknown as Repository<Grade>,
    notifications as unknown as Repository<InAppNotification>,
    staff as unknown as Repository<Staff>,
    students as unknown as Repository<Student>,
  );
  return { service, dataSource, courses, enrollments, assessments };
}

const admin: AuthenticatedUser = {
  userId: 1,
  email: 'admin@example.test',
  accountType: AccountType.SUPER_ADMIN,
  status: AccountStatus.ACTIVE,
};

const course = { id: 8, teacher: { id: 4, user: { id: 3 } } } as Course;
const enrollment = { id: 10, student: { id: 12, user: { id: 20 } } } as Enrollment;

describe('AcademicService academic record validation', () => {
  it('requires an attendance value for each active enrollee before writing', async () => {
    const { service, dataSource, courses } = createService([enrollment]);
    vi.mocked(courses.findOne).mockResolvedValue(course);

    await expect(service.saveAttendance(8, {
      date: '2026-11-15',
      records: [],
    }, admin)).rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects a grade above the assessment maximum', async () => {
    const { service, enrollments, assessments, dataSource } = createService([enrollment]);
    vi.mocked(assessments.findOne).mockResolvedValue({
      id: 5,
      maxScore: 20,
      course,
    } as Assessment);

    await expect(service.saveGrades(5, [{ studentId: 12, score: 21 }], admin))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(enrollments.createQueryBuilder).toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('does not expose the student overview to staff accounts', async () => {
    const { service, courses } = createService();
    const staffActor: AuthenticatedUser = {
      ...admin,
      accountType: AccountType.STAFF,
    };

    await expect(service.getStudentReport(staffActor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(courses.findOne).not.toHaveBeenCalled();
  });
});
