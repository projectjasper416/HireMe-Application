export interface ResumeRecord {
  id: string;
  user_id: string;
  original_name: string;
  original_content: string;
  sections: ResumeSection[];
  original_pdf_base64?: string | null;
  created_at: string;
}

export interface ResumeSection {
  heading: string;
  body: string;
  raw_body?: unknown;
}

export interface ResumeReview {
  section_name: string;
  ai_suggestions_html: string;
  raw_data?: string;
  final_updated?: string;
  created_at: string;
}

export interface TailoredResumeRecord {
  id: string;
  resume_id: string;
  job_title: string;
  tailored_sections: ResumeSection[];
  rationale: string;
  created_at: string;
  feedback?: 'up' | 'down' | null;
}


