import { MigrationInterface, QueryRunner } from 'typeorm';

export class AcademicMvp20261115000000 implements MigrationInterface {
  name = 'AcademicMvp20261115000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "enrollments_status_enum" AS ENUM ('active', 'dropped')`);
    await queryRunner.query(`CREATE TYPE "attendance_records_status_enum" AS ENUM ('present', 'absent')`);
    await queryRunner.query(`CREATE TYPE "assessments_type_enum" AS ENUM ('assignment', 'exam')`);

    await queryRunner.query(`
      CREATE TABLE "courses" (
        "id" SERIAL NOT NULL,
        "code" VARCHAR(40) NOT NULL,
        "title" VARCHAR(160) NOT NULL,
        "description" TEXT,
        "teacher_id" INTEGER NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_courses_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_courses_code" UNIQUE ("code"),
        CONSTRAINT "FK_courses_teacher_id" FOREIGN KEY ("teacher_id")
          REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "enrollments" (
        "id" SERIAL NOT NULL,
        "course_id" INTEGER NOT NULL,
        "student_id" INTEGER NOT NULL,
        "status" "enrollments_status_enum" NOT NULL DEFAULT 'active',
        "enrolled_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_enrollments_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_enrollments_course_student" UNIQUE ("course_id", "student_id"),
        CONSTRAINT "FK_enrollments_course_id" FOREIGN KEY ("course_id")
          REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_enrollments_student_id" FOREIGN KEY ("student_id")
          REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_enrollments_course_status" ON "enrollments" ("course_id", "status")`);
    await queryRunner.query(`
      CREATE TABLE "attendance_records" (
        "id" SERIAL NOT NULL,
        "enrollment_id" INTEGER NOT NULL,
        "date" DATE NOT NULL,
        "status" "attendance_records_status_enum" NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_attendance_records_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_attendance_enrollment_date" UNIQUE ("enrollment_id", "date"),
        CONSTRAINT "FK_attendance_enrollment_id" FOREIGN KEY ("enrollment_id")
          REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "assessments" (
        "id" SERIAL NOT NULL,
        "course_id" INTEGER NOT NULL,
        "title" VARCHAR(160) NOT NULL,
        "type" "assessments_type_enum" NOT NULL,
        "max_score" DOUBLE PRECISION NOT NULL,
        "date" DATE NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_assessments_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_assessments_course_id" FOREIGN KEY ("course_id")
          REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "CHK_assessments_max_score" CHECK ("max_score" > 0)
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_assessments_course_date" ON "assessments" ("course_id", "date")`);
    await queryRunner.query(`
      CREATE TABLE "grades" (
        "id" SERIAL NOT NULL,
        "assessment_id" INTEGER NOT NULL,
        "enrollment_id" INTEGER NOT NULL,
        "score" DOUBLE PRECISION NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_grades_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_grades_assessment_enrollment" UNIQUE ("assessment_id", "enrollment_id"),
        CONSTRAINT "FK_grades_assessment_id" FOREIGN KEY ("assessment_id")
          REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "FK_grades_enrollment_id" FOREIGN KEY ("enrollment_id")
          REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "CHK_grades_score" CHECK ("score" >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "in_app_notifications" (
        "id" SERIAL NOT NULL,
        "user_id" INTEGER NOT NULL,
        "message" VARCHAR(300) NOT NULL,
        "read_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_in_app_notifications_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_in_app_notifications_user_id" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_in_app_notifications_user_created" ON "in_app_notifications" ("user_id", "created_at")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "in_app_notifications"`);
    await queryRunner.query(`DROP TABLE "grades"`);
    await queryRunner.query(`DROP TABLE "assessments"`);
    await queryRunner.query(`DROP TABLE "attendance_records"`);
    await queryRunner.query(`DROP TABLE "enrollments"`);
    await queryRunner.query(`DROP TABLE "courses"`);
    await queryRunner.query(`DROP TYPE "assessments_type_enum"`);
    await queryRunner.query(`DROP TYPE "attendance_records_status_enum"`);
    await queryRunner.query(`DROP TYPE "enrollments_status_enum"`);
  }
}
