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
