import OpenAI from 'openai';
import { OpenAiLlmProvider } from './llm_connector';
import { logger } from '../../util/logger'; // To mock its methods

// Mock the OpenAI library
jest.mock('openai');
const mockedOpenAI = OpenAI as jest.MockedClass<typeof OpenAI>;
const mockCreateCompletion = jest.fn();

// Mock the logger
jest.mock('../../util/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));
const mockedLogger = logger as jest.Mocked<typeof logger>;


describe('OpenAiLlmProvider', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules(); // Clears the cache, necessary for testing env variable effects on module import
    process.env = { ...OLD_ENV }; // Make a copy
    mockCreateCompletion.mockReset();
    mockedLogger.warn.mockClear();
    mockedLogger.info.mockClear();
    mockedLogger.error.mockClear();

    // Setup the mock for the OpenAI client constructor and methods
    // @ts-ignore
    mockedOpenAI.mockImplementation(() => {
      return {
        chat: {
          completions: {
            create: mockCreateCompletion,
          },
        },
      };
    });
  });

  afterAll(() => {
    process.env = OLD_ENV; // Restore old environment
  });

  describe('constructor', () => {
    it('should initialize with API key from argument', () => {
      const provider = new OpenAiLlmProvider('test_api_key_arg');
      expect(provider).toBeInstanceOf(OpenAiLlmProvider);
      expect(mockedOpenAI).toHaveBeenCalledWith({ apiKey: 'test_api_key_arg' });
    });

    it('should initialize with API key from environment variable if no argument is provided', () => {
      process.env.OPENAI_API_KEY = 'test_api_key_env';
      const provider = new OpenAiLlmProvider();
      expect(provider).toBeInstanceOf(OpenAiLlmProvider);
      expect(mockedOpenAI).toHaveBeenCalledWith({ apiKey: 'test_api_key_env' });
    });

    it('should prioritize API key from argument over environment variable', () => {
      process.env.OPENAI_API_KEY = 'test_api_key_env';
      const provider = new OpenAiLlmProvider('test_api_key_arg_priority');
      expect(provider).toBeInstanceOf(OpenAiLlmProvider);
      expect(mockedOpenAI).toHaveBeenCalledWith({ apiKey: 'test_api_key_arg_priority' });
    });

    it('should throw error if API key is not provided in arg or environment', () => {
      delete process.env.OPENAI_API_KEY;
      expect(() => new OpenAiLlmProvider()).toThrow('OpenAI API key is not provided and not found in OPENAI_API_KEY environment variable.');
    });
  });

  describe('generateCompletion', () => {
    let provider: OpenAiLlmProvider;

    beforeEach(() => {
      provider = new OpenAiLlmProvider('test_api_key'); // Initialize with a dummy key for these tests
    });

    it('should return completion content on successful API call', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Test completion' } }],
      };
      mockCreateCompletion.mockResolvedValue(mockResponse);

      const completion = await provider.generateCompletion('Test prompt');
      expect(completion).toBe('Test completion');
      expect(mockCreateCompletion).toHaveBeenCalledWith({
        model: 'gpt-3.5-turbo', // Default model
        messages: [{ role: 'user', content: 'Test prompt' }],
      });
    });

    it('should use the specified model if provided', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Test completion with custom model' } }],
      };
      mockCreateCompletion.mockResolvedValue(mockResponse);

      await provider.generateCompletion('Test prompt', 'gpt-4');
      expect(mockCreateCompletion).toHaveBeenCalledWith({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Test prompt' }],
      });
    });

    it('should throw error if API returns empty or unexpected response', async () => {
      const mockResponse = { choices: [{ message: { content: null } }] };
      mockCreateCompletion.mockResolvedValue(mockResponse);

      await expect(provider.generateCompletion('Test prompt')).rejects.toThrow('OpenAI API returned an empty or unexpected response.');
      expect(mockedLogger.error).toHaveBeenCalled();
    });
    
    it('should throw an error if choices array is empty or undefined', async () => {
      mockCreateCompletion.mockResolvedValue({ choices: [] });
      await expect(provider.generateCompletion('Test prompt')).rejects.toThrow('OpenAI API returned an empty or unexpected response.');

      mockCreateCompletion.mockResolvedValue({}); // choices is undefined
       await expect(provider.generateCompletion('Test prompt')).rejects.toThrow('OpenAI API returned an empty or unexpected response.');
    });


    it('should throw error and log if API call fails', async () => {
      const apiError = new Error('OpenAI API Error');
      mockCreateCompletion.mockRejectedValue(apiError);

      await expect(provider.generateCompletion('Test prompt')).rejects.toThrow('OpenAI API request failed: OpenAI API Error');
      expect(mockedLogger.error).toHaveBeenCalledWith('Error generating completion from OpenAI:', {
        message: 'OpenAI API Error',
        stack: apiError.stack,
        details: apiError,
      });
    });

    it('should throw a generic error if API call fails with a non-Error object', async () => {
        mockCreateCompletion.mockRejectedValue("some string error"); // Non-Error object
        await expect(provider.generateCompletion('Test prompt')).rejects.toThrow('OpenAI API request failed with an unknown error.');
        expect(mockedLogger.error).toHaveBeenCalledWith('Error generating completion from OpenAI:', {
            message: "some string error",
            stack: undefined,
            details: "some string error",
        });
    });
  });
});

describe('defaultOpenAiLlmProvider Initialization', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules(); // This is key to re-evaluate module imports
    process.env = { ...OLD_ENV };
    mockedLogger.warn.mockClear();
    mockedLogger.info.mockClear();
     // Setup the mock for the OpenAI client constructor for these tests too
    // @ts-ignore
    mockedOpenAI.mockImplementation(() => {
      return {
        chat: {
          completions: {
            create: mockCreateCompletion,
          },
        },
      };
    });
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('should initialize defaultOpenAiLlmProvider if OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'env_key_for_default_provider';
    // Dynamically import after setting env var
    const { defaultOpenAiLlmProvider } = require('./llm_connector');
    expect(defaultOpenAiLlmProvider).toBeInstanceOf(OpenAiLlmProvider);
    expect(mockedLogger.info).toHaveBeenCalledWith('Default OpenAiLlmProvider initialized successfully.');
  });

  it('should set defaultOpenAiLlmProvider to null and log warning if OPENAI_API_KEY is not set', () => {
    delete process.env.OPENAI_API_KEY;
     // Dynamically import after unsetting env var
    const { defaultOpenAiLlmProvider } = require('./llm_connector');
    expect(defaultOpenAiLlmProvider).toBeNull();
    expect(mockedLogger.warn).toHaveBeenCalledWith('OPENAI_API_KEY environment variable not set. Default OpenAiLlmProvider will not be available.');
  });
  
  it('should log a warning if OpenAiLlmProvider constructor throws during default instance creation', () => {
    process.env.OPENAI_API_KEY = 'some_key'; // Key is present
     // @ts-ignore
    mockedOpenAI.mockImplementation(() => { // Mock constructor to throw
      throw new Error("Constructor failed");
    });

    const { defaultOpenAiLlmProvider } = require('./llm_connector');
    expect(defaultOpenAiLlmProvider).toBeNull(); // It should be null because initialization failed
    expect(mockedLogger.warn).toHaveBeenCalledWith('Failed to initialize Default OpenAiLlmProvider:', {
        message: 'Constructor failed',
        stack: expect.any(String), // Error object will have a stack
    });
  });
});
