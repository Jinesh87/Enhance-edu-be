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
| `POST` | `/api/users` | Add person / invite |
| `PATCH` | `/api/users/:id` | Edit; email only while `INVITED` |
| `POST` | `/api/users/:id/resend-invitation` | New 48h token (email later) |
| `POST` | `/api/users/:id/deactivate` | Soft deactivate |

Invite body: `fullName`, `preferredName?`, `email`, `mobile?`, `role`, `employmentType?` (required for `STAFF` / `SUPER_ADMIN`).

Until email is wired, invite/resend responses include `invitationToken` for accepting.

## Local development

```bash
cp .env.example .env
npm install
npm run dev
```
