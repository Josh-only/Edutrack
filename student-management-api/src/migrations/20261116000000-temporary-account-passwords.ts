import { MigrationInterface, QueryRunner } from 'typeorm';

export class TemporaryAccountPasswords20261116000000 implements MigrationInterface {
  name = 'TemporaryAccountPasswords20261116000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "temporaryPasswordExpiresAt" TIMESTAMPTZ`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "temporaryPasswordExpiresAt"`);
  }
}
