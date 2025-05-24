import express, { Application } from 'express';
import request from 'supertest';
import amqp from 'amqplib';
import { logger } from '../../util/logger';
import { initializePromptRoutes } from './routes'; // The module to test

// Mock amqplib
jest.mock('amqplib');
const mockedAmqp = amqp as jest.Mocked<typeof amqp>;

// Mock logger
jest.mock('../../util/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));
const mockedLogger = logger as jest.Mocked<typeof logger>;

// Define a type for the channel mock if not already available from amqplib types
interface MockChannel {
  assertQueue: jest.Mock;
  sendToQueue: jest.Mock;
  close?: jest.Mock;
  on?: jest.Mock;
}
interface MockConnection {
    createChannel: jest.Mock<Promise<MockChannel>>;
    close?: jest.Mock;
    on?: jest.Mock;
    connection?: any; // for health check in routes.ts
}


describe('Prompt Agent API Routes', () => {
  let app: Application;
  let mockChannel: MockChannel;
  let mockConnection: MockConnection;

  beforeEach(async () => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json()); // Middleware to parse JSON bodies

    // Setup mocks for amqplib
    mockChannel = {
      assertQueue: jest.fn().mockResolvedValue({ queue: 'prompt_tasks_queue' }),
      sendToQueue: jest.fn().mockReturnValue(true), // Simulate successful send
      on: jest.fn(), // Mock 'on' method for error/close events
      close: jest.fn().mockResolvedValue(undefined),
    };
    mockConnection = {
      createChannel: jest.fn().mockResolvedValue(mockChannel),
      on: jest.fn(), // Mock 'on' method for error/close events
      close: jest.fn().mockResolvedValue(undefined),
      connection: { s Froome: 'mock' } // Simulate an active connection object for health check
    };
    // @ts-ignore
    mockedAmqp.connect.mockResolvedValue(mockConnection as amqp.Connection);

    // Initialize routes on the test app
    // Need to reset modules to allow routes to re-initialize its RabbitMQ connection state
    // This is because rabbitConnection and rabbitChannel are module-level variables in routes.ts
    jest.resetModules(); 
    const routesModule = require('./routes'); // Re-import after reset
    await routesModule.initializePromptRoutes(app);
  });

  describe('POST /api/prompts/submit', () => {
    const validPayload = { promptText: 'Test prompt' };

    it('should return 202 and publish message on valid request', async () => {
      const response = await request(app)
        .post('/api/prompts/submit')
        .send(validPayload);

      expect(response.status).toBe(202);
      expect(response.body.message).toBe('Prompt request received and is being processed.');
      expect(mockChannel.assertQueue).toHaveBeenCalledWith('prompt_tasks_queue', { durable: true });
      expect(mockChannel.sendToQueue).toHaveBeenCalledWith(
        'prompt_tasks_queue',
        Buffer.from(JSON.stringify(validPayload)),
        { persistent: true }
      );
      expect(mockedLogger.info).toHaveBeenCalledWith('Message successfully published to queue \'prompt_tasks_queue\':', validPayload);
    });

    it('should return 400 if both promptText and promptId are missing', async () => {
      const response = await request(app)
        .post('/api/prompts/submit')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Either promptText or promptId must be provided.');
      expect(mockChannel.sendToQueue).not.toHaveBeenCalled();
    });
    
    it('should accept request if only promptId is provided', async () => {
        const payloadWithId = { promptId: 'test_id' };
        const response = await request(app)
            .post('/api/prompts/submit')
            .send(payloadWithId);
        
        expect(response.status).toBe(202);
        expect(mockChannel.sendToQueue).toHaveBeenCalledWith(
            'prompt_tasks_queue',
            Buffer.from(JSON.stringify(payloadWithId)),
            { persistent: true }
        );
    });

    it('should return 503 if RabbitMQ channel is not available', async () => {
      // To simulate channel not available, we can make connect throw an error initially
      jest.resetModules();
      const routesModuleFresh = require('./routes');
      // @ts-ignore
      mockedAmqp.connect.mockRejectedValueOnce(new Error('RabbitMQ connection failed'));
      
      const newApp = express();
      newApp.use(express.json());
      await routesModuleFresh.initializePromptRoutes(newApp); // This will fail to set up channel

      const response = await request(newApp)
        .post('/api/prompts/submit')
        .send(validPayload);
      
      // It might initially log error about connection, then on POST it will hit the "channel not available"
      // The first attempt to connect in initializePromptRoutes will fail and schedule a retry.
      // The POST request handler will then find rabbitChannel to be null.
      expect(response.status).toBe(503);
      expect(response.body.error).toBe('Service temporarily unavailable. Please try again later.');
      expect(mockedLogger.error).toHaveBeenCalledWith('RabbitMQ channel not available. Cannot publish message. Attempting to reconnect...');
    });

    it('should return 503 if sendToQueue returns false (buffer full)', async () => {
      mockChannel.sendToQueue.mockReturnValueOnce(false); // Simulate buffer full

      const response = await request(app)
        .post('/api/prompts/submit')
        .send(validPayload);

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('Service temporarily overloaded. Please try again.');
      expect(mockedLogger.error).toHaveBeenCalledWith(
        `Failed to publish message to queue 'prompt_tasks_queue' due to full buffer or channel error. Payload:`,
        validPayload
      );
    });

    it('should return 500 if sendToQueue throws an error', async () => {
      const publishError = new Error('Publishing failed');
      mockChannel.sendToQueue.mockImplementationOnce(() => {
        throw publishError;
      });

      const response = await request(app)
        .post('/api/prompts/submit')
        .send(validPayload);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to publish prompt request due to an internal error.');
      expect(mockedLogger.error).toHaveBeenCalledWith(
        `Error publishing message to RabbitMQ or asserting queue: ${publishError.message}`,
        { payload: validPayload }
      );
    });
  });
  
  describe('initializePromptRoutes RabbitMQ connection', () => {
    beforeEach(() => {
        jest.resetModules(); // Ensure a fresh state for module-level variables in routes.ts
    });

    it('should log success and setup channel when RabbitMQ connection is successful', async () => {
        const tempApp = express();
        // @ts-ignore
        mockedAmqp.connect.mockResolvedValueOnce(mockConnection as amqp.Connection); 
        const routesModule = require('./routes');
        await routesModule.initializePromptRoutes(tempApp);

        expect(mockedAmqp.connect).toHaveBeenCalledWith(process.env.RABBITMQ_URL || 'amqp://localhost');
        expect(mockConnection.createChannel).toHaveBeenCalled();
        expect(mockChannel.assertQueue).toHaveBeenCalledWith('prompt_tasks_queue', { durable: true });
        expect(mockedLogger.info).toHaveBeenCalledWith('Successfully connected to RabbitMQ for API routes.');
        expect(mockedLogger.info).toHaveBeenCalledWith('RabbitMQ channel created successfully for API routes.');
    });

    it('should log error and schedule retry if RabbitMQ connection fails initially', async () => {
        jest.useFakeTimers(); // Use fake timers for setTimeout
        const tempApp = express();
        const connectionError = new Error('Initial connection failed');
        // @ts-ignore
        mockedAmqp.connect.mockRejectedValueOnce(connectionError);
        
        const routesModule = require('./routes');
        await routesModule.initializePromptRoutes(tempApp); // Should not throw, but handle error

        expect(mockedAmqp.connect).toHaveBeenCalledTimes(1); // Initial attempt
        expect(mockedLogger.error).toHaveBeenCalledWith(`Failed to connect to RabbitMQ for API routes: ${connectionError.message}`);
        expect(mockedLogger.info).toHaveBeenCalledWith(`Retrying RabbitMQ connection in 5s...`);
        
        // Fast-forward time to trigger the retry
        // @ts-ignore
        mockedAmqp.connect.mockResolvedValueOnce(mockConnection as amqp.Connection); // Next attempt succeeds
        jest.advanceTimersByTime(5000);
        
        // Wait for promises from setTimeout to resolve
        await Promise.resolve(); 
        await Promise.resolve(); // Additional ticks for chained promises if any

        expect(mockedAmqp.connect).toHaveBeenCalledTimes(2); // Second attempt
        expect(mockedLogger.info).toHaveBeenCalledWith('Successfully connected to RabbitMQ for API routes.');
        
        jest.useRealTimers(); // Restore real timers
    });
  });
});
