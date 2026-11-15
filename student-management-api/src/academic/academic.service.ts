import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/current-user.decorator.js';
import { AccountType } from '../users/entities/user.entity.js';
import { Staff } from '../staff/entities/staff.entity.js';
import { Student } from '../student/entities/student.entity/student.entity.js';
import {
  Assessment,
  AttendanceRecord,
  AttendanceStatus,
  Course,
  Enrollment,
  EnrollmentStatus,
  Grade,
  InAppNotification,
} from './entities/academic.entity.js';
import {
  CreateAssessmentDto,
  CreateCourseDto,
  SaveAttendanceDto,
  UpdateCourseDto,
} from './dto/academic.dto.js';

@Injectable()
export class AcademicService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    @InjectRepository(Course) private readonly courses: Repository<Course>,
    @InjectRepository(Enrollment) private readonly enrollments: Repository<Enrollment>,
    @InjectRepository(AttendanceRecord) private readonly attendance: Repository<AttendanceRecord>,
    @InjectRepository(Assessment) private readonly assessments: Repository<Assessment>,
    @InjectRepository(Grade) private readonly grades: Repository<Grade>,
    @InjectRepository(InAppNotification) private readonly notifications: Repository<InAppNotification>,
    @InjectRepository(Staff) private readonly staff: Repository<Staff>,
    @InjectRepository(Student) private readonly students: Repository<Student>,
  ) {}

  async listCourses(actor: AuthenticatedUser) {
    const query = this.courses
      .createQueryBuilder('course')
      .leftJoinAndSelect('course.teacher', 'teacher')
      .addSelect((subQuery) => subQuery
        .select('COUNT(*)')
        .from(Enrollment, 'countEnrollment')
        .where('"countEnrollment"."course_id" = "course"."id"')
        .andWhere('"countEnrollment"."status" = :status'), 'activeEnrollmentCount')
      .setParameter('status', EnrollmentStatus.ACTIVE)
      .orderBy('course.title', 'ASC');

    if (actor.accountType === AccountType.STUDENT) {
      query.andWhere(`EXISTS (
        SELECT 1
        FROM "enrollments" student_enrollment
        INNER JOIN "students" enrolled_student ON enrolled_student."id" = student_enrollment."student_id"
        WHERE student_enrollment."course_id" = "course"."id"
          AND student_enrollment."status" = :status
          AND enrolled_student."user_id" = :userId
      )`, { userId: actor.userId });
    } else if (actor.accountType === AccountType.STAFF) {
      query.andWhere('teacher.user_id = :userId', { userId: actor.userId });
    }

    const { entities, raw } = await query.getRawAndEntities();
    return entities.map((course, index) => this.courseListItem(course, Number(raw[index]?.activeEnrollmentCount ?? 0)));
  }

  async createCourse(dto: CreateCourseDto, actor: AuthenticatedUser) {
    const teacher = await this.staff.findOne({
      where: { id: dto.teacherId },
      relations: { user: true },
    });
    if (!teacher) throw new NotFoundException('The assigned Staff profile was not found.');
    if (actor.accountType === AccountType.STAFF && teacher.user.id !== actor.userId) {
      throw new ForbiddenException('Staff can only create courses assigned to their own account.');
    }

    try {
      const course = await this.courses.save(this.courses.create({
        code: dto.code.trim().toUpperCase(),
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        teacher,
      }));
      await this.audit.record({
        actorUserId: actor.userId,
        action: 'course.created',
        targetType: 'course',
        targetId: course.id,
      });
      return this.courseListItem({ ...course, teacher, enrollments: [] });
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ConflictException('A course with this code already exists.');
      throw error;
    }
  }

  async getCourse(id: number, actor: AuthenticatedUser) {
    const course = await this.requireCourse(id);
    await this.assertMayViewCourse(course, actor);
    const enrollments = await this.activeEnrollments(id, actor.accountType === AccountType.STUDENT ? actor.userId : undefined);
    const assessments = await this.assessments.find({
      where: { course: { id } },
      relations: { grades: { enrollment: { student: { user: true } } } },
      order: { date: 'DESC', id: 'DESC' },
    });
    const student = actor.accountType === AccountType.STUDENT;
    return {
      ...this.courseListItem({ ...course, enrollments }),
      roster: enrollments.map((enrollment) => this.enrollmentResponse(enrollment)),
      assessments: assessments.map((assessment) => ({
        id: assessment.id,
        title: assessment.title,
        type: assessment.type,
        date: assessment.date,
        maxScore: Number(assessment.maxScore),
        grades: assessment.grades
          .filter((grade) => !student || grade.enrollment.student.user?.id === actor.userId)
          .map((grade) => ({
            studentId: grade.enrollment.student.id,
            studentName: `${grade.enrollment.student.firstName} ${grade.enrollment.student.lastName}`,
            score: Number(grade.score),
          })),
      })),
    };
  }

  async updateCourse(id: number, dto: UpdateCourseDto, actor: AuthenticatedUser) {
    const course = await this.requireCourse(id);
    this.assertMayManageCourse(course, actor);
    const before = { code: course.code, title: course.title, description: course.description, teacherId: course.teacher.id };
    if (dto.teacherId !== undefined) {
      const teacher = await this.staff.findOne({ where: { id: dto.teacherId }, relations: { user: true } });
      if (!teacher) throw new NotFoundException('The assigned Staff profile was not found.');
      if (actor.accountType === AccountType.STAFF && teacher.user.id !== actor.userId) {
        throw new ForbiddenException('Staff can only assign a course to their own account.');
      }
      course.teacher = teacher;
    }
    if (dto.code !== undefined) course.code = dto.code.trim().toUpperCase();
    if (dto.title !== undefined) course.title = dto.title.trim();
    if (dto.description !== undefined) course.description = dto.description.trim() || null;

    try {
      const saved = await this.courses.save(course);
      await this.audit.record({
        actorUserId: actor.userId,
        action: 'course.updated',
        targetType: 'course',
        targetId: id,
        changes: {
          before,
          after: { code: saved.code, title: saved.title, description: saved.description, teacherId: saved.teacher.id },
        },
      });
      return this.courseListItem({ ...saved, enrollments: [] });
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ConflictException('A course with this code already exists.');
      throw error;
    }
  }

  async deleteCourse(id: number, actor: AuthenticatedUser) {
    const course = await this.requireCourse(id);
    const [enrollmentCount, assessmentCount] = await Promise.all([
      this.enrollments.count({ where: { course: { id } } }),
      this.assessments.count({ where: { course: { id } } }),
    ]);
    if (enrollmentCount || assessmentCount) {
      throw new ConflictException('Courses with enrollment or assessment history cannot be deleted.');
    }
    await this.courses.remove(course);
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'course.deleted',
      targetType: 'course',
      targetId: id,
    });
    return { id, deleted: true };
  }

  async enrollStudent(courseId: number, studentId: number, actor: AuthenticatedUser) {
    const course = await this.requireCourse(courseId);
    this.assertMayManageCourse(course, actor);
    const student = await this.students.findOne({ where: { id: studentId } });
    if (!student) throw new NotFoundException('Student profile not found.');

    const existing = await this.enrollments.findOne({
      where: { course: { id: courseId }, student: { id: studentId } },
      relations: { course: true, student: true },
    });
    if (existing?.status === EnrollmentStatus.ACTIVE) {
      throw new ConflictException('This Student is already enrolled in the course.');
    }
    const enrollment = existing
      ? Object.assign(existing, { status: EnrollmentStatus.ACTIVE })
      : this.enrollments.create({ course, student, status: EnrollmentStatus.ACTIVE });
    const saved = await this.enrollments.save(enrollment);
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'enrollment.created',
      targetType: 'enrollment',
      targetId: saved.id,
    });
    return { id: saved.id, courseId, studentId, status: saved.status };
  }

  async withdrawStudent(enrollmentId: number, actor: AuthenticatedUser) {
    const enrollment = await this.enrollments.findOne({
      where: { id: enrollmentId },
      relations: { course: { teacher: { user: true } } },
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found.');
    this.assertMayManageCourse(enrollment.course, actor);
    if (enrollment.status === EnrollmentStatus.DROPPED) {
      throw new ConflictException('This enrollment has already been withdrawn.');
    }
    enrollment.status = EnrollmentStatus.DROPPED;
    await this.enrollments.save(enrollment);
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'enrollment.withdrawn',
      targetType: 'enrollment',
      targetId: enrollmentId,
    });
    return { id: enrollmentId, status: enrollment.status };
  }

  async getAttendance(courseId: number, date: string | undefined, actor: AuthenticatedUser) {
    if (date && !this.isCalendarDate(date)) throw new BadRequestException('Attendance date must use YYYY-MM-DD format.');
    const course = await this.requireCourse(courseId);
    await this.assertMayViewCourse(course, actor);
    const query = this.attendance
      .createQueryBuilder('record')
      .innerJoinAndSelect('record.enrollment', 'enrollment')
      .innerJoinAndSelect('enrollment.student', 'student')
      .where('enrollment.course_id = :courseId', { courseId })
      .andWhere('enrollment.status = :status', { status: EnrollmentStatus.ACTIVE })
      .orderBy('record.date', 'DESC')
      .addOrderBy('student.lastName', 'ASC');
    if (date) query.andWhere('record.date = :date', { date });
    if (actor.accountType === AccountType.STUDENT) {
      query.andWhere('student.user_id = :userId', { userId: actor.userId });
    }
    const records = await query.getMany();
    return records.map((record) => ({
      id: record.id,
      enrollmentId: record.enrollment.id,
      studentId: record.enrollment.student.id,
      studentName: `${record.enrollment.student.firstName} ${record.enrollment.student.lastName}`,
      date: record.date,
      status: record.status,
    }));
  }

  async saveAttendance(courseId: number, dto: SaveAttendanceDto, actor: AuthenticatedUser) {
    const course = await this.requireCourse(courseId);
    this.assertMayManageCourse(course, actor);
    const roster = await this.activeEnrollments(courseId);
    if (roster.length === 0) throw new BadRequestException('Enroll Students before taking attendance.');
    const submitted = new Map<number, AttendanceStatus>();
    for (const record of dto.records) {
      if (submitted.has(record.studentId)) throw new BadRequestException('Attendance contains a duplicate Student.');
      submitted.set(record.studentId, record.status);
    }
    const rosterByStudentId = new Map(roster.map((enrollment) => [enrollment.student.id, enrollment]));
    if (submitted.size !== rosterByStudentId.size || [...submitted.keys()].some((id) => !rosterByStudentId.has(id))) {
      throw new BadRequestException('Submit exactly one attendance status for every active Student in the course.');
    }

    let newlyAbsentCount = 0;
    await this.dataSource.transaction(async (manager) => {
      const attendance = manager.getRepository(AttendanceRecord);
      const notifications = manager.getRepository(InAppNotification);
      for (const [studentId, status] of submitted) {
        const enrollment = rosterByStudentId.get(studentId);
        if (!enrollment) continue;
        const existing = await attendance.findOne({
          where: { enrollment: { id: enrollment.id }, date: dto.date.slice(0, 10) },
        });
        const wasAbsent = existing?.status === AttendanceStatus.ABSENT;
        const record = existing ?? attendance.create({ enrollment, date: dto.date.slice(0, 10) });
        record.status = status;
        await attendance.save(record);
        if (status === AttendanceStatus.ABSENT && !wasAbsent && enrollment.student.user) {
          await notifications.save(notifications.create({
            user: enrollment.student.user,
            message: `You were marked absent from ${course.code} on ${dto.date.slice(0, 10)}.`,
          }));
          newlyAbsentCount++;
        }
      }
      await this.audit.record({
        actorUserId: actor.userId,
        action: 'attendance.recorded',
        targetType: 'course',
        targetId: courseId,
        changes: { date: dto.date.slice(0, 10), studentCount: submitted.size },
      }, manager);
    });
    return { courseId, date: dto.date.slice(0, 10), recorded: submitted.size, notified: newlyAbsentCount };
  }

  async getAssessments(courseId: number, actor: AuthenticatedUser) {
    const course = await this.requireCourse(courseId);
    await this.assertMayViewCourse(course, actor);
    const student = actor.accountType === AccountType.STUDENT;
    const assessments = await this.assessments.find({
      where: { course: { id: courseId } },
      relations: { grades: { enrollment: { student: { user: true } } } },
      order: { date: 'DESC', id: 'DESC' },
    });
    return assessments.map((assessment) => ({
      id: assessment.id,
      title: assessment.title,
      type: assessment.type,
      date: assessment.date,
      maxScore: Number(assessment.maxScore),
      grades: assessment.grades
        .filter((grade) => !student || grade.enrollment.student.user?.id === actor.userId)
        .map((grade) => ({
          studentId: grade.enrollment.student.id,
          studentName: `${grade.enrollment.student.firstName} ${grade.enrollment.student.lastName}`,
          score: Number(grade.score),
        })),
    }));
  }

  async createAssessment(courseId: number, dto: CreateAssessmentDto, actor: AuthenticatedUser) {
    const course = await this.requireCourse(courseId);
    this.assertMayManageCourse(course, actor);
    const assessment = await this.assessments.save(this.assessments.create({
      course,
      title: dto.title.trim(),
      type: dto.type,
      maxScore: dto.maxScore,
      date: dto.date.slice(0, 10),
    }));
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'assessment.created',
      targetType: 'assessment',
      targetId: assessment.id,
    });
    return {
      id: assessment.id,
      courseId,
      title: assessment.title,
      type: assessment.type,
      maxScore: Number(assessment.maxScore),
      date: assessment.date,
      grades: [],
    };
  }

  async saveGrades(assessmentId: number, grades: Array<{ studentId: number; score: number }>, actor: AuthenticatedUser) {
    const assessment = await this.assessments.findOne({
      where: { id: assessmentId },
      relations: { course: { teacher: { user: true } } },
    });
    if (!assessment) throw new NotFoundException('Assessment not found.');
    this.assertMayManageCourse(assessment.course, actor);
    const roster = await this.activeEnrollments(assessment.course.id);
    const rosterByStudentId = new Map(roster.map((enrollment) => [enrollment.student.id, enrollment]));
    const seen = new Set<number>();
    for (const entry of grades) {
      if (seen.has(entry.studentId)) throw new BadRequestException('Grades contain a duplicate Student.');
      if (!rosterByStudentId.has(entry.studentId)) throw new BadRequestException('Grades can only be recorded for active Students in this course.');
      if (entry.score > Number(assessment.maxScore)) {
        throw new BadRequestException(`A score cannot exceed the maximum of ${assessment.maxScore}.`);
      }
      seen.add(entry.studentId);
    }

    let updated = 0;
    await this.dataSource.transaction(async (manager) => {
      const gradeRepository = manager.getRepository(Grade);
      const notificationRepository = manager.getRepository(InAppNotification);
      for (const entry of grades) {
        const enrollment = rosterByStudentId.get(entry.studentId);
        if (!enrollment) continue;
        const existing = await gradeRepository.findOne({
          where: { assessment: { id: assessmentId }, enrollment: { id: enrollment.id } },
        });
        if (existing?.score === entry.score) continue;
        const grade = existing ?? gradeRepository.create({ assessment, enrollment });
        grade.score = entry.score;
        await gradeRepository.save(grade);
        updated++;
        if (enrollment.student.user) {
          await notificationRepository.save(notificationRepository.create({
            user: enrollment.student.user,
            message: `A grade was posted for ${assessment.title} in ${assessment.course.code}.`,
          }));
        }
      }
      await this.audit.record({
        actorUserId: actor.userId,
        action: 'grades.recorded',
        targetType: 'assessment',
        targetId: assessmentId,
        changes: { submittedCount: grades.length, updatedCount: updated },
      }, manager);
    });
    return { assessmentId, updated };
  }

  async getAcademicReport(actor: AuthenticatedUser) {
    const courses = await this.listCourses(actor);
    const rows = await Promise.all(courses.map(async (course) => {
      const [attendance, grades, enrollmentCount] = await Promise.all([
        this.attendance
          .createQueryBuilder('record')
          .innerJoin('record.enrollment', 'enrollment')
          .where('enrollment.course_id = :courseId', { courseId: course.id })
          .andWhere('enrollment.status = :status', { status: EnrollmentStatus.ACTIVE })
          .select('COUNT(*)', 'total')
          .addSelect(`COUNT(*) FILTER (WHERE record.status = :present)`, 'present')
          .setParameter('present', AttendanceStatus.PRESENT)
          .getRawOne<{ total: string; present: string }>(),
        this.grades
          .createQueryBuilder('grade')
          .innerJoin('grade.assessment', 'assessment')
          .innerJoin('grade.enrollment', 'enrollment')
          .where('assessment.course_id = :courseId', { courseId: course.id })
          .andWhere('enrollment.status = :status', { status: EnrollmentStatus.ACTIVE })
          .select('AVG(grade.score / assessment.max_score * 100)', 'average')
          .getRawOne<{ average: string | null }>(),
        this.enrollments.count({ where: { course: { id: course.id }, status: EnrollmentStatus.ACTIVE } }),
      ]);
      const totalAttendance = Number(attendance?.total ?? 0);
      const present = Number(attendance?.present ?? 0);
      const gradeAverage = grades?.average === null || grades?.average === undefined
        ? null
        : Math.round(Number(grades.average) * 100) / 100;
      return {
        courseId: course.id,
        code: course.code,
        title: course.title,
        teacherName: course.teacher.name,
        enrollmentCount,
        attendanceRate: totalAttendance === 0 ? null : Math.round((present / totalAttendance) * 10000) / 100,
        gradeAverage,
      };
    }));
    return { courses: rows };
  }

  async getStudentReport(actor: AuthenticatedUser) {
    if (actor.accountType !== AccountType.STUDENT) {
      throw new ForbiddenException('This report is available to Student accounts only.');
    }
    const [courses, attendance, grades] = await Promise.all([
      this.listCourses(actor),
      this.attendance
        .createQueryBuilder('record')
        .innerJoin('record.enrollment', 'enrollment')
        .innerJoin('enrollment.student', 'student')
        .where('student.user_id = :userId', { userId: actor.userId })
        .andWhere('enrollment.status = :status', { status: EnrollmentStatus.ACTIVE })
        .select('COUNT(*)', 'total')
        .addSelect('COUNT(*) FILTER (WHERE record.status = :present)', 'present')
        .setParameter('present', AttendanceStatus.PRESENT)
        .getRawOne<{ total: string; present: string }>(),
      this.grades
        .createQueryBuilder('grade')
        .innerJoin('grade.assessment', 'assessment')
        .innerJoin('grade.enrollment', 'enrollment')
        .innerJoin('enrollment.student', 'student')
        .where('student.user_id = :userId', { userId: actor.userId })
        .andWhere('enrollment.status = :status', { status: EnrollmentStatus.ACTIVE })
        .select('AVG(grade.score / assessment.max_score * 100)', 'average')
        .getRawOne<{ average: string | null }>(),
    ]);
    const attendanceTotal = Number(attendance?.total ?? 0);
    const presentCount = Number(attendance?.present ?? 0);
    return {
      courseCount: courses.length,
      attendanceRate: attendanceTotal === 0 ? null : Math.round((presentCount / attendanceTotal) * 10000) / 100,
      gradeAverage: grades?.average === null || grades?.average === undefined
        ? null
        : Math.round(Number(grades.average) * 100) / 100,
      courses,
    };
  }

  async listNotifications(actor: AuthenticatedUser) {
    const notifications = await this.notifications.find({
      where: { user: { id: actor.userId } },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 50,
    });
    return notifications.map((notification) => ({
      id: notification.id,
      message: notification.message,
      readAt: notification.readAt?.toISOString() ?? null,
      createdAt: notification.createdAt.toISOString(),
    }));
  }

  async markNotificationRead(id: number, actor: AuthenticatedUser) {
    const notification = await this.notifications.findOne({ where: { id, user: { id: actor.userId } } });
    if (!notification) throw new NotFoundException('Notification not found.');
    if (!notification.readAt) {
      notification.readAt = new Date();
      await this.notifications.save(notification);
    }
    return { id, readAt: notification.readAt.toISOString() };
  }

  private async requireCourse(id: number) {
    const course = await this.courses.findOne({
      where: { id },
      relations: { teacher: { user: true } },
    });
    if (!course) throw new NotFoundException('Course not found.');
    return course;
  }

  private async assertMayViewCourse(course: Course, actor: AuthenticatedUser) {
    if (actor.accountType === AccountType.SUPER_ADMIN) return;
    if (actor.accountType === AccountType.STAFF) {
      this.assertMayManageCourse(course, actor);
      return;
    }
    const enrollment = await this.enrollments.findOne({
      where: {
        course: { id: course.id },
        student: { user: { id: actor.userId } },
        status: EnrollmentStatus.ACTIVE,
      },
    });
    if (!enrollment) throw new ForbiddenException('You can only access courses you are enrolled in.');
  }

  private assertMayManageCourse(course: Course, actor: AuthenticatedUser) {
    if (actor.accountType === AccountType.SUPER_ADMIN) return;
    if (actor.accountType !== AccountType.STAFF || course.teacher.user?.id !== actor.userId) {
      throw new ForbiddenException('You can only manage courses assigned to your account.');
    }
  }

  private async activeEnrollments(courseId: number, studentUserId?: number) {
    const query = this.enrollments
      .createQueryBuilder('enrollment')
      .innerJoinAndSelect('enrollment.student', 'student')
      .leftJoinAndSelect('student.user', 'studentUser')
      .where('enrollment.course_id = :courseId', { courseId })
      .andWhere('enrollment.status = :status', { status: EnrollmentStatus.ACTIVE })
      .orderBy('student.lastName', 'ASC')
      .addOrderBy('student.firstName', 'ASC');
    if (studentUserId !== undefined) query.andWhere('student.user_id = :studentUserId', { studentUserId });
    return query.getMany();
  }

  private courseListItem(course: Course & { enrollments?: Enrollment[] }, enrollmentCount?: number) {
    const teacher = course.teacher;
    return {
      id: course.id,
      code: course.code,
      title: course.title,
      description: course.description,
      teacher: {
        id: teacher.id,
        name: `${teacher.firstName} ${teacher.lastName}`,
      },
      enrollmentCount: enrollmentCount ?? course.enrollments?.length ?? 0,
    };
  }

  private enrollmentResponse(enrollment: Enrollment) {
    return {
      id: enrollment.id,
      studentId: enrollment.student.id,
      firstName: enrollment.student.firstName,
      lastName: enrollment.student.lastName,
      email: enrollment.student.email,
      status: enrollment.status,
    };
  }

  private isCalendarDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  private isUniqueViolation(error: unknown) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
  }
}
