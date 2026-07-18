import { Router, Request, Response } from 'express';
import pool from '../db';
import { authenticateToken, requireRole } from '../middleware/auth';
import { enqueueEmail } from '../queue';

const router = Router();

/**
 * POST /api/jobs
 * Creates a new job posting.
 * Access restricted to recruiters.
 * Tenant enforcement: A recruiter can only create jobs for their own company.
 */
router.post(
  '/',
  authenticateToken,
  requireRole(['recruiter']),
  async (req: Request, res: Response) => {
    const { title, description, status = 'open' } = req.body;
    const companyId = req.user?.company_id;
    const userId = req.user?.id;

    if (!title || !description) {
      return res.status(400).json({ error: 'Title and description are required' });
    }

    if (!companyId) {
      return res.status(403).json({ error: 'Forbidden: Recruiter must belong to a company' });
    }

    if (status !== 'open' && status !== 'closed') {
      return res.status(400).json({ error: "Status must be either 'open' or 'closed'" });
    }

    try {
      const result = await pool.query(
        `INSERT INTO jobs (company_id, title, description, status, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, company_id, title, description, status, created_by, created_at`,
        [companyId, title.trim(), description.trim(), status, userId]
      );

      return res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error('Error creating job:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /api/jobs
 * Lists all jobs.
 */
router.get('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, company_id, title, description, status, created_by, created_at
       FROM jobs
       ORDER BY created_at DESC`
    );
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error listing jobs:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/jobs/:id
 * Fetches details of a specific job.
 */
router.get('/:id', authenticateToken, async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT id, company_id, title, description, status, created_by, created_at
       FROM jobs
       WHERE id = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching job:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/jobs/:id
 * Updates an existing job posting.
 * Access restricted to recruiters.
 * Tenant enforcement: A recruiter can only update jobs belonging to their own company.
 */
router.put(
  '/:id',
  authenticateToken,
  requireRole(['recruiter']),
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { title, description, status } = req.body;
    const companyId = req.user?.company_id;

    if (!companyId) {
      return res.status(403).json({ error: 'Forbidden: Recruiter must belong to a company' });
    }

    try {
      // 1. Fetch job to verify ownership
      const jobCheck = await pool.query('SELECT company_id FROM jobs WHERE id = $1', [id]);
      if (jobCheck.rowCount === 0) {
        return res.status(404).json({ error: 'Job not found' });
      }

      if (jobCheck.rows[0].company_id !== companyId) {
        return res.status(403).json({ error: 'Forbidden: Cannot modify a job from another company' });
      }

      // 2. Perform Update
      const updates: string[] = [];
      const values: any[] = [];
      let valIdx = 1;

      if (title !== undefined) {
        updates.push(`title = $${valIdx++}`);
        values.push(title.trim());
      }
      if (description !== undefined) {
        updates.push(`description = $${valIdx++}`);
        values.push(description.trim());
      }
      if (status !== undefined) {
        if (status !== 'open' && status !== 'closed') {
          return res.status(400).json({ error: "Status must be either 'open' or 'closed'" });
        }
        updates.push(`status = $${valIdx++}`);
        values.push(status);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      values.push(id);
      const updateQuery = `
        UPDATE jobs
        SET ${updates.join(', ')}
        WHERE id = $${valIdx}
        RETURNING id, company_id, title, description, status, created_by, created_at
      `;

      const result = await pool.query(updateQuery, values);
      return res.status(200).json(result.rows[0]);
    } catch (err) {
      console.error('Error updating job:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * DELETE /api/jobs/:id
 * Deletes a job posting.
 * Access restricted to recruiters.
 * Tenant enforcement: A recruiter can only delete jobs belonging to their own company.
 */
router.delete(
  '/:id',
  authenticateToken,
  requireRole(['recruiter']),
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const companyId = req.user?.company_id;

    if (!companyId) {
      return res.status(403).json({ error: 'Forbidden: Recruiter must belong to a company' });
    }

    try {
      // 1. Fetch job to verify ownership
      const jobCheck = await pool.query('SELECT company_id FROM jobs WHERE id = $1', [id]);
      if (jobCheck.rowCount === 0) {
        return res.status(404).json({ error: 'Job not found' });
      }

      if (jobCheck.rows[0].company_id !== companyId) {
        return res.status(403).json({ error: 'Forbidden: Cannot delete a job from another company' });
      }

      // 2. Delete the job
      await pool.query('DELETE FROM jobs WHERE id = $1', [id]);
      return res.status(200).json({ message: 'Job deleted successfully' });
    } catch (err) {
      console.error('Error deleting job:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * POST /api/jobs/:jobId/applications
 * Candidate applies to an open job.
 * Creates Application (stage: 'Applied') & ApplicationHistory (previous: null, new: 'Applied') in a single transaction.
 * Triggers asynchronous email events for the candidate and recruiter.
 */
router.post(
  '/:jobId/applications',
  authenticateToken,
  requireRole(['candidate']),
  async (req: Request, res: Response) => {
    const { jobId } = req.params;
    const { resume_url } = req.body;
    const candidateId = req.user?.id;
    const candidateEmail = req.user?.email;

    if (!candidateId || !candidateEmail) {
      return res.status(401).json({ error: 'Unauthorized: Missing candidate details' });
    }

    try {
      // 1. Verify job exists and is open
      const jobRes = await pool.query(
        `SELECT j.id, j.title, j.status, u.email as recruiter_email
         FROM jobs j
         JOIN users u ON j.created_by = u.id
         WHERE j.id = $1`,
        [jobId]
      );

      if (jobRes.rowCount === 0) {
        return res.status(404).json({ error: 'Job not found' });
      }

      const job = jobRes.rows[0];
      if (job.status !== 'open') {
        return res.status(400).json({ error: 'Cannot apply to a closed job' });
      }

      // 2. Check if candidate already applied
      const applicationCheck = await pool.query(
        'SELECT id FROM applications WHERE job_id = $1 AND candidate_id = $2',
        [jobId, candidateId]
      );

      if (applicationCheck.rowCount > 0) {
        return res.status(400).json({ error: 'You have already applied to this job' });
      }

      // 3. Begin DB Transaction to create Application and ApplicationHistory
      const client = await pool.connect();
      let application: any;

      try {
        await client.query('BEGIN');

        // Create application
        const appInsert = await client.query(
          `INSERT INTO applications (job_id, candidate_id, stage, resume_url)
           VALUES ($1, $2, 'Applied', $3)
           RETURNING id, job_id, candidate_id, stage, resume_url, created_at, updated_at`,
          [jobId, candidateId, resume_url]
        );
        application = appInsert.rows[0];

        // Create history log (previous_stage is NULL for initial submission)
        await client.query(
          `INSERT INTO application_histories (application_id, previous_stage, new_stage, changed_by)
           VALUES ($1, NULL, 'Applied', $2)`,
          [application.id, candidateId]
        );

        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      // 4. Enqueue background notification tasks asynchronously
      // The HTTP thread does NOT wait for the queue worker to complete, returning 201 immediately.
      try {
        await enqueueEmail('send_application_received_email', {
          candidate_email: candidateEmail,
          job_title: job.title,
        });

        await enqueueEmail('send_new_applicant_email', {
          recruiter_email: job.recruiter_email,
          job_title: job.title,
        });
      } catch (queueErr) {
        // Log queue failure, but notice FAQ: "if the API cannot enqueue a required notification,
        // it is acceptable to log an error and return a 500 status code"
        console.error('Queue connection/enqueuing error, failing request:', queueErr);
        return res.status(500).json({
          error: 'Internal server error: Failed to queue background notification',
        });
      }

      return res.status(201).json(application);
    } catch (err) {
      console.error('Error applying to job:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /api/jobs/:jobId/applications
 * Lists applications for a specific job.
 * Access restricted to recruiters or hiring managers belonging to the job's company.
 * Supports stage filtering via query parameter: stage=Screening
 */
router.get(
  '/:jobId/applications',
  authenticateToken,
  requireRole(['recruiter', 'hiring_manager']),
  async (req: Request, res: Response) => {
    const { jobId } = req.params;
    const { stage } = req.query;
    const companyId = req.user?.company_id;

    if (!companyId) {
      return res.status(403).json({ error: 'Forbidden: Recruiter must belong to a company' });
    }

    try {
      // 1. Verify job exists and belongs to recruiter's/manager's company
      const jobCheck = await pool.query('SELECT company_id FROM jobs WHERE id = $1', [jobId]);
      if (jobCheck.rowCount === 0) {
        return res.status(404).json({ error: 'Job not found' });
      }

      if (jobCheck.rows[0].company_id !== companyId) {
        return res.status(403).json({ error: 'Forbidden: Job belongs to another company' });
      }

      // 2. Fetch applications with optional stage filtering
      let queryStr = `
        SELECT a.id, a.job_id, a.candidate_id, a.stage, a.resume_url, a.created_at, a.updated_at,
               u.email as candidate_email
        FROM applications a
        JOIN users u ON a.candidate_id = u.id
        WHERE a.job_id = $1
      `;
      const queryParams: any[] = [jobId];

      if (stage && typeof stage === 'string') {
        queryStr += ` AND a.stage = $2`;
        queryParams.push(stage);
      }

      queryStr += ` ORDER BY a.created_at DESC`;

      const result = await pool.query(queryStr, queryParams);
      return res.status(200).json(result.rows);
    } catch (err) {
      console.error('Error listing job applications:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
