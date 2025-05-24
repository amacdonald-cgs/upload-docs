import express, { Router, Request, Response, NextFunction, Application } from 'express';
import amqp from 'amqplib';
import { logger } from '../../util/logger';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';
const QUEUE_NAME = 'prompt_tasks_queue'; // Same queue as the worker consumes from
const RECONNECT_DELAY_MS = 5000; // 5 seconds for reconnection attempts

let rabbitConnection: amqp.Connection | null = null;
let rabbitChannel: amqp.Channel | null = null;

const router: Router = Router();

/**
 * @interface PromptRequestPayload
 * Defines the expected structure for the prompt submission request body.
 */
interface PromptRequestPayload {
  promptText?: string;
  requestedModel?: string;
  enhance?: boolean;
  promptId?: string;
}

/**
 * Attempts to connect to RabbitMQ and create a channel.
 * Sets the global `rabbitConnection` and `rabbitChannel` variables.
 * Includes retry logic for connection establishment.
 */
async function connectToRabbitMQ(): Promise<void> {
  try {
    logger.info(`Attempting to connect to RabbitMQ at ${RABBITMQ_URL} for API routes...`);
    rabbitConnection = await amqp.connect(RABBITMQ_URL);
    logger.info('Successfully connected to RabbitMQ for API routes.');

    rabbitConnection.on('error', (err) => {
      logger.error('RabbitMQ connection error (API routes):', err);
      rabbitChannel = null; // Channel is no longer valid
      rabbitConnection = null; // Connection is no longer valid
      // Reconnection will be attempted if a request comes in or by a background retry mechanism (not implemented here for simplicity)
    });

    rabbitConnection.on('close', () => {
      logger.warn('RabbitMQ connection closed (API routes). Will attempt to reconnect on next request or periodically.');
      rabbitChannel = null;
      rabbitConnection = null;
      // Simple retry mechanism: try to reconnect after a delay
      // More robust would be needed for production (e.g. exponential backoff)
      setTimeout(connectToRabbitMQ, RECONNECT_DELAY_MS);
    });

    rabbitChannel = await rabbitConnection.createChannel();
    logger.info('RabbitMQ channel created successfully for API routes.');

    // Ensure the queue exists, so messages can be published even if worker starts later
    await rabbitChannel.assertQueue(QUEUE_NAME, { durable: true });
    logger.info(`Queue '${QUEUE_NAME}' asserted by API router.`);

  } catch (error) {
    logger.error(`Failed to connect to RabbitMQ for API routes: ${error instanceof Error ? error.message : error}`);
    rabbitChannel = null;
    rabbitConnection = null;
    logger.info(`Retrying RabbitMQ connection in ${RECONNECT_DELAY_MS / 1000}s...`);
    setTimeout(connectToRabbitMQ, RECONNECT_DELAY_MS); // Retry connection
  }
}

/**
 * Initializes and mounts the prompt agent API routes.
 * Establishes a connection to RabbitMQ for publishing prompt tasks.
 * @param app - The Express application instance.
 */
export async function initializePromptRoutes(app: Application): Promise<void> {
  await connectToRabbitMQ(); // Establish initial connection

  /**
   * @route POST /api/prompts/submit
   * Submits a new prompt processing request.
   * The request is validated and then published to a RabbitMQ queue for asynchronous processing.
   * @handler
   * @param {Request<any, any, PromptRequestPayload>} req - Express request object.
   * @param {Response} res - Express response object.
   * @returns {Promise<void>}
   */
  router.post('/submit', async (req: Request<any, any, PromptRequestPayload>, res: Response) => {
    const { promptText, requestedModel, enhance, promptId } = req.body;

    logger.info('Received POST /submit request with payload:', req.body);

    if (!promptText && !promptId) {
      logger.warn('Invalid request to /submit: promptText or promptId is required.');
      return res.status(400).json({ error: 'Either promptText or promptId must be provided.' });
    }

    if (!rabbitChannel || !rabbitConnection || rabbitConnection.connection === null) { // Check connection health
      logger.error('RabbitMQ channel not available. Cannot publish message. Attempting to reconnect...');
      // Attempt to reconnect immediately for the next request.
      // A robust system might queue requests locally or have a more sophisticated retry.
      if (!rabbitConnection || rabbitConnection.connection === null) { // only try to connect if not already connecting
          connectToRabbitMQ().catch(err => logger.error("Error during manual reconnect attempt", err));
      }
      return res.status(503).json({ error: 'Service temporarily unavailable. Please try again later.' });
    }

    const message: PromptRequestPayload = {
      promptText,
      requestedModel,
      enhance,
      promptId,
    };

    try {
      // Assert queue again just in case it was deleted, or channel re-established.
      await rabbitChannel.assertQueue(QUEUE_NAME, { durable: true });
      const success = rabbitChannel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(message)), { persistent: true });

      if (success) {
        logger.info(`Message successfully published to queue '${QUEUE_NAME}':`, message);
        return res.status(202).json({ message: 'Prompt request received and is being processed.' });
      } else {
        logger.error(`Failed to publish message to queue '${QUEUE_NAME}' due to full buffer or channel error. Payload:`, message);
        // This case means the write buffer is full. Client should retry.
        return res.status(503).json({ error: 'Service temporarily overloaded. Please try again.' });
      }
    } catch (error) {
      logger.error(`Error publishing message to RabbitMQ or asserting queue: ${error instanceof Error ? error.message : error}`, { payload: message });
      // If error occurs, channel might be broken. Connection close handler should deal with it.
      return res.status(500).json({ error: 'Failed to publish prompt request due to an internal error.' });
    }
  });

  app.use('/api/prompts', router);
  logger.info('Prompt agent API routes initialized and mounted to /api/prompts.');
}
