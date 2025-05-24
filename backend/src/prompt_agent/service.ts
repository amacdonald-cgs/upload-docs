import { LlmProvider, defaultOpenAiLlmProvider } from './llm_connector';
import { getPromptByName } from '../../db'; // Import for database prompt library
import { logger } from '../../util/logger'; // For more detailed logging

/**
 * @class PromptService
 * Orchestrates prompt processing, enhancement, and interaction with an LLM provider.
 */
export class PromptService {
  private llmProvider: LlmProvider | null;

  /**
   * Creates an instance of PromptService.
   * @param llmProvider - An instance of LlmProvider to use for generating completions. Can be null if provider is not available.
   */
  constructor(llmProvider: LlmProvider | null) {
    this.llmProvider = llmProvider;
    if (!this.llmProvider) {
      console.warn('PromptService initialized without a valid LlmProvider. Completions will not be available.');
    }
  }

  /**
   * Processes a given prompt, optionally enhances it, and generates a completion using the LLM provider.
   * @param promptText - The primary text for the prompt if no `promptId` is used or found, or to be appended to a library prompt.
   * @param requestedModel - (Optional) The specific LLM model to be used. Overrides model from database prompt if `promptId` is used.
   * @param enhance - (Optional) Whether to apply basic enhancement to the prompt. Defaults to false.
   * @param promptId - (Optional) The unique `name` of a predefined prompt from the database library.
   * @returns A promise that resolves to the LLM's completion as a string.
   * @throws Error if the LlmProvider is not available, if the prompt cannot be determined, or if the completion generation fails.
   */
  async processPrompt(
    promptText: string,
    requestedModel?: string,
    enhance: boolean = false,
    promptId?: string
  ): Promise<string> {
    console.info(`Processing prompt: promptId='${promptId}', enhance=${enhance}, requestedModel='${requestedModel}'`);

    if (!this.llmProvider) {
      const errorMessage = 'LlmProvider is not available. Cannot process prompt.';
      console.error(errorMessage);
      throw new Error(errorMessage);
    }

    let currentPromptText = promptText; // Default to using the provided promptText
    let modelToUse = requestedModel || 'gpt-3.5-turbo'; // Default model

    if (promptId) {
      logger.info(`Attempting to retrieve prompt from database with name (promptId): '${promptId}'`);
      try {
        const dbPrompt = await getPromptByName(promptId);
        if (dbPrompt) {
          currentPromptText = dbPrompt.prompt_text + (promptText ? ` ${promptText}` : ''); // Append original promptText if library prompt is a prefix and promptText is also provided
          logger.info(`Using prompt_text from database for prompt name '${promptId}'. Original promptText (if any) was appended.`);

          // Use model from DB if not overridden in request
          if (dbPrompt.model_name && !requestedModel) {
            modelToUse = dbPrompt.model_name;
            logger.info(`Using model_name '${modelToUse}' from database prompt '${promptId}'.`);
          }
          // Potentially use dbPrompt.model_provider here if your LlmProvider selection logic supports it
        } else {
          logger.warn(`Prompt name '${promptId}' not found in database library. Using provided promptText if available.`);
          if (!promptText) { // If no DB prompt and no explicit promptText, this is an issue.
            throw new Error(`Prompt name '${promptId}' not found in database and no fallback promptText provided.`);
          }
        }
      } catch (dbError) {
        logger.error(`Error retrieving prompt '${promptId}' from database: ${dbError instanceof Error ? dbError.message : dbError}. Proceeding with provided promptText if available.`);
        if (!promptText) {
           throw new Error(`Failed to retrieve prompt '${promptId}' from database and no fallback promptText provided.`);
        }
      }
    } else if (!promptText) {
        // If neither promptId nor promptText is provided, it's an invalid request for this service.
        // The routes.ts should ideally validate this, but an extra check here is good.
        const errorMessage = 'Cannot process prompt: Neither promptId nor promptText was provided.';
        logger.error(errorMessage);
        throw new Error(errorMessage);
    }


    if (enhance) {
      currentPromptText += "\n\nProvide a detailed and comprehensive response. Ensure clarity and accuracy.";
      logger.info('Prompt enhancement applied.');
    }

    logger.info(`Selected LLM model: '${modelToUse}'.`);
    logger.info(`Final prompt being sent to LLM: "${currentPromptText}"`);

    try {
      // Ensure currentPromptText is not empty or just whitespace before sending
      if (!currentPromptText || currentPromptText.trim() === "") {
          const errorMsg = "Final prompt text is empty or whitespace. Cannot send to LLM.";
          logger.error(errorMsg);
          throw new Error(errorMsg);
      }
      const completion = await this.llmProvider.generateCompletion(currentPromptText, modelToUse);
      logger.info('Prompt processed and completion received successfully.');
      return completion;
    } catch (error) {
      logger.error('Error during prompt processing or LLM completion:', error);
      if (error instanceof Error) {
        throw new Error(`Failed to process prompt and generate completion: ${error.message}`);
      }
      throw new Error('Failed to process prompt and generate completion due to an unknown error.');
    }
  }
}
// Optional: Add methods like addPromptToLibrary, etc.
// Example:
// async addPromptToLibrary(name: string, text: string, modelProvider?: string, modelName?: string) {
//   try {
//     const newPromptId = await createPrompt(name, text, modelProvider, modelName); // Assuming createPrompt is imported
//     logger.info(`Prompt "${name}" added to library with ID: ${newPromptId}.`);
//     return newPromptId;
//   } catch (error) {
//     logger.error(`Error adding prompt "${name}" to library: ${error}`);
//     throw error;
//   }
// }

/**
 * Default instance of PromptService.
 * This instance uses the `defaultOpenAiLlmProvider`.
 * If the default provider is null (e.g., due to a missing API key),
 * this service will log a warning and its methods will throw errors.
 */
export const defaultPromptService = new PromptService(defaultOpenAiLlmProvider);

if (!defaultOpenAiLlmProvider) {
  logger.warn( // Changed to logger.warn
    'Default PromptService created, but defaultOpenAiLlmProvider is not available (likely missing API key). ' +
    'The service will not be functional until a valid LlmProvider is configured.'
  );
} else {
  logger.info('Default PromptService initialized successfully with OpenAiLlmProvider.'); // Changed to logger.info
}
