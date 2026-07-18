import { Router, Request, Response } from 'express';
import pool from '../db';
import { authenticateToken, requireRole } from '../middleware/auth';
import { isValidTransition } from '../services/stateMachine';
import { enqueueEmail } from '../queue';

const router = Router();

/**
 * GET /api/applications/me
 * Lists all applications belonging to the authenticated candidate.
 */
router.get(
  '/me',
  authenticateToken,
  requireRole(['candidate']),
  async (req: Request, res: Response) => {
    const candidateId = req.user?.id;

    try {
      const result = await pool.query(
        `SELECT a.id, a.job_id, a.candidate_id, a.stage, a.resume_url, a.created_at, a.updated_at,
                j.title as job_title, j.company_id
         FROM applications a
         JOIN jobs j ON a.job_id = j.id
         WHERE a.candidate_id = $1
         ORDER BY a.created_at DESC`,
        [candidateId]
      );

      return res.status(200).json(result.rows);
    } catch (err) {
      console.error('Error fetching candidate applications:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /api/applications/:applicationId
 * Fetches details of a single application.
 * Access is restricted to:
 * - The candidate who owns the application.
 * - Recruiters or hiring managers belonging to the company posting the job.
 */
router.get('/:applicationId', authenticateToken, async (req: Request, res: Response) => {
  const { applicationId } = req.params;
  const userId = req.user?.id;
  const userRole = req.user?.role;
  const userCompanyId = req.user?.company_id;

  try {
    const result = await pool.query(
      `SELECT a.id, a.job_id, a.candidate_id, a.stage, a.resume_url, a.created_at, a.updated_at,
              j.company_id, j.title as job_title
       FROM applications a
       JOIN jobs j ON a.job_id = j.id
       WHERE a.id = $1`,
      [applicationId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const application = result.rows[0];

    // Access check:
    if (userRole === 'candidate') {
      if (application.candidate_id !== userId) {
        return res.status(403).json({ error: 'Forbidden: You do not own this application' });
      }
    } else {
      // recruiter or hiring_manager
      if (application.company_id !== userCompanyId) {
        return res.status(403).json({ error: 'Forbidden: Application belongs to another company' });
      }
    }

    return res.status(200).json(application);
  } catch (err) {
    console.error('Error fetching application details:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/jobs/:jobId/applications
 * Lists applications for a specific job.
 * Access restricted to recruiters or hiring managers belonging to the job's company.
 * Supports stage filtering via query parameter: stage=Screening
 */
router.get(
  '/job/:jobId',
  authenticateToken,
  requireRole(['recruiter', 'hiring_manager']),
  async (req: Request, res: Response) => {
    const { jobId } = req.params;
    const { stage } = req.query;
    const companyId = req.user?.company_id;

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

/**
 * PUT /api/applications/:applicationId/stage
 * Updates the stage of an application.
 * Access restricted to recruiters or hiring managers belonging to the job's company.
 * Validates transition via the state machine service.
 * Performs the update and audit history log creation in a database transaction.
 * Enqueues an asynchronous notification email task on success.
 */
router.put(
  '/:applicationId/stage',
  authenticateToken,
  requireRole(['recruiter', 'hiring_manager']),
  async (req: Request, res: Response) => {
    const { applicationId } = req.params;
    const { stage: newStage } = req.body;
    const userId = req.user?.id;
    const companyId = req.user?.company_id;

    if (!newStage || typeof newStage !== 'string') {
      return res.status(400).json({ error: 'New stage is required' });
    }

    try {
      // 1. Fetch current application details along with job company check
      const appRes = await pool.query(
        `SELECT a.id, a.stage as current_stage, a.candidate_id,
                j.company_id, j.title as job_title,
                u.email as candidate_email
         FROM applications a
         JOIN jobs j ON a.job_id = j.id
         JOIN users u ON a.candidate_id = u.id
         WHERE a.id = $1`,
        [applicationId]
      );

      if (appRes.rowCount === 0) {
        return res.status(404).json({ error: 'Application not found' });
      }

      const application = appRes.rows[0];

      // Tenant validation: User must belong to the same company as the job posting
      if (application.company_id !== companyId) {
        return res.status(403).json({ error: 'Forbidden: Cannot manage applications for another company' });
      }

      const currentStage = application.current_stage;

      // 2. Validate transition using the state machine
      if (!isValidTransition(currentStage, newStage)) {
        return res.status(400).json({
          error: `Invalid transition: Cannot move application from '${currentStage}' to '${newStage}'`,
        });
      }

      // 3. Perform Stage Update and Audit Log Insertion in a Transaction
      const client = await pool.connect();
      let updatedApp: any;

      try {
        await client.query('BEGIN');

        // Update application stage
        const updateRes = await client.query(
          `UPDATE applications
           SET stage = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2
           RETURNING id, job_id, candidate_id, stage, resume_url, created_at, updated_at`,
          [newStage, applicationId]
        );
        updatedApp = updateRes.rows[0];

        // Insert history record
        await client.query(
          `INSERT INTO application_histories (application_id, previous_stage, new_stage, changed_by)
           VALUES ($1, $2, $3, $4)`,
          [applicationId, currentStage, newStage, userId]
        );

        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      // 4. Enqueue background email notification asynchronously
      try {
        await enqueueEmail('send_stage_update_email', {
          candidate_email: application.candidate_email,
          new_stage: newStage,
          job_title: application.job_title,
        });
      } catch (queueErr) {
        console.error('Queue connection/enqueuing error during stage transition:', queueErr);
        return res.status(500).json({
          error: 'Internal server error: Failed to queue background notification',
        });
      }

      return res.status(200).json(updatedApp);
    } catch (err) {
      console.error('Error updating application stage:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
