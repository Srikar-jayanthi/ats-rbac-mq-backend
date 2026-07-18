import request from 'supertest';
import app from '../src/app';
import pool from '../src/db';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcryptjs';

// Mock DB pool queries to avoid requiring a live postgres service during unit tests
jest.mock('../src/db', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key';

describe('RBAC & Authentication Middleware Integration Tests', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('POST /api/auth/register should enforce multi-tenant constraints per role', async () => {
    // 1. Candidate trying to register with a company should fail
    const resCandidateWithCompany = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'candidate@example.com',
        password: 'password123',
        role: 'candidate',
        company_id: 'd9b23b32-8418-472d-bf06-9e909a367210',
      });
    expect(resCandidateWithCompany.status).toBe(400);
    expect(resCandidateWithCompany.body.error).toContain('Candidates must not be associated with a company');

    // 2. Recruiter trying to register without a company should fail
    const resRecruiterNoCompany = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'recruiter@example.com',
        password: 'password123',
        role: 'recruiter',
      });
    expect(resRecruiterNoCompany.status).toBe(400);
    expect(resRecruiterNoCompany.body.error).toContain('Recruiters and hiring managers must belong to a company');
  });

  test('POST /api/auth/login should return a valid JWT token on matching credentials', async () => {
    const passwordHash = await bcrypt.hash('secret_password', 10);
    
    // Mock user lookup query
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: 'user-uuid',
          email: 'recruiter@example.com',
          password_hash: passwordHash,
          role: 'recruiter',
          company_id: 'company-uuid',
        },
      ],
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'recruiter@example.com',
        password: 'secret_password',
      });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    
    // Decode token and verify contents
    const payload: any = jwt.verify(res.body.token, JWT_SECRET);
    expect(payload.id).toBe('user-uuid');
    expect(payload.role).toBe('recruiter');
    expect(payload.company_id).toBe('company-uuid');
  });

  test('POST /api/jobs should return 401 Unauthorized when Bearer token is missing', async () => {
    const res = await request(app)
      .post('/api/jobs')
      .send({
        title: 'Frontend Engineer',
        description: 'React development tasks',
      });
    expect(res.status).toBe(401);
  });

  test('POST /api/jobs should return 403 Forbidden for candidate roles (RBAC validation)', async () => {
    const candidateToken = jwt.sign(
      { id: 'candidate-uuid', email: 'candidate@example.com', role: 'candidate', company_id: null },
      JWT_SECRET
    );

    const res = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${candidateToken}`)
      .send({
        title: 'Backend Engineer',
        description: 'Node.js API tasks',
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Forbidden: Insufficient permissions');
  });

  test('POST /api/jobs should return 201 Created for recruiters with matching company', async () => {
    const recruiterToken = jwt.sign(
      { id: 'recruiter-uuid', email: 'recruiter@example.com', role: 'recruiter', company_id: 'company-uuid' },
      JWT_SECRET
    );

    // Mock job creation query
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rows: [
        {
          id: 'job-uuid',
          company_id: 'company-uuid',
          title: 'Staff Engineer',
          description: 'Architecture tasks',
          status: 'open',
          created_by: 'recruiter-uuid',
        },
      ],
    });

    const res = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${recruiterToken}`)
      .send({
        title: 'Staff Engineer',
        description: 'Architecture tasks',
      });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Staff Engineer');
    expect(res.body.company_id).toBe('company-uuid');
  });

  test('PUT /api/jobs/:id should return 403 Forbidden if recruiter tries to update another company\'s job', async () => {
    const recruiterToken = jwt.sign(
      { id: 'recruiter-uuid', email: 'recruiter@example.com', role: 'recruiter', company_id: 'company-A-uuid' },
      JWT_SECRET
    );

    // Mock check: job belongs to company-B-uuid
    (pool.query as jest.Mock).mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ company_id: 'company-B-uuid' }],
    });

    const res = await request(app)
      .put('/api/jobs/some-job-uuid')
      .set('Authorization', `Bearer ${recruiterToken}`)
      .send({
        title: 'Modified Job Title',
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Forbidden: Cannot modify a job from another company');
  });
});
