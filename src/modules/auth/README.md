# Authentication Module

This document explains the current authentication design in a concise, implementation-first format.

## Endpoint Summary

Base path: `/api/auth`

Active endpoints:

- `POST /api/auth/login/teacher`
- `POST /api/auth/login/school`
- `POST /api/auth/login/admin`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/forgot-password/request-otp`
- `POST /api/auth/forgot-password/verify-otp`

## Module Structure

- `auth.routes.js`
  - Registers auth routes.
  - Applies `authRateLimiter` to write/auth endpoints.
  - Protects `/me` with `authenticate` middleware.

- `auth.controller.js`
  - Validates request payload.
  - Calls service methods.
  - Returns standardized success/error responses.

- `auth.service.js`
  - Validates credentials from DB-backed `users` table.
  - Enforces portal-role mapping.
  - Issues JWT access and refresh tokens.
  - Persists refresh tokens in `auth_refresh_tokens`.
  - Handles forgot-password OTP generation and password reset.

## Authentication Flow

1. Client sends `email` and `password` to one of:
   - `/api/auth/login/teacher`
   - `/api/auth/login/school`
   - `/api/auth/login/admin`
2. Controller validates required fields.
3. Service verifies email and bcrypt password hash.
4. Service validates selected portal route against user role.
5. On success, API returns `user`, `accessToken`, and `refreshToken`.
6. Client uses `Authorization: Bearer <accessToken>` for protected endpoints.

## Portal-to-Role Mapping

- `/api/auth/login/teacher` -> `faculty`
- `/api/auth/login/school` -> `school`
- `/api/auth/login/admin` -> `super_admin`

If credentials are valid but route-role mapping fails, API returns `401 Invalid credentials`.

## Demo Accounts (DB Seeded)

Seeded only when `SEED_DEMO_USERS=true` is set — local development only, never
on a server reachable from the internet. On any database where these accounts
already exist, change their passwords or deactivate them.

- Teacher
  - Email: `faculty@gbu.ac.in`
  - Password: `Faculty@123`
  - Role: `faculty`

- School
  - Email: `school@gbu.ac.in`
  - Password: `School@123`
  - Role: `school`

- Admin
  - Email: `admin@gbu.ac.in`
  - Password: `Admin@123`
  - Role: `super_admin`

## Token Model

- Access token:
  - Signed using `JWT_ACCESS_SECRET`.
  - Includes `sub`, `email`, `role`, `name`.
  - Used for authorization on protected APIs.

- Refresh token:
  - Signed using `JWT_REFRESH_SECRET`.
  - Stored as SHA-256 hash in `auth_refresh_tokens` table.
  - Used only for issuing a new access token via `/api/auth/refresh`.

## Forgot Password (Email OTP)

1. Client calls `POST /api/auth/forgot-password/request-otp` with email.
2. Backend generates 6-digit OTP, stores SHA-256 hash in `password_reset_otps`.
3. OTP is sent to registered email via SMTP.
4. Client calls `POST /api/auth/forgot-password/verify-otp` with email, OTP, and new password.
5. Backend verifies OTP and resets password hash.
6. Existing refresh tokens for that user are revoked.

## Request/Response Examples

Teacher login request:

```json
{
  "email": "faculty@gbu.ac.in",
  "password": "Faculty@123"
}
```

Success response shape:

```json
{
  "success": true,
  "message": "Teacher login successful",
  "data": {
    "user": {
      "id": 3,
      "name": "Faculty User",
      "email": "faculty@gbu.ac.in",
      "role": "faculty"
    },
    "accessToken": "<jwt>",
    "refreshToken": "<jwt>"
  }
}
```

Refresh request:

```json
{
  "refreshToken": "<jwt>"
}
```

Logout request:

```json
{
  "refreshToken": "<jwt>"
}
```

## Quick Validation Commands

```bash
curl -X POST http://localhost:3000/api/auth/login/teacher \
  -H "Content-Type: application/json" \
  -d '{"email":"faculty@gbu.ac.in","password":"Faculty@123"}'

curl -X POST http://localhost:3000/api/auth/login/school \
  -H "Content-Type: application/json" \
  -d '{"email":"school@gbu.ac.in","password":"School@123"}'

curl -X POST http://localhost:3000/api/auth/login/admin \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@gbu.ac.in","password":"Admin@123"}'

curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer <accessToken>"
```

## Security Notes

- Password policy is enforced during reset (length + complexity checks).
- OTP attempts are capped and OTP expires automatically.
- Role-based route authorization remains enforced by middleware.
