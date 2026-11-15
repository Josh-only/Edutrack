import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { AssessmentType, AttendanceStatus } from '../entities/academic.entity.js';

export class CreateCourseDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  @Matches(/\S/)
  code: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  @Matches(/\S/)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  teacherId: number;
}

export class UpdateCourseDto extends PartialType(CreateCourseDto) {}

export class EnrollStudentDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  studentId: number;
}

export class AttendanceEntryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  studentId: number;

  @IsEnum(AttendanceStatus)
  status: AttendanceStatus;
}

export class SaveAttendanceDto {
  @IsDateString({ strict: true })
  date: string;

  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => AttendanceEntryDto)
  records: AttendanceEntryDto[];
}

export class CreateAssessmentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  @Matches(/\S/)
  title: string;

  @IsEnum(AssessmentType)
  type: AssessmentType;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  maxScore: number;

  @IsDateString({ strict: true })
  date: string;
}

export class GradeEntryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  studentId: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  score: number;
}

export class SaveGradesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => GradeEntryDto)
  grades: GradeEntryDto[];
}
