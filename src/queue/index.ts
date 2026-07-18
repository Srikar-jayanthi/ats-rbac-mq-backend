import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import * as dotenv from 'dotenv';

dotenv.config();

const connection = new IORedis(process.env.QUEUE_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null, // Required by BullMQ
});

// Define the emails queue
export const emailQueue = new Queue('emails', { connection });

/**
 * Enqueues a notification job in the Redis-backed BullMQ message queue.
 * Configured with automatic exponential backoff retries.
 * 
 * @param name Name of the task (e.g. 'send_application_received_email')
 * @param data Job payload (emails, job titles, status stages, etc.)
 */
export const enqueueEmail = async (name: string, data: any): Promise<void> => {
  try {
    await emailQueue.add(name, data, {
      attempts: 3, // Retry up to 3 times on failure
      backoff: {
        type: 'exponential',
        delay: 1000, // Wait 1s, then 2s, then 4s...
      },
    });
    console.log(`Successfully enqueued job: ${name}`);
  } catch (error) {
    console.error(`Failed to enqueue job ${name} into Redis:`, error);
    throw error; // Re-throw so route handlers can fail gracefully with 500
  }
};
