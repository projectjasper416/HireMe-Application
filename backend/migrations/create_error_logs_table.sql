-- Create error_logs table for storing application errors
-- This table captures errors from both frontend and backend

CREATE TABLE IF NOT EXISTS public.error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- NULL for unauthenticated errors
  error_type TEXT NOT NULL CHECK (error_type IN ('frontend', 'backend', 'api')),
  error_message TEXT NOT NULL,
  error_stack TEXT,
  error_details JSONB, -- Additional context like request body, headers, etc.
  url TEXT, -- Frontend: current URL, Backend: request URL
  method TEXT, -- HTTP method for backend errors
  status_code INTEGER, -- HTTP status code
  user_agent TEXT,
  ip_address TEXT,
  feature TEXT, -- Which feature/component triggered the error (e.g., 'resume_upload', 'ai_review')
  severity TEXT DEFAULT 'error' CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS error_logs_user_id_idx ON public.error_logs(user_id);
CREATE INDEX IF NOT EXISTS error_logs_error_type_idx ON public.error_logs(error_type);
CREATE INDEX IF NOT EXISTS error_logs_severity_idx ON public.error_logs(severity);
CREATE INDEX IF NOT EXISTS error_logs_feature_idx ON public.error_logs(feature);
CREATE INDEX IF NOT EXISTS error_logs_created_at_idx ON public.error_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS error_logs_resolved_idx ON public.error_logs(resolved) WHERE resolved = FALSE;

-- Enable RLS
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own error logs
CREATE POLICY "Users can view their own error logs"
  ON public.error_logs FOR SELECT
  USING (auth.uid() = user_id OR auth.uid() IS NULL);

-- Policy: Service role can insert error logs (for backend logging)
-- Note: Frontend will use an API endpoint that uses service role
CREATE POLICY "Service role can insert error logs"
  ON public.error_logs FOR INSERT
  WITH CHECK (true);

-- Policy: Service role can update error logs (for marking as resolved)
CREATE POLICY "Service role can update error logs"
  ON public.error_logs FOR UPDATE
  USING (true);

