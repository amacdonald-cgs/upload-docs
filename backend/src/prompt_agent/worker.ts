import amqp from 'amqplib';
import { defaultPromptService } from './service';
import { defaultOpenAiLlmProvider } // Used to check if LLM provider is available
from './llm_connector';
import { logger } from '../../util/logger';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';
const QUEUE_NAME = 'prompt_tasks_queue';
const RECONNECT_DELAY_MS = 5000; // 5 seconds

interface PromptMessage {
  promptText: string;
  requestedModel?: string;
  enhance?: boolean;
  promptId?: string;
}

/**
 * Starts the RabbitMQ worker to listen for prompt processing tasks.
 * The worker will attempt to connect to RabbitMQ and consume messages from a predefined queue.
 * It uses the `defaultPromptService` to process these messages.
 * Includes reconnection logic in case of connection failures.
 */
async function startWorker() {
  logger.info('Attempting to start Prompt Agent Worker...');

  if (!defaultOpenAiLlmProvider) {
    logger.warn('OpenAI LLM Provider is not available (likely missing OPENAI_API_KEY). Prompt Agent Worker will not start.');
    return;
  }

  if (!defaultPromptService) { // Should not happen if defaultOpenAiLlmProvider is present, but good for safety
    logger.warn('DefaultPromptService is not available. Prompt Agent Worker will not start.');
    return;
  }


  let connection: amqp.Connection | null = null;
  let channel: amqp.Channel | null = null;

  const connectAndConsume = async () => {
    try {
      logger.info(`Connecting to RabbitMQ at ${RABBITMQ_URL}...`);
      connection = await amqp.connect(RABBITMQ_URL);
      logger.info('Successfully connected to RabbitMQ.');

      connection.on('error', (err) => {
        logger.error('RabbitMQ connection error:', err);
        // Connection will be closed, leading to reconnection logic
      });

      connection.on('close', () => {
        logger.warn('RabbitMQ connection closed. Attempting to reconnect...');
        connection = null;
        channel = null;
        setTimeout(connectAndConsume, RECONNECT_DELAY_MS);
      });

      channel = await connection.createChannel();
      logger.info('RabbitMQ channel created.');

      channel.on('error', (err) => {
        logger.error('RabbitMQ channel error:', err);
        // Channel might be closed, may need to re-create or rely on connection close
      });

      channel.on('close', () => {
        logger.info('RabbitMQ channel closed.');
        channel = null;
        // If connection is still open, might try to recreate channel or let connection close handler manage.
        // For simplicity, we'll let the connection 'close' event handle full reconnection.
      });

      await channel.assertQueue(QUEUE_NAME, { durable: true });
      logger.info(`Queue '${QUEUE_NAME}' asserted successfully (durable).`);

      logger.info(`Worker is waiting for messages in queue '${QUEUE_NAME}'. To exit press CTRL+C`);

      channel.consume(QUEUE_NAME, async (msg) => {
        if (msg !== null) {
          let messagePayload: PromptMessage;
          try {
            const content = msg.content.toString();
            logger.info(`Received message from queue '${QUEUE_NAME}': ${content}`);
            messagePayload = JSON.parse(content) as PromptMessage;

            if (!messagePayload.promptText && !messagePayload.promptId) {
                 logger.error('Invalid message: promptText or promptId must be provided.');
                 channel?.nack(msg, false, false); // Discard invalid message
                 return;
            }

            logger.info('Processing message with defaultPromptService...', { payload: messagePayload });
            const result = await defaultPromptService.processPrompt(
              messagePayload.promptText,
              messagePayload.requestedModel,
              messagePayload.enhance,
              messagePayload.promptId
            );
            logger.info('Prompt processed successfully. Result:', { result });
            channel?.ack(msg);
            logger.info('Message acknowledged.');
          } catch (error) {
            logger.error('Error processing message or in prompt service:', {
              error: error instanceof Error ? error.message : error,
              stack: error instanceof Error ? error.stack : undefined,
              originalMessage: msg.content.toString()
            });
            // Reject the message without re-queueing if it's a processing error
            channel?.nack(msg, false, false);
            logger.warn('Message rejected (nack) due to processing error.');
          }
        } else {
          // This can happen if the consumer is cancelled by RabbitMQ (e.g. queue deleted)
          // or if the channel is closed.
          logger.warn('Received null message, consumer might have been cancelled or channel closed.');
        }
      }, { noAck: false }); // Manual acknowledgment

    } catch (error) {
      logger.error(`Failed to connect to RabbitMQ or setup consumer: ${error instanceof Error ? error.message : error}. Retrying in ${RECONNECT_DELAY_MS / 1000}s...`);
      if (channel) {
        try { await channel.close(); } catch (chCloseErr) { logger.error('Error closing channel during error handling:', chCloseErr); }
        channel = null;
      }
      if (connection) {
        try { await connection.close(); } catch (connCloseErr) { logger.error('Error closing connection during error handling:', connCloseErr); }
        connection = null;
      }
      setTimeout(connectAndConsume, RECONNECT_DELAY_MS);
    }
  };

  await connectAndConsume();
}

// Start the worker if dependencies are available
if (defaultOpenAiLlmProvider && defaultPromptService) {
  startWorker().catch(error => {
    logger.error('Unhandled error during worker startup or operation:', {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined
    });
    process.exit(1); // Exit if worker fails catastrophically during startup
  });
} else {
  logger.warn(
    'Prompt Agent Worker will not start. LlmProvider (OpenAI) or PromptService is not available. ' +
    'This is likely due to a missing OPENAI_API_KEY or other configuration issues.'
  );
}
