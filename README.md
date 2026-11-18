# EduTrack

EduTrack is a Phase 1 school management application. The frontend is a React, TypeScript, and Vite application; the NestJS API and its PostgreSQL setup are maintained in [`student-management-api/README.md`](./student-management-api/README.md).

The academic MVP adds role-scoped course management, course enrollment, attendance registers, assignment/exam gradebooks, academic CSV reports, and in-app notices. Super Admins can manage all courses; Staff can manage their assigned courses; Students can view only their enrolled courses and their own academic records.

## Frontend setup

Install dependencies from the repository root:

```powershell
npm install
Copy-Item .env.example .env.local
```

The example configures the frontend to send API requests through Vite's `/api` proxy to `http://localhost:3000`. Set `VITE_BACKEND_URL` in `.env.local` if the backend listens elsewhere. `VITE_API_BASE_URL` can change the API base path; it defaults to `/api`.

Start the backend using its setup instructions, then run the frontend:

```powershell
npm run dev
```

Vite serves the frontend at `http://localhost:5173` by default.

After confirming the PostgreSQL target and taking a recoverable backup, apply the backend migrations with `npm run migration:run` from `student-management-api`. This includes the academic MVP schema. Do not apply migrations to an existing or personal database without confirming it is the intended target.

## Account onboarding and SMTP

New Staff and Student accounts receive a randomly generated temporary password when created. The Super Admin or Staff member creating the account must share that password securely; it is displayed once and is not sent by email. It expires if it is not used within 24 hours. On the first successful login, the expiry is removed and the password remains valid until the user changes it in **Profile → Change password**.

To issue a password to an existing linked Staff/Student account still in `pending` status—or replace an unused temporary password that has expired—a Super Admin can open its profile and choose **Issue temporary password**. This activates pending accounts and revokes any outstanding invitation links. Unlinked legacy Student records cannot be issued credentials.

Invitation links remain available only for legacy pending accounts and historical invitation recovery. To test those links locally without SMTP, add these settings to `student-management-api/.env` and restart the API:

```dotenv
NODE_ENV=development
LOCAL_INVITATION_LINKS=true
```

When SMTP is not configured, the legacy invitation resend action can show a local setup link. Links expire after 48 hours and let whoever holds them set the account password. Issuing a temporary password instead revokes such links. Share credentials and links only with the intended user. This opt-in is accepted only with `NODE_ENV=development`; links are never included in invitation lists or production responses.

SMTP is only needed to deliver legacy invitation emails; it is not needed for new-account onboarding. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `EMAIL_FROM` in the backend `.env`, then restart the API. `INVITATION_BASE_URL` can override the default invitation acceptance URL. Never commit SMTP credentials or paste them into chat.

### Free SMTP option: Brevo

Brevo currently advertises a free plan; check its [pricing page](https://www.brevo.com/pricing/) for current limits. Its setup guide says to verify a sender/domain, then create an SMTP key in **Settings → SMTP & API → SMTP**. Use an SMTP key—not an API key—as the password.

Add these values to the backend `.env`, substituting your own verified sender and credentials:

```dotenv
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=your-brevo-smtp-login
SMTP_PASSWORD=your-brevo-smtp-key
EMAIL_FROM="EduTrack <verified-sender@your-domain.example>"
LOCAL_INVITATION_LINKS=false
```

Port `587` is Brevo’s recommended starting port. Restart the API after saving the file. The outbox retries queued legacy invitation emails; sender/domain verification and provider quotas still apply. See Brevo’s guides for [sending transactional mail through SMTP](https://help.brevo.com/hc/en-us/articles/7924908994450-Send-transactional-emails-using-Brevo-SMTP) and [creating SMTP keys](https://help.brevo.com/hc/en-us/articles/7959631848850-Create-and-manage-your-SMTP-keys).

## Quality checks

Run the frontend regression tests, linter, and production build from the repository root:

```powershell
npm test
npm run lint
npm run build
```

Use `npm run test:watch` while iterating on frontend tests.

## Environment and database safety

Keep local environment files and credentials out of version control. `.env.example` contains frontend settings only; configure backend credentials separately in the backend workspace. Before applying database migrations, confirm the target database and migration state and make a recoverable backup. Never run destructive database operations against personal or existing data without explicit approval.

## Deploy the MVP to Render

The root [`render.yaml`](./render.yaml) defines the React static site, NestJS API, and PostgreSQL database. Connect the Git repository in Render and create a Blueprint from that file; Render builds both services and supplies the API's database URL and generated JWT secret. Static-site environment variables are applied at build time, so changing the API URL requires a frontend rebuild. See Render's [Blueprint documentation](https://render.com/docs/blueprint-spec) and [environment variable guide](https://render.com/docs/configure-environment-variables).

1. Commit and push the project to a Git provider supported by Render. Ensure no `.env` files or secrets are tracked.
2. In the Render Dashboard, choose **New → Blueprint**, select the repository and branch, review the resources from `render.yaml`, and create them. Choose plans that fit the MVP's expected availability and budget; confirm the database's retention and backup terms before storing real school data.
3. Wait for the API and frontend deploys. The API runs the checked-in TypeORM migrations on startup and exposes `/health`, which checks database connectivity. Confirm the API health check passes before testing sign-in.
4. Open the frontend service URL and verify the browser can call the API. The Blueprint wires the frontend build to the API URL and configures API CORS for the frontend origin. If using a custom frontend domain, set `FRONTEND_ORIGIN` on `edutrack-api` to that exact `https://` origin (multiple origins may be comma-separated), then redeploy the API.
5. Provision the first Super Admin against the new database. The script reads `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD` from the API service environment; it does not prompt. Set those values temporarily in the Render Dashboard (use a unique password of at least 12 characters), deploy the environment change, then open the API service's Shell and run `npm run provision:super-admin` from its configured root directory. Remove the two temporary variables after successful provisioning and redeploy. Store the password securely. Do not use a development seed account in production.
6. Sign in as the Super Admin, create Staff accounts/courses, and test a separate Student account. Check API and frontend logs for failed requests. Keep SMTP unset until transactional email is configured; legacy invitation email delivery requires verified SMTP settings.
7. Before importing real records, verify backups and recovery procedures. Review access roles, account lifecycle, and password handling with test accounts. Restrict access to the Render dashboard and rotate the generated JWT secret only with a planned user reauthentication window.

The Blueprint uses the API start command to apply pending migrations before serving traffic, which suits the MVP's single API instance. For multi-instance or zero-downtime production deployments, move migrations into a dedicated pre-deploy/release step and review backward-compatible migration sequencing before scaling. Render's `/health` HTTP check probes PostgreSQL as well as the API ([Render health checks](https://render.com/docs/health-checks)).
