# AI Tailor Feature Setup

## Database Setup

Run the SQL in [docs/sql/ai_tailor.sql](docs/sql/ai_tailor.sql) in your Supabase SQL Editor to create the necessary table for storing AI tailoring results.

## Environment Variables

If you want to use a specific LLM provider for the tailoring feature, you can set the following environment variables in your `backend/.env` file. If not set, it will fallback to `LLM_REVIEW_API_URL` or `LLM_PARSE_API_URL`.

```env
LLM_TAILOR_API_URL=https://...
LLM_TAILOR_API_KEY=...
LLM_TAILOR_MODEL=...
```
