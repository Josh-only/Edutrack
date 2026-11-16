import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import request from 'supertest';
import { AppModule } from './app.module.js';
import { User, AccountStatus, AccountType } from './users/entities/user.entity.js';
import { Student } from './student/entities/student.entity/student.entity.js';
import { Staff } from './staff/entities/staff.entity.js';
import { Invitation } from './invitations/entities/invitation.entity.js';
import { EmailOutbox } from './notifications/entities/email-outbox.entity.js';
import { InvitationsService } from './invitations/invitations.service.js';
import { decryptInvitationToken } from './invitations/invitation-crypto.js';

describe('EduTrack Phase 1 API against PostgreSQL', () => {
  let app: INestApplication;
  let users: Repository<User>;
  let students: Repository<Student>;
  let staffs: Repository<Staff>;
  let invitations: Repository<Invitation>;
  let outbox: Repository<EmailOutbox>;
  let adminId: number;
  let adminToken: string;
  let staffUserId: number | undefined;
  let staffToken: string;
  let firstStudentId: number;
  let firstStudentUserId: number;
  let firstStudentToken: string;
  let secondStudentUserId: number;
  let secondInvitationId: number;
  let secondInvitationToken: string;
  const suffix = randomUUID();
  const adminEmail = `phase1-admin-${suffix}@example.test`;
  const staffEmail = `phase1-staff-${suffix}@example.test`;
  const firstStudentEmail = `phase1-student-a-${suffix}@example.test`;
  const secondStudentEmail = `phase1-student-b-${suffix}@example.test`;
  const firstStudentNewPassword = 'fictional-updated-password';
  const ids = { staff: undefined as number | undefined, studentA: undefined as number | undefined, studentB: undefined as number | undefined };

  async function inviteToken(invitationId: number): Promise<string> {
    const invitation = await invitations.findOne({ where: { id: invitationId } });
    if (!invitation) throw new Error('Expected invitation test fixture.');
    return decryptInvitationToken(invitation.tokenCiphertext, process.env.JWT_SECRET ?? '');
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    users = app.get<Repository<User>>(getRepositoryToken(User));
    students = app.get<Repository<Student>>(getRepositoryToken(Student));
    staffs = app.get<Repository<Staff>>(getRepositoryToken(Staff));
    invitations = app.get<Repository<Invitation>>(getRepositoryToken(Invitation));
    outbox = app.get<Repository<EmailOutbox>>(getRepositoryToken(EmailOutbox));

    const admin = await users.save(users.create({ email: adminEmail, passwordHash: await bcrypt.hash('fictional-admin-password', 4), accountType: AccountType.SUPER_ADMIN, status: AccountStatus.ACTIVE }));
    adminId = admin.id;
    adminToken = await app.get(JwtService).signAsync({ sub: admin.id });
  });

  afterAll(async () => {
    if (app) {
      for (const id of [ids.studentA, ids.studentB]) if (id) await students.delete({ id });
      if (ids.staff) await staffs.delete({ id: ids.staff });
      const userIds = [staffUserId, firstStudentUserId, secondStudentUserId, adminId].filter((id): id is number => Boolean(id));
      if (userIds.length) {
        await invitations.createQueryBuilder().delete().where('"user_id" IN (:...userIds)', { userIds }).execute();
        for (const userId of userIds) await users.delete({ id: userId });
      }
      // Audits are append-only; the isolated test database is dropped by the test harness.
      await app.close();
    }
  });

  it('provisions temporary passwords, resets legacy pending accounts, and enforces ownership/status', async () => {
    const createdStaff = await request(app.getHttpServer()).post('/staff').set('Authorization', `Bearer ${adminToken}`).send({
      email: staffEmail, firstName: 'Test', lastName: 'Staff', phoneNumber: '+2348000000000', department: 'Testing', designation: 'Coordinator',
    }).expect(201);
    ids.staff = createdStaff.body.id;
    staffUserId = createdStaff.body.userId;
    expect(createdStaff.body).toMatchObject({ email: staffEmail, status: AccountStatus.ACTIVE });
    expect(createdStaff.body.credential.temporaryPassword).toEqual(expect.any(String));
    expect(new Date(createdStaff.body.credential.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(createdStaff.body).not.toHaveProperty('passwordHash');
    const staffLogin = await request(app.getHttpServer()).post('/users/login').send({ email: staffEmail, password: createdStaff.body.credential.temporaryPassword }).expect(201);
    staffToken = staffLogin.body.accessToken;
    const staffUser = await users.findOneByOrFail({ email: staffEmail });
    expect(staffUser.status).toBe(AccountStatus.ACTIVE);
    expect(staffUser.temporaryPasswordExpiresAt).toBeNull();

    await request(app.getHttpServer()).get('/staff').set('Authorization', `Bearer ${staffToken}`).expect(403);
    const firstStudent = await request(app.getHttpServer()).post('/students').set('Authorization', `Bearer ${staffToken}`).send({ email: firstStudentEmail, firstName: 'Test', lastName: 'Learner' }).expect(201);
    firstStudentId = firstStudent.body.id;
    firstStudentUserId = firstStudent.body.userId;
    ids.studentA = firstStudentId;
    expect(firstStudent.body).toMatchObject({ status: AccountStatus.ACTIVE, email: firstStudentEmail });
    expect(firstStudent.body.credential.temporaryPassword).toEqual(expect.any(String));
    const firstLogin = await request(app.getHttpServer()).post('/users/login').send({ email: firstStudentEmail, password: firstStudent.body.credential.temporaryPassword }).expect(201);
    firstStudentToken = firstLogin.body.accessToken;
    await request(app.getHttpServer()).patch('/users/me/password')
      .set('Authorization', `Bearer ${firstStudentToken}`)
      .send({ currentPassword: firstStudent.body.credential.temporaryPassword, newPassword: firstStudentNewPassword })
      .expect(200);
    await request(app.getHttpServer()).post('/users/login')
      .send({ email: firstStudentEmail, password: firstStudent.body.credential.temporaryPassword })
      .expect(401);
    await request(app.getHttpServer()).post('/users/login')
      .send({ email: firstStudentEmail, password: firstStudentNewPassword })
      .expect(201);

    const secondStudent = await request(app.getHttpServer()).post('/students').set('Authorization', `Bearer ${staffToken}`).send({ email: secondStudentEmail, firstName: 'Test', lastName: 'Learner' }).expect(201);
    ids.studentB = secondStudent.body.id;
    secondStudentUserId = secondStudent.body.userId;
    const pendingUser = await users.findOneByOrFail({ id: secondStudentUserId });
    pendingUser.status = AccountStatus.PENDING;
    pendingUser.passwordHash = await bcrypt.hash('fictional-legacy-password', 4);
    pendingUser.temporaryPasswordExpiresAt = null;
    await users.save(pendingUser);
    const legacyInvitation = await app.get(DataSource).transaction((manager) =>
      app.get(InvitationsService).createFor(manager, pendingUser, staffUser.id),
    );
    secondInvitationId = legacyInvitation.invitation.id;
    secondInvitationToken = await inviteToken(secondInvitationId);
    expect((await outbox.find()).filter((job) => Number(job.templateData.invitationId) === secondInvitationId)).toHaveLength(1);
    const issued = await request(app.getHttpServer()).post(`/users/${secondStudentUserId}/temporary-password`).set('Authorization', `Bearer ${adminToken}`).expect(201);
    expect(issued.body).toMatchObject({ email: secondStudentEmail, accountType: AccountType.STUDENT });
    expect(issued.body.temporaryPassword).toEqual(expect.any(String));
    const revokedInvitation = await invitations.findOneByOrFail({ id: secondInvitationId });
    expect(revokedInvitation.revokedAt).toBeTruthy();
    await request(app.getHttpServer()).post('/invitations/accept').send({ token: secondInvitationToken, password: 'fictional-legacy-password' }).expect(401);
    await request(app.getHttpServer()).post('/users/login').send({ email: secondStudentEmail, password: issued.body.temporaryPassword }).expect(201);

    await request(app.getHttpServer()).get('/students/me').set('Authorization', `Bearer ${firstStudentToken}`).expect(200).expect(({ body }) => expect(body.userId).toBe(firstStudentUserId));
    await request(app.getHttpServer()).get('/students').set('Authorization', `Bearer ${firstStudentToken}`).expect(403);
    await request(app.getHttpServer()).get(`/students/${secondStudent.body.id}`).set('Authorization', `Bearer ${firstStudentToken}`).expect(403);
    await request(app.getHttpServer()).patch(`/students/${firstStudentId}`).set('Authorization', `Bearer ${firstStudentToken}`).send({ firstName: 'Changed' }).expect(403);

    await request(app.getHttpServer()).patch(`/students/${firstStudentId}`).set('Authorization', `Bearer ${staffToken}`).send({ email: `renamed-${suffix}@example.test` }).expect(200);
    const [linkedProfile, linkedUser] = await Promise.all([
      students.findOneByOrFail({ id: firstStudentId }), users.findOneByOrFail({ id: firstStudentUserId }),
    ]);
    expect(linkedProfile.email).toBe(linkedUser.email);

    await request(app.getHttpServer()).patch(`/students/${firstStudentId}/status`).set('Authorization', `Bearer ${staffToken}`).send({ status: AccountStatus.SUSPENDED, reason: 'test only' }).expect(403);
    await request(app.getHttpServer()).patch(`/students/${firstStudentId}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: AccountStatus.SUSPENDED, reason: 'Test-only policy reason' }).expect(200);
    await request(app.getHttpServer()).get('/students/me').set('Authorization', `Bearer ${firstStudentToken}`).expect(401);
    await request(app.getHttpServer()).patch(`/students/${firstStudentId}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: AccountStatus.ACTIVE }).expect(200);
    await request(app.getHttpServer()).get('/audit-events').set('Authorization', `Bearer ${adminToken}`).expect(200);
  });
});
