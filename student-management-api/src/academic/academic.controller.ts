import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { AccountType } from '../users/entities/user.entity.js';
import {
  CreateAssessmentDto,
  CreateCourseDto,
  EnrollStudentDto,
  SaveAttendanceDto,
  SaveGradesDto,
  UpdateCourseDto,
} from './dto/academic.dto.js';
import { AcademicService } from './academic.service.js';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class AcademicController {
  constructor(private readonly academic: AcademicService) {}

  @Get('courses')
  listCourses(@CurrentUser() actor: AuthenticatedUser) {
    return this.academic.listCourses(actor);
  }

  @Post('courses')
  @Roles(AccountType.STAFF, AccountType.SUPER_ADMIN)
  createCourse(@Body() dto: CreateCourseDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.academic.createCourse(dto, actor);
  }

  @Get('courses/:id')
  getCourse(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthenticatedUser) {
    return this.academic.getCourse(id, actor);
  }

  @Patch('courses/:id')
  @Roles(AccountType.STAFF, AccountType.SUPER_ADMIN)
  updateCourse(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCourseDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.academic.updateCourse(id, dto, actor);
  }

  @Delete('courses/:id')
  @Roles(AccountType.SUPER_ADMIN)
  deleteCourse(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthenticatedUser) {
    return this.academic.deleteCourse(id, actor);
  }

  @Post('courses/:id/enrollments')
  @Roles(AccountType.STAFF, AccountType.SUPER_ADMIN)
  enrollStudent(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EnrollStudentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.academic.enrollStudent(id, dto.studentId, actor);
  }

  @Patch('enrollments/:id/withdraw')
  @Roles(AccountType.STAFF, AccountType.SUPER_ADMIN)
  withdrawStudent(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthenticatedUser) {
    return this.academic.withdrawStudent(id, actor);
  }

  @Get('courses/:id/attendance')
  getAttendance(
    @Param('id', ParseIntPipe) id: number,
    @Query('date') date: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.academic.getAttendance(id, date, actor);
  }

  @Post('courses/:id/attendance')
  @Roles(AccountType.STAFF, AccountType.SUPER_ADMIN)
  saveAttendance(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveAttendanceDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.academic.saveAttendance(id, dto, actor);
  }

  @Get('courses/:id/assessments')
  getAssessments(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthenticatedUser) {
    return this.academic.getAssessments(id, actor);
  }

  @Post('courses/:id/assessments')
  @Roles(AccountType.STAFF, AccountType.SUPER_ADMIN)
  createAssessment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateAssessmentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.academic.createAssessment(id, dto, actor);
  }

  @Put('assessments/:id/grades')
  @Roles(AccountType.STAFF, AccountType.SUPER_ADMIN)
  saveGrades(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveGradesDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.academic.saveGrades(id, dto.grades, actor);
  }

  @Get('reports/academic')
  @Roles(AccountType.STAFF, AccountType.SUPER_ADMIN)
  getAcademicReport(@CurrentUser() actor: AuthenticatedUser) {
    return this.academic.getAcademicReport(actor);
  }

  @Get('reports/student')
  @Roles(AccountType.STUDENT)
  getStudentReport(@CurrentUser() actor: AuthenticatedUser) {
    return this.academic.getStudentReport(actor);
  }

  @Get('notifications')
  listNotifications(@CurrentUser() actor: AuthenticatedUser) {
    return this.academic.listNotifications(actor);
  }

  @Patch('notifications/:id/read')
  markNotificationRead(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AuthenticatedUser) {
    return this.academic.markNotificationRead(id, actor);
  }
}
