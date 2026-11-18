import { DataSource } from 'typeorm';
import { Student } from './student/entities/student.entity/student.entity.js';
import { Staff } from './staff/entities/staff.entity.js';
import { User } from './users/entities/user.entity.js';
import { CreateStaffTable20261103000000 } from './migrations/20261103000000-create-staff-table.js';
import { BaselineUsersStudents20261102000000 } from './migrations/20261102000000-baseline-users-students.js';
import { AddSuperAdminAccountType20261104000000 } from './migrations/20261104000000-add-super-admin-account-type.js';
import { PhaseOneLifecycle20261104000001 } from './migrations/20261104000001-phase-one-lifecycle.js';
import { AcademicMvp20261115000000 } from './migrations/20261115000000-academic-mvp.js';
import { TemporaryAccountPasswords20261116000000 } from './migrations/20261116000000-temporary-account-passwords.js';

export default new DataSource({
  type: 'postgres',
  ...(process.env.DATABASE_URL
    ? { url: process.env.DATABASE_URL }
    : {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT ?? 5432),
        username: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
    }),
  entities: [Student, Staff, User],
  migrations: [BaselineUsersStudents20261102000000, CreateStaffTable20261103000000, AddSuperAdminAccountType20261104000000, PhaseOneLifecycle20261104000001, AcademicMvp20261115000000, TemporaryAccountPasswords20261116000000],
  synchronize: false,
  migrationsTransactionMode: 'each',
});
