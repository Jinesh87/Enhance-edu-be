# Edu Backend

Node.js + Express + TypeORM + PostgreSQL API. Deployed independently from the frontend.

## Stack

- Node.js 24.19.0 LTS
- Express 5.2.1
- TypeORM + PostgreSQL 18.4
- Redis (login lockout)
- Pino, Joi, JWT httpOnly cookies

## Roles (Enhance Edu UI)

| Role | Surface |
| --- | --- |
| `SUPER_ADMIN` | Admin console |
| `STAFF` | Staff / tutor app |
| `STUDENT` | Student app |
| `GUARDIAN` | Parent portal |

Statuses: `INVITED` → `ACTIVE` (via accept invitation) · `DEACTIVATED`

There is **no public self-signup**. A Super Admin is seeded on boot; other people are invited from People.

## Seed Super Admin

Set in `.env` (defaults shown):

```
SEED_SUPER_ADMIN_EMAIL=superadmin@example.com
SEED_SUPER_ADMIN_PASSWORD=Superadmin@123
SEED_SUPER_ADMIN_NAME=Super Admin
```

## Auth

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/auth/login` | Cookies set |
| `POST` | `/api/auth/accept-invitation` | `{ email, token, password, confirmPassword }` |
| `POST` | `/api/auth/refresh` | |
| `POST` | `/api/auth/logout` | |
| `GET` | `/api/auth/me` | |

## People (Super Admin only)

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/users` | List (optional `?status=&role=`) |
| `GET` | `/api/users/:id` | |
| `POST` | `/api/users` | Add person / invite (sends email if configured) |
| `PATCH` | `/api/users/:id` | Edit; email only while `INVITED` |
| `POST` | `/api/users/:id/resend-invitation` | New 48h token + email |
| `POST` | `/api/users/:id/deactivate` | Soft deactivate |

Invite body: `fullName`, `preferredName?`, `email`, `mobile?`, `role`, `employmentType?` (required for `STAFF` / `SUPER_ADMIN`).

Invite/resend responses include `invitationToken` for testing without email configured.

## Admin AI

Isolated from the student AI Coach. Read-only tools + draft text only. No shared conversation tables.

### Enable / disable

```
ADMIN_AI_ENABLED=true
ADMIN_AI_MAX_MESSAGE_CHARS=4000
ADMIN_AI_RATE_LIMIT_PER_MIN=20
ADMIN_AI_RATE_LIMIT_PER_DAY=200
```

Set `ADMIN_AI_ENABLED=false` to hard-disable. Uses the same OpenAI key as Coach (`institution_settings`).

### Roles

- API: `SUPER_ADMIN` and `OFFICE_STAFF` only (`/api/admin/ai/*`)
- Tool access for `OFFICE_STAFF` is gated by module permissions (`attendance`, `classes`, `enquiries`, `enrolments`, `syllabus`, `tasks`)
- `STAFF` / `STUDENT` / `GUARDIAN` cannot call Admin AI endpoints

### Retention

Conversations are soft-deleted (`deletedAt`). Audit events store metadata only (tools, scope, document IDs) — not raw student PII payloads.

### Allowed tools

Configured in `src/modules/admin/ai/tools.ts` (allowlist). Examples: attendance summary, low-attendance classes, timetable, homework, enquiry pipeline, pending enrolments, open tasks, syllabus document search, draft context.

### Known limitations

- No overdue-fee ledger, parent-feedback, or notice publish/send from chat
- Document mode searches indexed syllabus content only
- Responses are request/response (not streamed) in v1

### API

| Method | Path |
| --- | --- |
| `GET` | `/api/admin/ai/threads` |
| `POST` | `/api/admin/ai/threads` |
| `GET` | `/api/admin/ai/threads/:threadId` |
| `PATCH` | `/api/admin/ai/threads/:threadId` |
| `DELETE` | `/api/admin/ai/threads/:threadId` |
| `POST` | `/api/admin/ai/messages` |

## Email Configuration (Super Admin only)

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/email/config` | Get current email config (API key hidden) |
| `PUT` | `/api/email/config` | Update Resend configuration |

Email is configured via the Super Admin UI, not environment variables. When configured, invitation emails are sent automatically. The system gracefully handles email failures (invitation is still created, error is logged).

## Local development

```bash
cp .env.example .env
# Edit .env: set DB credentials, JWT secrets, FRONTEND_URL
npm install
npm run dev
```

Email configuration is done through the Super Admin UI at `/admin/email-settings`, not via `.env`.
