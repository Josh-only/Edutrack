import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { JwtAuthGuard } from '../auth/jwt-auth/jwt-auth.guard.js';
import { AuditModule } from '../audit/audit.module.js';
import { Staff } from '../staff/entities/staff.entity.js';
import { Student } from '../student/entities/student.entity/student.entity.js';
import { User } from '../users/entities/user.entity.js';
import {
  Assessment,
  AttendanceRecord,
  Course,
  Enrollment,
  Grade,
  InAppNotification,
} from './entities/academic.entity.js';
import { AcademicController } from './academic.controller.js';
import { AcademicService } from './academic.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Assessment,
      AttendanceRecord,
      Course,
      Enrollment,
      Grade,
      InAppNotification,
      Staff,
      Student,
      User,
    ]),
    AuthModule,
    AuditModule,
  ],
  controllers: [AcademicController],
  providers: [AcademicService, JwtAuthGuard],
})
export class AcademicModule {}
