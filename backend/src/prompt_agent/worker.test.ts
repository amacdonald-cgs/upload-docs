import amqp from 'amqplib';
import { defaultPromptService } from './service';
import { defaultOpenAiLlmProvider } from './llm_connector';
import { logger } from '../../util/logger';
// Import the function to test (ensure it's exported from worker.ts)
// For this, we'll assume startWorker is exported or we test its invocation context.
// Let's assume worker.ts runs startWorker() when imported, and we can reset modules.

// Mock dependencies
jest.mock('amqplib');
const mockedAmqp = amqp as jest.Mocked<typeof amqp>;

jest.mock('./service', () => ({
  defaultPromptService: {
    processPrompt: jest.fn(),
  },
}));
const mockedDefaultPromptService = defaultPromptService as jest.Mocked<typeof defaultPromptService>;

// Mock defaultOpenAiLlmProvider from llm_connector
// We need to control its value (null or not)
let mockLlMProviderAvailable = true;
jest.mock('./llm_connector', () => ({
  get defaultOpenAiLlmProvider() { // Use a getter to dynamically provide the mock value
    return mockLlMProviderAvailable ? {} : null; // Return an object if available, null otherwise
  }
}));


jest.mock('../../util/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));
const mockedLogger = logger as jest.Mocked<typeof logger>;

// Define types for AMQP mocks
interface MockChannel {
  assertQueue: jest.Mock;
  consume: jest.Mock;
  ack: jest.Mock;
  nack: jest.Mock;
  on: jest.Mock;
  close: jest.Mock;
}
interface MockConnection {
  createChannel: jest.Mock<Promise<MockChannel>>;
  on: jest.Mock;
  close: jest.Mock;
}

describe('Prompt Agent Worker (startWorker)', () => {
  let mockChannel: MockChannel;
  let mockConnection: MockConnection;
  let consumeCallback: ((msg: amqp.ConsumeMessage | null) => Promise<void>) | null = null;

  const mockAmqpSetup = () => {
    mockChannel = {
      assertQueue: jest.fn().mockResolvedValue({ queue: 'prompt_tasks_queue' }),
      consume: jest.fn((queue, callback) => { // Capture the callback
        consumeCallback = callback;
        return Promise.resolve({ consumerTag: 'test-consumer' });
      }),
      ack: jest.fn(),
      nack: jest.fn(),
      on: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    };
    mockConnection = {
      createChannel: jest.fn().mockResolvedValue(mockChannel),
      on: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    };
     // @ts-ignore
    mockedAmqp.connect.mockResolvedValue(mockConnection as amqp.Connection);
  };
  
  const importAndRunWorker = async () => {
    // worker.ts likely calls startWorker() on import or has it as default export
    // For testing, it's better if startWorker is an explicit export we can call.
    // Assuming worker.ts exports startWorker:
    const workerModule = require('./worker');
    if (workerModule.startWorker) { // If startWorker is an exported function
        await workerModule.startWorker();
    } else { // If worker.ts executes startWorker on import (common for entry points)
        // This will execute the worker logic
    }
  };


  beforeEach(() => {
    jest.resetModules(); // Crucial for re-evaluating module-level conditions like defaultOpenAiLlmProvider check
    jest.clearAllMocks();
    jest.useFakeTimers(); // Use fake timers for setTimeout

    mockLlMProviderAvailable = true; // Default to provider being available
    mockAmqpSetup();
    consumeCallback = null; // Reset callback
    mockedDefaultPromptService.processPrompt.mockResolvedValue('Processed successfully'); // Default success
  });

  afterEach(() => {
    jest.useRealTimers(); // Restore real timers
  });

  it('should log a warning and not start if defaultOpenAiLlmProvider is null', async () => {
    mockLlMProviderAvailable = false; // Simulate LLM provider not available
    
    await importAndRunWorker();

    expect(mockedLogger.warn).toHaveBeenCalledWith('OpenAI LLM Provider is not available (likely missing OPENAI_API_KEY). Prompt Agent Worker will not start.');
    expect(mockedAmqp.connect).not.toHaveBeenCalled();
  });

  it('should connect to RabbitMQ, assert queue, and start consuming', async () => {
    await importAndRunWorker();
    
    expect(mockedAmqp.connect).toHaveBeenCalledWith(process.env.RABBITMQ_URL || 'amqp://localhost');
    expect(mockConnection.createChannel).toHaveBeenCalled();
    expect(mockChannel.assertQueue).toHaveBeenCalledWith('prompt_tasks_queue', { durable: true });
    expect(mockChannel.consume).toHaveBeenCalledWith('prompt_tasks_queue', expect.any(Function), { noAck: false });
    expect(mockedLogger.info).toHaveBeenCalledWith(`Worker is waiting for messages in queue 'prompt_tasks_queue'. To exit press CTRL+C`);
  });

  it('should attempt to reconnect if initial RabbitMQ connection fails', async () => {
    // @ts-ignore
    mockedAmqp.connect
      .mockRejectedValueOnce(new Error('Initial connection failed'))
      .mockResolvedValueOnce(mockConnection as amqp.Connection); // Second attempt succeeds

    await importAndRunWorker();

    expect(mockedAmqp.connect).toHaveBeenCalledTimes(2); // Initial + 1 retry
    expect(mockedLogger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to connect to RabbitMQ or setup consumer: Initial connection failed. Retrying in 5s...'));
    
    // Fast-forward time
    jest.advanceTimersByTime(5000);
    await Promise.resolve(); // Allow promises to resolve
    await Promise.resolve(); 
    
    expect(mockConnection.createChannel).toHaveBeenCalled(); // Check if setup proceeded after successful retry
  });
  
  describe('Message Processing within consume callback', () => {
    const validPromptMessage = { promptText: 'Hello AI' };
    const validAmqpMessage = {
        content: Buffer.from(JSON.stringify(validPromptMessage)),
        properties: {}, // Add other necessary properties if your code uses them
    } as amqp.ConsumeMessage;

    it('should process a valid message, call defaultPromptService.processPrompt, and ack', async () => {
        await importAndRunWorker(); // Sets up worker and captures consumeCallback
        expect(consumeCallback).not.toBeNull();

        if (consumeCallback) {
            await consumeCallback(validAmqpMessage);
        }

        expect(mockedDefaultPromptService.processPrompt).toHaveBeenCalledWith(
            validPromptMessage.promptText, undefined, undefined, undefined
        );
        expect(mockChannel.ack).toHaveBeenCalledWith(validAmqpMessage);
        expect(mockedLogger.info).toHaveBeenCalledWith('Prompt processed successfully. Result:', { result: 'Processed successfully' });
    });

    it('should nack (discard) message if JSON parsing fails', async () => {
        await importAndRunWorker();
        const invalidJsonMessage = { content: Buffer.from('{invalid json'), properties: {} } as amqp.ConsumeMessage;
        
        if (consumeCallback) {
            await consumeCallback(invalidJsonMessage);
        }

        expect(mockedDefaultPromptService.processPrompt).not.toHaveBeenCalled();
        expect(mockChannel.nack).toHaveBeenCalledWith(invalidJsonMessage, false, false);
        expect(mockedLogger.error).toHaveBeenCalledWith(expect.stringContaining('Error processing message or in prompt service:'), expect.anything());
    });

    it('should nack (discard) message if promptText and promptId are missing', async () => {
        await importAndRunWorker();
        const invalidPayloadMessage = { content: Buffer.from(JSON.stringify({})), properties: {} } as amqp.ConsumeMessage;

        if (consumeCallback) {
            await consumeCallback(invalidPayloadMessage);
        }
        
        expect(mockedDefaultPromptService.processPrompt).not.toHaveBeenCalled();
        expect(mockChannel.nack).toHaveBeenCalledWith(invalidPayloadMessage, false, false);
        expect(mockedLogger.error).toHaveBeenCalledWith('Invalid message: promptText or promptId must be provided.');
    });

    it('should nack (discard) message if defaultPromptService.processPrompt throws an error', async () => {
        await importAndRunWorker();
        mockedDefaultPromptService.processPrompt.mockRejectedValueOnce(new Error('Service error'));

        if (consumeCallback) {
            await consumeCallback(validAmqpMessage);
        }

        expect(mockChannel.nack).toHaveBeenCalledWith(validAmqpMessage, false, false);
        expect(mockedLogger.error).toHaveBeenCalledWith(expect.stringContaining('Error processing message or in prompt service:'), expect.objectContaining({
            error: 'Service error'
        }));
    });
    
    it('should handle null message from consume (e.g., channel closed)', async () => {
        await importAndRunWorker();
        if (consumeCallback) {
            await consumeCallback(null);
        }
        expect(mockedLogger.warn).toHaveBeenCalledWith('Received null message, consumer might have been cancelled or channel closed.');
        expect(mockChannel.ack).not.toHaveBeenCalled();
        expect(mockChannel.nack).not.toHaveBeenCalled();
    });
  });

  it('should handle RabbitMQ connection close event and attempt to reconnect', async () => {
    await importAndRunWorker(); // Initial successful connection

    // Simulate connection 'close' event
    const closeCallback = mockConnection.on.mock.calls.find(call => call[0] === 'close')?.[1];
    expect(closeCallback).toBeDefined();
    if (closeCallback) {
        closeCallback(); // Trigger the close event
    }

    expect(mockedLogger.warn).toHaveBeenCalledWith('RabbitMQ connection closed. Attempting to reconnect...');
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 5000); // Check for reconnect attempt

    // Fast-forward to trigger the reconnect
    // @ts-ignore
    mockedAmqp.connect.mockResolvedValueOnce(mockConnection as amqp.Connection); // Next attempt succeeds
    jest.advanceTimersByTime(5000);
    await Promise.resolve(); 
    await Promise.resolve(); 
    expect(mockedAmqp.connect).toHaveBeenCalledTimes(2); // Initial + 1 after close
  });
});
