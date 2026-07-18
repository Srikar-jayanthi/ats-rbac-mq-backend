export type UserRole = 'candidate' | 'recruiter' | 'hiring_manager';
export type JobStatus = 'open' | 'closed';

export interface UserPayload {
  id: string;
  email: string;
  role: UserRole;
  company_id: string | null;
}

// Extend Express Request namespace to include the authenticated user payload
declare global {
  namespace Express {
    interface Request {
      user?: UserPayload;
    }
  }
}

export interface User {
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  company_id: string | null;
  created_at: Date;
}

export interface Company {
  id: string;
  name: string;
  created_at: Date;
}

export interface Job {
  id: string;
  company_id: string;
  title: string;
  description: string;
  status: JobStatus;
  created_by: string;
  created_at: Date;
}

export interface Application {
  id: string;
  job_id: string;
  candidate_id: string;
  stage: string;
  resume_url?: string;
  created_at: Date;
  updated_at: Date;
}

export interface ApplicationHistory {
  id: string;
  application_id: string;
  previous_stage: string | null;
  new_stage: string;
  changed_by: string;
  changed_at: Date;
}
