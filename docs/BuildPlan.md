# HireMe — Modular Build Plan (Cursor-style)

**Purpose:** A step-by-step, module-by-module plan ("cursor") to implement the HireMe MVP from the PRD/TDD you provided. This plan intentionally limits scope per module so developers are not overloaded; each module is self-contained with clear inputs/outputs, tests, and integration points.

---

## How to use this plan

1. Work *one module at a time* — finish its acceptance criteria and automated tests before moving to the next module.
2. Each module has: **Goal**, **Inputs / Outputs**, **Data model slices**, **API contracts**, **Implementation tasks**, **Tests / TDD checks**, and **Acceptance criteria**.
3. Keep PRs small (1 feature per PR). Use feature flags for incomplete capabilities.
4. Use the AI Abstraction Layer stubs early so you can swap real LLM keys later with minimal changes.

---

## Module index (order to implement)

1. **Auth & Core infra** (foundation)
2. **Resume Upload & Parsing (Resume service)**
3. **Storage, DB wiring & Tailored Resumes CRUD**
4. **AI Service Layer (abstraction + parser + keyword extraction)**
5. **Resume Workspace UI (Tailor / Review)**
6. **Job Tracker + Chrome Extension MVP**
7. **Admin Dashboard & Analytics**
8. **CI/CD, Monitoring & Hardening** (parallel to modules 2–7)

> Implement modules **1 → 4** first (back-end core and AI service) so front-end features (5–6) can be wired quickly.

---

## Module 1 — Auth & Core infra

**Goal:** Provide secure user management and project scaffolding.

**Duration (MVP):** 1 week

### Inputs / Outputs

* **Input:** environment variables, OAuth credentials
* **Output:** authentication endpoints, user table, protected API middleware

### Data model (slice)

* `Users` table (see TDD) with `user_id`, `email`, `role`, `auth_provider`, `created_at`.

### API (contracts)

* `POST /auth/signup`
* `POST /auth/login`
* `GET /auth/user`
* `POST /auth/logout`

### Implementation tasks

1. Provision Supabase project and create `Users` table.
2. Implement backend auth routes (Supabase Auth or custom JWT backed by Supabase).
3. Implement social login flows for Google and Apple (start with Google only if time-constrained).
4. Create middleware to protect API routes and extract `user_id`.
5. Create frontend login/register pages and a simple header with account menu.

### Tests / TDD checks

* Unit tests for auth endpoints (success, invalid credentials, token expiry).
* E2E smoke test: sign-up → login → fetch user.

### Acceptance criteria

* Users can sign up and log in via email and Google.
* Backend rejects unauthenticated requests to protected endpoints.

---

## Module 2 — Resume Upload & Parsing Service

**Goal:** Allow users to upload resume files and produce a stable `parsed_json` that breaks resume into sections.

**Duration:** 2–3 weeks

### Inputs / Outputs

* Input: PDF/DOCX/TEXT file
* Output: `Resumes` DB row with `file_url` and `parsed_json` (sections array)

### Data model slice

* `Resumes` table (resume_id, user_id, file_url, parsed_json)

### API

* `POST /resumes/upload` — accepts file, stores raw file to S3/Supabase storage, triggers parsing job
* `GET /resumes/:id` — returns parsed JSON

### Implementation tasks

1. File upload flow (frontend + presigned S3 upload or Supabase storage).
2. Implement parsing worker (Node.js Lambda) that:

   * Uses lightweight PDF/DOCX text-extraction libs (pdf-parse, mammoth) to extract text.
   * Runs deterministic section heuristics (regex + headings) to split into sections (Summary, Experience, Skills, Education, Projects).
   * Conservatively chunk bullets (each bullet as semantic unit) and store metadata (line offsets, original_text).
3. Store `parsed_json` in DB and return an initial `parsing_status` to frontend.
4. Allow user to correct section labels (API: `PATCH /resumes/:id/sections`).

### Tests / TDD checks

* Unit tests for parsing heuristics using 10 varied resume samples.
* Integration test: upload file → parse → DB row with `parsed_json`.

### Acceptance criteria

* > 90% of headings are recognized across test sample set; fallback to manual correction.
* User can edit misidentified sections in UI.

---

## Module 3 — Storage, TailoredResumes CRUD & Versioning

**Goal:** Provide stable storage and DB wiring for tailored resumes, versions, and link them to jobs.

**Duration:** 1 week

### Inputs / Outputs

* Input: tailor requests, job_id
* Output: `Tailored_Resumes` entries with `ats_score`, `match_score`, `version`

### Data model slice

* `Tailored_Resumes` table (see TDD)
* `Applications` and `Jobs` minimal schema

### API

* `POST /resumes/:id/tailor` — create tailored resume record (status: processing)
* `GET /resumes/:id/tailors` — list tailored versions
* `POST /applications` — submit application using tailored resume

### Implementation tasks

1. Implement `Tailored_Resumes` table and versioning policy.
2. Implement server-side endpoint to create a tailored-resume job that enqueues a request to the AI Service Layer.
3. Implement storage for generated PDFs (S3) and link file_url to `Tailored_Resumes`.
4. Implement endpoint to fetch tailored resume preview (HTML/PDF).

### Tests

* CRUD tests for tailored resumes and versioning increments.

### Acceptance criteria

* Tailored resume records created with version and retrievable preview link.

---

## Module 4 — AI Service Layer (Abstraction + Core Functions)

**Goal:** Implement the AI abstraction layer, including parsing assistant, keyword extraction, and a stub Tailor pipeline — with metrics and cost tracking.

**Duration:** 2–3 weeks

### Inputs / Outputs

* Input: `resume_section` text, `job_description` text
* Output: JSON (suggested_edits, rationale, ats_keywords, new_text)

### Components

* **AI Abstraction Router** — routes calls to provider (OpenAI/Anthropic/local) based on config
* **Parser & Keyword Extractor** — runs on job description for top skills
* **Tailoring Worker** — composes prompt using TDD prompt structure and calls LLM
* **Usage Logger** — records tokens_used, cost estimate

### Implementation tasks

1. Build an `ai-client` module with pluggable providers (start with OpenAI shim + local mock provider for tests).
2. Implement prompt templates and JSON output parsing/validation.
3. Build keyword extractor (LLM-first approach): return top N keywords + confidence.
4. Implement simple scoring engine skeleton (keyword overlap, section completion heuristics) to return an ATS and Match score.
5. Hook the Tailor endpoint (`POST /resumes/:id/tailor`) to enqueue a tailoring job to the worker.
6. Store AI responses and link to `Tailored_Resumes`.

### Tests / TDD checks

* Unit tests for `ai-client` with mocked provider responses.
* Integration test: tailor request → ai-client called → tailored JSON saved.
* Validate AI JSON output strictly (schema validation) to avoid malformed data.

### Acceptance criteria

* AI pipeline returns valid JSON per prompt structure.
* AI usage logged with tokens and cost estimates for every call.

---

## Module 5 — Resume Workspace UI (Tailor + Review)

**Goal:** Implement the 3-panel workspace with edit/accept/reject interactions and persisted feedback.

**Duration:** 3–4 weeks

### Inputs / Outputs

* Inputs: `Resumes.parsed_json`, `Tailored_Resumes` suggestions
* Outputs: user-accepted `Tailored_Resumes`, feedback logs

### Components & UI

* Left panel tabs: AI Tailor, Editor, Layout & Style
* Middle panel: Suggested Edits (side-by-side) + PDF preview
* Right panel: Job Match, Score, Templates
* Inline thumbs up/down controls per suggestion

### Implementation tasks

1. Build React components for the 3-panel workspace. Use Tailwind + accessible components.
2. Integrate with parsing and tailored-resume endpoints to fetch suggestions.
3. Implement inline accept/reject actions — these should call `POST /resumes/:id/feedback` with model_id and section_id.
4. Implement PDF preview using headless rendering (puppeteer or server-side HTML-to-PDF) or client-side print styling.
5. Implement resume score visualizations and allow saving accepted version as canonical tailored resume.

### Tests

* UI unit tests for major components.
* Cypress/E2E: Tailor flow (select JD → get suggestions → accept → save tailored resume).

### Acceptance criteria

* Users can accept/reject suggestions and save resulting tailored resume.
* Feedback logs saved with correct context.

---

## Module 6 — Job Tracker & Chrome Extension (MVP)

**Goal:** Implement the Kanban job tracker and a lightweight Chrome Extension popup to quick-save postings.

**Duration:** 3 weeks (Tracker) + 2 weeks (Extension)

### Job Tracker Implementation tasks

1. Add `Jobs` table and CRUD endpoints.
2. Kanban board UI with drag-and-drop updating `PATCH /jobs/:id`.
3. Each job card links to tailored resumes and application records.
4. Quick-add minimal form and filters.

### Chrome Extension MVP tasks

1. Build a React-based popup extension that authenticates via HireMe OAuth (or token flow).
2. Implement `Quick Save to Tracker` button which calls `POST /jobs` with scraped title/company/url (user can edit before save).
3. Resume selection dropdown and `Mark as Applied` shortcut.

### Tests

* Integration test: extension popup save → job appears in Tracker.

### Acceptance criteria

* Users can track jobs on a Kanban board and add via the extension.

---

## Module 7 — Admin Dashboard & Analytics

**Goal:** Provide admin metrics for AI usage, cost, feedback, and system health.

**Duration:** 2 weeks

### Implementation tasks

1. Aggregate AI usage data from `AI_Usage` table into daily summaries.
2. Implement `/admin/metrics/*` endpoints.
3. Build React admin dashboard with charts and tables (top metrics per TDD).

### Acceptance criteria

* Admin can view model call counts, cost breakdowns, and thumbs-up ratios.

---

## Module 8 — CI/CD, Monitoring & Hardening

**Goal:** Add test-driven automation, monitoring, and security controls.

**Duration:** Continuous; prioritize early

### Tasks (parallel)

* GitHub Actions: lint, tests, build, deploy to staging.
* DB backups (daily snapshots), S3 versioning.
* Monitoring: CloudWatch + basic alerting for errors and high AI cost.
* Security: encrypt-at-rest, TLS, rate limits, input sanitization.

---

## Sprint & Release Plan (4-week example)

* **Sprint 0 (week 0)**: Project scaffolding, infra, Supabase provisioning, feature flags.
* **Sprint 1 (week 1)**: Module 1 + minimal frontend auth.
* **Sprint 2 (weeks 2–3)**: Module 2 (upload & parsing) + Module 3 CRUD wiring.
* **Sprint 3 (weeks 4–5)**: Module 4 (AI service stubs + basic tailoring) + basic UI to show suggestions.
* **Sprint 4 (weeks 6–7)**: Module 5 UI polish, accept/reject, saving tailored resumes.
* **Sprint 5 (weeks 8–9)**: Job Tracker + Chrome extension MVP.
* **Sprint 6 (weeks 10–11)**: Admin dashboard, hardening, QA, launch prep.

> Use feature flags to release early functionality (e.g., Tailor behind a toggle) and gather user feedback.

---

## Testing strategy & QA

* Unit tests for all business logic and AI JSON validation.
* Integration tests for resume upload → parse → tailor → save.
* E2E (Cypress) for key user flows (sign-up, upload, tailor flow, tracker).
* Manual QA on 20 varied resumes to validate parser robustness.
* Security tests: penetration basics, dependency scans, secrets audit.

---

## Dev ergonomics & notes for "cursor" approach

* Keep module README files minimal and actionable.
* Each module must include: setup steps, migrations, sample requests, and test data.
* Provide a `mock-ai` provider with canned responses for frontend developers while real model keys remain secret.
* Maintain a small Postman/Insomnia collection for API exploration.

---

## Next immediate step I recommend you run now

1. Create the Supabase project, tables (Users, Resumes, Tailored_Resumes, Jobs, Applications, Feedback_Logs, AI_Usage) using provided SQL in the TDD.
2. Scaffold the Next.js frontend repository and a Node.js backend service repository.
3. Implement Module 1 (Auth) and return here: I can generate the exact code and GitHub Actions for that module next.

---

*End of Modular Cursor Build Plan (v1.0)*
