import { Router, Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import pool from '../db';
import { UserRole } from '../types';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key';

/**
 * POST /api/auth/companies
 * Helper endpoint to register a company in a multi-tenant system.
 * Returns the created company with its UUID.
 */
router.post('/companies', async (req: Request, res: Response) => {
  const { name } = req.body;

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'Company name is required' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO companies (name) VALUES ($1) RETURNING id, name, created_at',
      [name.trim()]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Company name already exists' });
    }
    console.error('Error creating company:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/register
 * Registers a new user. Enforces role validations:
 * - Candidates must not have a company.
 * - Recruiters and Hiring Managers must belong to an existing company.
 */
router.post('/register', async (req: Request, res: Response) => {
  const { email, password, role, company_id } = req.body;

  // Basic validations
  if (!email || !password || !role) {
    return res.status(400).json({ error: 'Email, password, and role are required' });
  }

  const validRoles: UserRole[] = ['candidate', 'recruiter', 'hiring_manager'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: `Invalid role. Allowed roles are: ${validRoles.join(', ')}` });
  }

  // Multi-tenant validations
  let userCompanyId: string | null = null;
  if (role === 'candidate') {
    if (company_id) {
      return res.status(400).json({ error: 'Candidates must not be associated with a company' });
    }
  } else {
    // recruiter or hiring_manager
    if (!company_id) {
      return res.status(400).json({ error: 'Recruiters and hiring managers must belong to a company' });
    }
    // Verify company exists
    try {
      const companyCheck = await pool.query('SELECT id FROM companies WHERE id = $1', [company_id]);
      if (companyCheck.rowCount === 0) {
        return res.status(400).json({ error: 'Associated company does not exist' });
      }
      userCompanyId = company_id;
    } catch (err) {
      return res.status(400).json({ error: 'Invalid company_id format (UUID required)' });
    }
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, role, company_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, role, company_id, created_at`,
      [email.toLowerCase().trim(), passwordHash, role, userCompanyId]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Email already registered' });
    }
    console.error('Error in user registration:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/login
 * Authenticates user credentials. Returns JWT.
 */
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const userResult = await pool.query(
      'SELECT id, email, password_hash, role, company_id FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    if (userResult.rowCount === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = userResult.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate JWT containing user ID, role, and company_id
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        company_id: user.company_id,
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    return res.status(200).json({ token });
  } catch (err) {
    console.error('Error during login:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
