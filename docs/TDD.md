# HireMe — Technical Design Document (TDD) 

 

## 1. Overview 

This document provides the technical specifications and implementation details for the HireMe MVP.   

It translates PRD requirements into **data models, APIs, AI workflows, frontend components, and deployment architecture**, enabling developers to build a scalable, maintainable, and testable system. 

 

**Note:** “HireMe” is a working title. Branding flexibility is included in architecture and configuration. 

 

--- 

 

## 2. Architecture Overview 

 

### 2.1 High-Level Architecture 

 

[Frontend (Next.js/React + Tailwind)] 

│ 

▼ 

[API Gateway / Backend Service Layer (Supabase + AWS Lambda)] 

│ 

┌────┴───────────────────────────────────────┐ 

│ │ 

▼ ▼ 

[AI Service Layer] [Database Layer (Supabase Postgres)] 

(OpenAI / Anthropic / Local LLMs) │ 

│ │ 

▼ ▼ 

[Scoring Engine + Feedback Loop] [Storage: AWS S3 / Supabase Storage] 

 

 

### 2.2 Layers 

 

| Layer | Technology | Responsibilities | 

|-------|------------|-----------------| 

| Frontend | Next.js + React + Tailwind | UI components, Resume Workspace, Job Tracker, Admin Dashboard, social login integration | 

| Backend | Supabase + AWS Lambda (Node.js/TypeScript) | REST/GraphQL APIs, auth, business logic, AI service orchestration, logging | 

| AI Service Layer | OpenAI / Anthropic / Local LLM | Resume tailoring, scoring, parsing, keyword extraction, feedback processing | 

| Database | Supabase Postgres | Users, resumes, tailored resumes, jobs, applications, feedback logs, AI usage | 

| Storage | AWS S3 / Supabase Storage | Resume and cover letter PDFs/DOCs | 

| Admin & Analytics | React dashboard + backend aggregation | AI usage metrics, costs, feedback, system health | 

 

--- 

 

## 3. Data Models & Schema 

 

### 3.1 Users 

 

CREATE TABLE Users ( 

  user_id UUID PRIMARY KEY, 

  email VARCHAR(255) UNIQUE NOT NULL, 

  role VARCHAR(50) DEFAULT 'user', 

  auth_provider VARCHAR(50), -- 'email', 'google', 'apple' 

  created_at TIMESTAMP DEFAULT NOW(), 

  updated_at TIMESTAMP DEFAULT NOW() 

); 

3.2 Resumes 

 

CREATE TABLE Resumes ( 

  resume_id UUID PRIMARY KEY, 

  user_id UUID REFERENCES Users(user_id), 

  file_url TEXT NOT NULL, 

  parsed_json JSONB, -- structured sections 

  created_at TIMESTAMP DEFAULT NOW(), 

  updated_at TIMESTAMP DEFAULT NOW() 

); 

3.3 Tailored Resumes 

 
CREATE TABLE Tailored_Resumes ( 

  tailored_id UUID PRIMARY KEY, 

  base_resume_id UUID REFERENCES Resumes(resume_id), 

  job_id UUID REFERENCES Jobs(job_id), 

  ats_score FLOAT, 

  match_score FLOAT, 

  feedback_summary JSONB, 

  version INT DEFAULT 1, 

  created_at TIMESTAMP DEFAULT NOW(), 

  updated_at TIMESTAMP DEFAULT NOW() 

); 

3.4 Jobs 

 
CREATE TABLE Jobs ( 

  job_id UUID PRIMARY KEY, 

  user_id UUID REFERENCES Users(user_id), 

  title VARCHAR(255), 

  company VARCHAR(255), 

  url TEXT, 

  status VARCHAR(50) DEFAULT 'Interested', 

  created_at TIMESTAMP DEFAULT NOW(), 

  updated_at TIMESTAMP DEFAULT NOW() 

); 

3.5 Applications 

 
CREATE TABLE Applications ( 

  application_id UUID PRIMARY KEY, 

  job_id UUID REFERENCES Jobs(job_id), 

  resume_id UUID REFERENCES Tailored_Resumes(tailored_id), 

  status VARCHAR(50), 

  applied_on TIMESTAMP DEFAULT NOW() 

); 

3.6 Feedback Logs 

 
CREATE TABLE Feedback_Logs ( 

  feedback_id UUID PRIMARY KEY, 

  user_id UUID REFERENCES Users(user_id), 

  model_id VARCHAR(50), 

  resume_section VARCHAR(255), 

  decision BOOLEAN, -- TRUE=Thumbs Up, FALSE=Thumbs Down 

  timestamp TIMESTAMP DEFAULT NOW() 

); 

3.7 AI Usage 

 
CREATE TABLE AI_Usage ( 

  usage_id UUID PRIMARY KEY, 

  model VARCHAR(50), 

  feature VARCHAR(50), 

  tokens_used INT, 

  cost FLOAT, 

  created_at TIMESTAMP DEFAULT NOW() 

); 

4. API Specifications 

4.1 Authentication 

POST /auth/signup – Email/password or social login 

 

POST /auth/login – Email/password or OAuth token 

 

POST /auth/logout – JWT invalidation 

 

GET /auth/user – Return current user info 

 

4.2 Resume Management 

POST /resumes/upload – Upload base resume → triggers parsing → stores structured JSON 

 

GET /resumes/:id – Fetch resume and sections 

 

POST /resumes/:id/tailor – Generate tailored resume via AI 

 

POST /resumes/:id/feedback – Submit thumbs up/down feedback 

 

4.3 Job Tracker 

POST /jobs/ – Create job entry 

 

GET /jobs/ – List user jobs 

 

PATCH /jobs/:id – Update status (drag-and-drop) 

 

DELETE /jobs/:id – Remove job 

 

4.4 Applications 

POST /applications/ – Link tailored resume to job 

 

GET /applications/ – List applications for user 

 

4.5 Admin Dashboard 

GET /admin/metrics/ai-usage – Aggregate API usage and cost per model 

 

GET /admin/metrics/feedback – Summarize thumbs up/down 

 

GET /admin/metrics/system-health – Latency, uptime, errors 

 

5. AI/LLM Service Layer 

5.1 Workflow 

Resume uploaded → parsed into sections → stored in database 

 

Job description provided → AI extracts keywords 

 

AI Tailor function: suggests edits per section 

 

Feedback stored → updates model scoring weights 

 

Resume Score & Job Match Score calculated 

 

Tailored resume saved → linked to Job Tracker 

 

5.2 AI Abstraction Layer 

Routes requests to configured LLM provider 

 

Supports multiple providers (OpenAI, Anthropic, local) 

 

Tracks tokens, cost, response time per request 

 

5.3 AI Prompt Structure 

 
{ 

  "resume_section": "<text>", 

  "job_description": "<text>", 

  "instructions": "Suggest minimal edits preserving tone and improving ATS relevance", 

  "output_format": { 

    "suggested_edits": ["string"], 

    "rationale": "string", 

    "ats_keywords": ["string"], 

    "new_text": "string" 

  } 

} 

6. Frontend Component Design 

6.1 Resume Workspace 

Left Panel Tabs: AI Tailor, Editor, Layout & Style 

 

Middle Panel Tabs: Suggested Edits, PDF Preview + Scores 

 

Right Panel Tabs: Job Match, Score Breakdown, Templates 

 

React state management: Resume JSON → section-wise edits → feedback → PDF rendering 

 

6.2 Job Tracker 

Kanban board (columns: Interested, Applied, Interview, Offer) 

 

Drag-and-drop updates → PATCH /jobs/:id 

 

Linked to resumes via resume_id 

 

6.3 Admin Dashboard 

Charts for AI usage, feedback metrics 

 

Tables for system health, user counts 

 

Role-based component rendering 

 

7. Deployment & CI/CD 

Hosting: AWS (Lambda + S3) / Supabase backend 

 

Frontend: Vercel (Next.js) 

 

CI/CD: GitHub Actions for lint, tests, build, deploy 

 

Environment Variables: LLM API keys, branding config (brand name/logo) 

 

Logging & Monitoring: CloudWatch + Supabase logs 

 

Backup Strategy: Daily DB snapshots + S3 versioning 

 

8. Security & Compliance 

Data encrypted at rest (Postgres, S3) 

 

TLS/HTTPS for all endpoints 

 

OAuth tokens and JWT session management 

 

GDPR/CCPA compliance for PII 

 

Role-based access control for admin endpoints 

 

9. Branding & Theme Flexibility 

brandName, brandColor, logoPath stored in environment config 

 

Frontend reads variables dynamically for logos, colors, titles 

 

Enables easy rebranding without code changes 

 

10. References 

Primary reference: HireMe PRD v1.0 

 

Detailed API contract and schema diagrams maintained alongside TDD 

 

Future iteration notes: AI model updates, new features, post-MVP scaling 

 

Copy code 

 

--- 

 

This TDD provides **all the concrete technical details** a developer or LLM can use to generate code.   

 

Next steps if you want to integrate it with LLMs for code generation:   

1. Feed **one module at a time** (Auth, Resume, Job Tracker, AI, Admin).   

2. Include relevant schema, API endpoints, and workflow excerpts from this TDD.   

3. Use iterative prompts to generate backend → frontend → AI integration sequentially.   