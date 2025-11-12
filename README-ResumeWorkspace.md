# HireMe – Step 2: Resume Management Workspace

This guide documents Step 2 of HireMe: Resume Management + AI Review. It builds on Step 1 (Authentication & Users) and introduces:

- Resume ingestion & parsing via Supabase-backed APIs
- AI-powered section reviews with redline suggestions
- Inline editing + save flow per section
- Dedicated dashboard experience (upload + action buttons)

Inline comments in the code reference PRD section 6.1 and TDD sections 3.2, 4.2, and 5.

---

## Feature Overview
- Resume upload (PDF/DOCX/TXT) with automatic section parsing, including a normalized **Contact Information** section.
- AI Review button → `/ai-review/:resumeId` with redline HTML for suggested word swaps.
- Inline editing controls: accept all, revert, manual edit, save.
- AI suggestions stored for auditing (`resume_ai_reviews` table).
- Clean dashboard: Upload card + action buttons (AI Review, AI Tailor placeholder).

---

## Prerequisites
Complete all steps from `README.md` (authentication setup) first.

Additional environment variables:

`backend/.env`
```
LLM_API_URL= # optional: external tailoring LLM endpoint
LLM_API_KEY= # optional: bearer key for tailoring LLM
LLM_PARSE_API_URL= # REQUIRED: resume parsing LLM endpoint
LLM_PARSE_API_KEY= # REQUIRED: key for resume parsing LLM
LLM_PARSE_MODEL=parse-lite # optional: model name override
LLM_REVIEW_API_URL= # REQUIRED: AI review LLM endpoint
LLM_REVIEW_API_KEY= # REQUIRED: key for AI review LLM
LLM_REVIEW_MODEL= # optional: review model override (e.g. gemini-2.0-pro-exp)
```

When omitted, the tailoring endpoint falls back to a deterministic stub (see `backend/src/services/llm.ts`).
Parsing now relies entirely on the configured LLM (invoked by the backend upload endpoint) and will return HTTP 502 if the parsing LLM is unreachable or misconfigured.  
The parsing service must support OpenAI-style chat payloads shaped as:
```
{
  "model": "parse-lite", // optional
  "contents": [
    {
      "role": "user",
      "parts": [
        { "text": "Parse the attached resume into structured sections..." },
        { "inline_data": { "mime_type": "application/pdf", "data": "<base64>" } }
      ]
    }
  ]
}
```
and respond with:
```
{
  "sections": [
    { "heading": "...", "body": "..." }
  ]
}
```

---

## Database Setup
Run `docs/sql/resume_workspace.sql` against your Supabase project.

This script:
- Creates `public.resumes` table for storing parsed sections + original PDFs.
- Creates `public.resume_ai_reviews` to persist AI redline HTML per section.
- Enables RLS so only owners can access/update data.
- Configures policies for select/insert/update per TDD 3.2.

> Tip: Run `docs/sql/users.sql` first if you haven’t already.

---

## Backend Endpoints
Base URL: `http://localhost:4000`

All routes require Bearer JWT (Supabase access token).

- `POST /resumes`
  - Body: `{ "fileName": string, "originalPdfBase64": string }`
  - Backend forwards the PDF (base64) to the parsing LLM, persists sections + original snapshot.
  - References: PRD 6.1, TDD 4.2.

- `GET /resumes`
  - Returns all resumes for the authenticated user.

- `GET /resumes/:resumeId/sections`
  - Returns parsed sections plus any stored AI reviews.

- `POST /resumes/:resumeId/review`
  - Triggers the review LLM for each section.
  - Stores HTML redlines in `resume_ai_reviews`.

- `PUT /resumes/:resumeId/sections/:index`
  - Persists user-edited section content back to Supabase.

Backend implementation highlights:
- `backend/src/routes/resumes.ts`
- `backend/src/services/llmParser.ts`
- `backend/src/services/reviewLLM.ts`

Install any new dependencies if you haven’t already:
```
cd backend
npm install
```

Restart the backend dev server:
```
npm run dev
```

---

## Frontend Workspace

### Components
- `frontend/src/components/ResumeWorkspace.tsx`: Dashboard with upload card + resume list (AI Review, AI Tailor placeholder).
- `frontend/src/pages/AIReviewPage.tsx`: Section-by-section AI review with inline redlines and editing.
- `frontend/src/App.tsx`: Handles authentication, routing, and layout shell (React Router).
- New dependencies: `react-router-dom`, `dompurify`, `@types/dompurify`.

### Interactions
1. Login → dashboard (upload card + action buttons).
2. Upload a resume → automatically parsed and redirects to `/ai-review/:resumeId`.
3. AI Review page:
   - Run review (if not already generated) → LLM returns inline `<del>/<ins>` redlines (word-level changes only) while keeping Contact Information intact.
   - Inline edit via contentEditable area, Accept All (strip `<del>/<ins>`), Revert, Save Section.
   - Suggestions displayed using sanitized HTML (DOMPurify) to avoid XSS.
4. Updates persist to Supabase; reviewing again overwrites existing suggestions.

### Run Frontend
```
cd frontend
npm install
npm run dev
```

Ensure `VITE_API_BASE_URL` points to the backend and Supabase credentials remain valid (see Step 1 README).

---

## Testing Checklist
- [ ] Upload a resume → redirected to AI Review.
- [ ] Run AI Review → inline redline HTML (word-level changes) visible for each section.
- [ ] Accept all changes → editor removes redline markup and keeps inserted copy only.
- [ ] Manual edits + Save Section persist (refresh retains changes).
- [ ] Frontend sanitizes suggestions (`<del>` red, `<ins>` green).
- [ ] Authentication + session refresh continue to work.

---

## Security & Performance Notes
- Resume PII should be masked before LLM calls (extend `reviewSectionWithLLM` if required).
- HTML is sanitized client-side with DOMPurify; backend can add server-side sanitizer if needed.
- Resume data stored in Supabase; use encryption at rest (AES-256) as per PRD if available.
- LLM credentials: use separate API keys for parsing (`LLM_PARSE_*`) and review (`LLM_REVIEW_*`).
- Performance targets (per PRD/TDD):
  - Upload ≤ 2s for <2MB file.
  - Review call ≤ 5s/section.
  - Inline save ≤ 1s.

---

## Next Steps
- Implement granular accept/reject for individual `<del>/<ins>` segments.
- Add AI Tailor flow sharing parsed sections but different prompt.
- Persist review history (multiple runs) with timestamps.
- Enhance logging + PII scrubbing before sending to external LLMs.

