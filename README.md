# HireMe – Step 1: Authentication & Users

This repository contains a minimal but production-grade implementation of authentication using Supabase Auth, JWT verification on the backend, a `users` table with RLS, and a modern React + Tailwind + Framer Motion frontend for login/signup and social auth.

Inline comments in code reference PRD/TDD sections as requested (see `docs/PRD.md` and `docs/TDD.md`).

## Stack
- Backend: Node.js + Express + TypeScript
- Auth: Supabase Auth (email/password + Google + Apple)
- DB: Supabase Postgres (RLS enabled)
- Frontend: React (Vite) + Tailwind CSS + Framer Motion

---

## Manual Configuration Guide

Follow these steps in order to configure everything from scratch.

### 1) Create a Supabase project
1. Go to `https://supabase.com` and create a project.
2. Copy your `Project URL` and `anon` and `service_role` API keys from Settings → API.

You will need these values shortly.

### 2) Enable providers: Google & Apple
- In Supabase Dashboard → Authentication → Providers:
  - Enable Google. Supply OAuth client ID/secret and add redirect URL(s):
    - `http://localhost:5173/auth/callback`
  - Enable Apple. Supply service config and redirect URL(s):
    - `http://localhost:5173/auth/callback`

Note: For production, add your live domain callback URLs.

### 3) Create Users table and RLS
Run the SQL in `docs/sql/users.sql` in the Supabase SQL editor.
- This creates `public.users` linked to `auth.users` via `id` with triggers to sync email and role.
- RLS is enabled with policies: users can `select`/`update` their own row; admins can `select` all.

### 4) Configure environment variables

Backend (create `backend/.env`):
```
PORT=4000
SUPABASE_URL=YOUR_SUPABASE_URL
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
ALLOWED_ORIGINS=http://localhost:5173
```

Frontend (create `frontend/.env`):
```
VITE_API_BASE_URL=http://localhost:4000
VITE_SUPABASE_URL=YOUR_SUPABASE_URL
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

### 5) Install dependencies
From the repo root:
```
cd backend && npm install
cd ../frontend && npm install
```

### 6) Run the servers
In two terminals:
```
# Terminal A
cd backend
npm run dev

# Terminal B
cd frontend
npm run dev
```
- Backend should be on `http://localhost:4000`
- Frontend on `http://localhost:5173`

### 7) Test the flows
- Email/password:
  - Sign up from the UI → confirm email → sign in
- Social login:
  - Use Google/Apple from the UI. Ensure the redirect URL matches the configured provider callback.
- Protected endpoints:
  - Use the JWT (shown after login) in `Authorization: Bearer <token>` to call `GET /auth/me`.

### 8) Roles and RBAC
- Default role is `user`.
- To promote a user to `admin`, call the admin endpoint with a valid admin JWT:
```
POST /auth/admin/set-role
{
  "userId": "<uuid>",
  "role": "admin"
}
```
This sets both `user_metadata.role` and `app_metadata.role` so that backend middleware and RLS policies recognize the role.

---

## Project Structure
```
backend/
  src/
    config/supabase.ts            # Supabase admin and client
    middleware/auth.ts            # JWT verification + role checks (TDD 8)
    routes/auth.ts                # Signup/login/social helpers + examples (TDD 4.1)
    server.ts                     # Express app (PRD 4 health)
  package.json
  tsconfig.json

frontend/
  src/
    components/
      LoginForm.tsx               # Email/password login
      SignupForm.tsx              # Email/password signup
      SocialButtons.tsx           # Google/Apple OAuth
    lib/supabase.ts               # Frontend Supabase client
    App.tsx
    main.tsx
    styles.css
  index.html
  package.json
  tailwind.config.js
  postcss.config.js
  vite.config.ts

docs/
  sql/users.sql                   # Users table + RLS (TDD 3.1, 8)
  PRD.md                          # Referenced by code comments
  TDD.md                          # Referenced by code comments
```

---

## API Reference (excerpt)
- POST `/auth/signup` → `{ email, password, metadata? }` → 201 user created (PRD 4, TDD 4.1)
- POST `/auth/login` → `{ email, password }` → `{ accessToken, refreshToken }` (TDD 4.1)
- GET `/auth/oauth/url?provider=google|apple&redirectTo=...` → helper response for client
- GET `/auth/me` (Bearer token) → returns normalized user and role (TDD 8)
- GET `/auth/admin/ping` (admin token) → `{ ok: true }`
- POST `/auth/admin/set-role` (admin token) → set `user_metadata.role` and `app_metadata.role`

JWT is verified against Supabase JWKS and normalized to include `role` from `user_metadata` or `app_metadata`.

---

## Notes on PRD/TDD References in Code
- PRD 4 Target Audience: Health endpoint and smooth onboarding hints in `server.ts` and `auth.ts`
- TDD 3.1 Users: Session and user handling in `/auth/login`, SQL schema/trigger
- TDD 4.1 Authentication Endpoints: Signup/Login/OAuth helpers in `routes/auth.ts`
- TDD 10.3 Integration Points: Stable base URL and CORS configuration in `server.ts`
- TDD 8 Security & Compliance: JWKS-based verification, RBAC middleware, RLS policies

---

## Production Considerations
- Add HTTPS, secure cookies if you choose cookie storage, rate limiting, and audit logging.
- Expand RLS for more granular actions.
- Configure provider production redirect URLs.
- Rotate keys and enforce strong password policies.


