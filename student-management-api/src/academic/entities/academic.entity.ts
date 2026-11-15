import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Staff } from '../../staff/entities/staff.entity.js';
import { Student } from '../../student/entities/student.entity/student.entity.js';
import { User } from '../../users/entities/user.entity.js';

export enum EnrollmentStatus {
  ACTIVE = 'active',
  DROPPED = 'dropped',
}

export enum AttendanceStatus {
  PRESENT = 'present',
  ABSENT = 'absent',
}

export enum AssessmentType {
  ASSIGNMENT = 'assignment',
  EXAM = 'exam',
}

@Entity('courses')
export class Course {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 40 })
  code: string;

  @Column({ length: 160 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ManyToOne(() => Staff, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'teacher_id' })
  teacher: Staff;

  @OneToMany(() => Enrollment, (enrollment) => enrollment.course)
  enrollments: Enrollment[];

  @OneToMany(() => Assessment, (assessment) => assessment.course)
  assessments: Assessment[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}

@Index('UQ_enrollments_course_student', ['course', 'student'], { unique: true })
@Entity('enrollments')
export class Enrollment {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Course, (course) => course.enrollments, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'course_id' })
  course: Course;

  @ManyToOne(() => Student, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'enum', enum: EnrollmentStatus, default: EnrollmentStatus.ACTIVE })
  status: EnrollmentStatus;

  @CreateDateColumn({ type: 'timestamptz', name: 'enrolled_at' })
  enrolledAt: Date;
}

@Index('UQ_attendance_enrollment_date', ['enrollment', 'date'], { unique: true })
@Entity('attendance_records')
export class AttendanceRecord {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Enrollment, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'enrollment_id' })
  enrollment: Enrollment;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'enum', enum: AttendanceStatus })
  status: AttendanceStatus;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}

@Entity('assessments')
export class Assessment {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Course, (course) => course.assessments, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'course_id' })
  course: Course;

  @Column({ length: 160 })
  title: string;

  @Column({ type: 'enum', enum: AssessmentType })
  type: AssessmentType;

  @Column({ name: 'max_score', type: 'double precision' })
  maxScore: number;

  @Column({ type: 'date' })
  date: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => Grade, (grade) => grade.assessment)
  grades: Grade[];
}

@Index('UQ_grades_assessment_enrollment', ['assessment', 'enrollment'], { unique: true })
@Entity('grades')
export class Grade {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Assessment, (assessment) => assessment.grades, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'assessment_id' })
  assessment: Assessment;

  @ManyToOne(() => Enrollment, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'enrollment_id' })
  enrollment: Enrollment;

  @Column({ type: 'double precision' })
  score: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}

@Entity('in_app_notifications')
export class InAppNotification {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ length: 300 })
  message: string;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
