import { LlmProvider, defaultOpenAiLlmProvider } from './llm_connector';
import { getPromptByName } from '../../db'; 
import { logger } from '../../util/logger'; 

// Mock dependencies
jest.mock('./llm_connector', () => ({
  defaultOpenAiLlmProvider: { // This is the actual instance used by PromptService
    generateCompletion: jest.fn(),
  },
  // LlmProvider is an interface, so it doesn't need a mock implementation for instantiation,
  // but can be useful for type casting if needed.
  LlmProvider: jest.fn(), 
}));

jest.mock('../../db', () => ({
  getPromptByName: jest.fn(),
  // Mock other DB functions if PromptService were to use them (e.g., createPrompt)
}));

jest.mock('../../util/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Import the class to be tested AFTER mocks are set up
import { PromptService } from './service'; 

// Typecast mocks for easier use with TypeScript
const mockedLlmProviderInstance = defaultOpenAiLlmProvider as jest.Mocked<LlmProvider>;
const mockedGetPromptByName = getPromptByName as jest.MockedFunction<typeof getPromptByName>;
const mockedLogger = logger as jest.Mocked<typeof logger>;


describe('PromptService', () => {
  let promptService: PromptService;

  beforeEach(() => {
    jest.clearAllMocks();
    // PromptService in service.ts is new PromptService(defaultOpenAiLlmProvider)
    // So, to test its constructor behavior with a null provider, we'd have to manipulate the mocked defaultOpenAiLlmProvider
    // For these tests, we'll assume defaultOpenAiLlmProvider is the one injected.
    // To test the null provider case for the constructor, we'd need to re-import PromptService or structure differently.
    // The current service.ts directly news up defaultPromptService with the imported defaultOpenAiLlmProvider.
    // For now, we test the instance that would be created by the module.
    promptService = new PromptService(mockedLlmProviderInstance); 
  });

  describe('constructor', () => {
    // Note: Testing the constructor's logging when llmProvider is null is tricky 
    // because defaultPromptService in service.ts is initialized at module load.
    // We'd typically test this by controlling the arguments to `new PromptService()`.
    // The current setup tests the `defaultPromptService` instance's creation implicitly.
    // A separate test suite for defaultPromptService initialization could be made if needed.
    it('should initialize with the default LlmProvider', () => {
      expect(promptService).toBeInstanceOf(PromptService);
      // If mockedLlmProviderInstance was valid, no warning.
      // If we want to test the warning, we'd need to ensure mockedLlmProviderInstance is null when service.ts is loaded.
    });

    it('should log a warning if constructed with a null LlmProvider', () => {
      // This test specifically tests the constructor logic, not the default instance from service.ts
      const serviceWithNullProvider = new PromptService(null);
      expect(serviceWithNullProvider).toBeInstanceOf(PromptService);
      expect(mockedLogger.warn).toHaveBeenCalledWith('PromptService initialized without a valid LlmProvider. Completions will not be available.');
    });
  });

  describe('processPrompt', () => {
    const basePromptText = 'Test prompt text';
    const dbPrompt = {
      id: 1,
      name: 'db_prompt_name', // Use a distinct name
      prompt_text: 'Database prompt text.',
      model_provider: 'openai',
      model_name: 'gpt-from-db', // Distinct model name
      created_at: new Date(),
    };

    beforeEach(() => {
      mockedLlmProviderInstance.generateCompletion.mockResolvedValue('LLM completion');
      mockedGetPromptByName.mockResolvedValue(null); 
    });

    it('should process with direct promptText if no promptId is provided', async () => {
      await promptService.processPrompt(basePromptText);
      expect(mockedLlmProviderInstance.generateCompletion).toHaveBeenCalledWith(basePromptText, 'gpt-3.5-turbo');
      expect(mockedGetPromptByName).not.toHaveBeenCalled();
    });

    it('should use prompt from database if promptId is found, and use its model', async () => {
      mockedGetPromptByName.mockResolvedValue(dbPrompt);
      await promptService.processPrompt('', undefined, false, dbPrompt.name); // promptText is empty, no requestedModel
      expect(mockedLlmProviderInstance.generateCompletion).toHaveBeenCalledWith(dbPrompt.prompt_text, dbPrompt.model_name);
      expect(mockedGetPromptByName).toHaveBeenCalledWith(dbPrompt.name);
    });

    it('should append promptText to database prompt text if both are provided', async () => {
      mockedGetPromptByName.mockResolvedValue(dbPrompt);
      const appendedText = `${dbPrompt.prompt_text} ${basePromptText}`;
      await promptService.processPrompt(basePromptText, undefined, false, dbPrompt.name);
      expect(mockedLlmProviderInstance.generateCompletion).toHaveBeenCalledWith(appendedText, dbPrompt.model_name); 
    });
    
    it('should override database model_name with requestedModel if provided', async () => {
      mockedGetPromptByName.mockResolvedValue(dbPrompt);
      await promptService.processPrompt('', 'user_requested_model', false, dbPrompt.name);
      expect(mockedLlmProviderInstance.generateCompletion).toHaveBeenCalledWith(dbPrompt.prompt_text, 'user_requested_model');
    });

    it('should use provided promptText if promptId is not found in database', async () => {
      mockedGetPromptByName.mockResolvedValue(null);
      await promptService.processPrompt(basePromptText, undefined, false, 'unfound_prompt_id');
      expect(mockedLlmProviderInstance.generateCompletion).toHaveBeenCalledWith(basePromptText, 'gpt-3.5-turbo');
      expect(mockedLogger.warn).toHaveBeenCalledWith(`Prompt name 'unfound_prompt_id' not found in database library. Using provided promptText if available.`);
    });

    it('should throw error if promptId is not found and no promptText is provided', async () => {
      mockedGetPromptByName.mockResolvedValue(null);
      await expect(promptService.processPrompt('', undefined, false, 'unfound_prompt_id'))
        .rejects.toThrow(`Prompt name 'unfound_prompt_id' not found in database and no fallback promptText provided.`);
    });
    
    it('should throw error if neither promptId nor non-empty promptText is provided', async () => {
      await expect(promptService.processPrompt('', undefined, false, undefined))
        .rejects.toThrow('Cannot process prompt: Neither promptId nor promptText was provided.');
    });

    it('should apply enhancement string if enhance is true', async () => {
      const enhancementSuffix = "\n\nProvide a detailed and comprehensive response. Ensure clarity and accuracy.";
      await promptService.processPrompt(basePromptText, undefined, true);
      expect(mockedLlmProviderInstance.generateCompletion).toHaveBeenCalledWith(basePromptText + enhancementSuffix, 'gpt-3.5-turbo');
      expect(mockedLogger.info).toHaveBeenCalledWith('Prompt enhancement applied.');
    });

    it('should throw error if LlmProvider is not available (explicitly set to null for this test)', async () => {
      const serviceWithNullProvider = new PromptService(null); // Test this specific scenario
      await expect(serviceWithNullProvider.processPrompt(basePromptText))
        .rejects.toThrow('LlmProvider is not available. Cannot process prompt.');
    });

    it('should throw error if llmProvider.generateCompletion fails', async () => {
      mockedLlmProviderInstance.generateCompletion.mockRejectedValue(new Error('LLM API Error'));
      await expect(promptService.processPrompt(basePromptText))
        .rejects.toThrow('Failed to process prompt and generate completion: LLM API Error');
    });
    
    it('should throw a specific error if getPromptByName fails and no fallback promptText', async () => {
        const dbError = new Error('Database connection failed');
        mockedGetPromptByName.mockRejectedValue(dbError);
        // No promptText is provided, so it relies on DB
        await expect(promptService.processPrompt('', undefined, false, 'any_prompt_id'))
            .rejects.toThrow(`Failed to process prompt and generate completion: Failed to retrieve prompt 'any_prompt_id' from database and no fallback promptText provided.`);
        expect(mockedLogger.error).toHaveBeenCalledWith(`Error retrieving prompt 'any_prompt_id' from database: ${dbError.message}. Proceeding with provided promptText if available.`);
    });
    
    it('should proceed with promptText if getPromptByName fails but promptText is available', async () => {
        const dbError = new Error('Database connection failed');
        mockedGetPromptByName.mockRejectedValue(dbError);
        await promptService.processPrompt(basePromptText, undefined, false, 'any_prompt_id');
        expect(mockedLlmProviderInstance.generateCompletion).toHaveBeenCalledWith(basePromptText, 'gpt-3.5-turbo');
        expect(mockedLogger.error).toHaveBeenCalledWith(`Error retrieving prompt 'any_prompt_id' from database: ${dbError.message}. Proceeding with provided promptText if available.`);
    });


    it('should throw error if final prompt text is empty string after processing', async () => {
      const emptyDbPrompt = { ...dbPrompt, prompt_text: "" };
      mockedGetPromptByName.mockResolvedValue(emptyDbPrompt);
      await expect(promptService.processPrompt('', undefined, false, 'empty_db_prompt')) // No input promptText, DB prompt_text is empty
        .rejects.toThrow("Final prompt text is empty or whitespace. Cannot send to LLM.");
    });

    it('should throw error if final prompt text is only whitespace after processing', async () => {
      const whitespaceDbPrompt = { ...dbPrompt, prompt_text: "   \t   " };
      mockedGetPromptByName.mockResolvedValue(whitespaceDbPrompt);
      await expect(promptService.processPrompt('', undefined, false, 'whitespace_db_prompt'))
        .rejects.toThrow("Final prompt text is empty or whitespace. Cannot send to LLM.");
    });
  });
});
