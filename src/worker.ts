import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const connection = new IORedis(process.env.QUEUE_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

// Write to mock_emails.log in the project root folder (parent of compiled dist/ folder)
const logFilePath = path.join(__dirname, '../mock_emails.log');

/**
 * Appends a structured JSON log entry to mock_emails.log simulating email transmission.
 */
const appendToLog = (to: string, subject: string, body: string) => {
  const logEntry = {
    timestamp: new Date().toISOString(),
    to,
    subject,
    body,
  };
  fs.appendFileSync(logFilePath, JSON.stringify(logEntry) + '\n', 'utf8');
  console.log(`[Worker Logged Email] To: ${to} | Subject: ${subject}`);
};

// Initialize the worker daemon
const worker = new Worker(
  'emails',
  async (job) => {
    const { name, data } = job;
    console.log(`Processing job ${job.id} of type "${name}" (Attempt ${job.attemptsMade + 1})...`);

    // Simulated network/service failures (if requested in payload) to demonstrate retry reliability
    if (data.simulateFailure && job.attemptsMade < 1) {
      console.log(`[Simulated Failure] Connection dropped for job ${job.id}. Throwing error to trigger automatic backoff retry.`);
      throw new Error('Simulated email SMTP service connection timeout');
    }

    switch (name) {
      case 'send_application_received_email': {
        const { candidate_email, job_title } = data;
        if (!candidate_email || !job_title) {
          throw new Error('Missing fields in send_application_received_email payload');
        }
        appendToLog(
          candidate_email,
          `Application Received: ${job_title}`,
          `Thank you for applying for the position of ${job_title}. We have received your application and will review it shortly.`
        );
        break;
      }
      
      case 'send_new_applicant_email': {
        const { recruiter_email, job_title } = data;
        if (!recruiter_email || !job_title) {
          throw new Error('Missing fields in send_new_applicant_email payload');
        }
        appendToLog(
          recruiter_email,
          `New Applicant: ${job_title}`,
          `A new candidate has submitted an application for the position of ${job_title}. Please review it in the ATS.`
        );
        break;
      }

      case 'send_stage_update_email': {
        const { candidate_email, new_stage, job_title } = data;
        if (!candidate_email || !new_stage || !job_title) {
          throw new Error('Missing fields in send_stage_update_email payload');
        }
        appendToLog(
          candidate_email,
          `Application Stage Updated: ${job_title}`,
          `Your application for ${job_title} has been moved to the stage: ${new_stage}.`
        );
        break;
      }

      default:
        console.warn(`Unknown job name encountered: ${name}`);
        throw new Error(`Unknown job type: ${name}`);
    }
  },
  { connection }
);

worker.on('ready', () => {
  console.log('Worker daemon is ready and listening for jobs from Redis queue...');
});

worker.on('completed', (job) => {
  console.log(`Job ${job.id} (${job.name}) completed successfully.`);
});

worker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} (${job?.name}) failed: ${err.message}`);
});
