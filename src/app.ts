import express, { Request, Response, NextFunction } from 'express';
import authRouter from './routes/auth';
import jobsRouter from './routes/jobs';
import applicationsRouter from './routes/applications';

const app = express();

app.use(express.json());

// Mount API Routers
app.use('/api/auth', authRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/applications', applicationsRouter);

// Basic Health Check Route
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', timestamp: new Date() });
});

// Fallback for 404 NotFound
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global Error Handler Middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled Application Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
