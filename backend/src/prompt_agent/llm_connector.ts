import OpenAI from 'openai';

/**
 * @interface LlmProvider
 * Defines the contract for a Large Language Model (LLM) provider.
 */
export interface LlmProvider {
  /**
   * Generates a completion for a given prompt.
   * @param prompt - The input text prompt.
   * @param model - (Optional) The specific model to use for completion.
   * @returns A promise that resolves to the LLM's completion as a string.
   */
  generateCompletion(prompt: string, model?: string): Promise<string>;
}

/**
 * @class OpenAiLlmProvider
 * Implements the LlmProvider interface using the OpenAI API.
 */
export class OpenAiLlmProvider implements LlmProvider {
  private openai: OpenAI;
  private apiKey: string;

  /**
   * Creates an instance of OpenAiLlmProvider.
   * @param apiKey - (Optional) The OpenAI API key. If not provided, it attempts to read from the OPENAI_API_KEY environment variable.
   * @throws Error if the API key is not provided and not found in the environment variable.
   */
  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('OpenAI API key is not provided and not found in OPENAI_API_KEY environment variable.');
    }
    this.openai = new OpenAI({ apiKey: this.apiKey });
  }

  /**
   * Generates a completion for a given prompt using the OpenAI API.
   * @param prompt - The input text prompt.
   * @param model - (Optional) The specific OpenAI model to use (e.g., "gpt-3.5-turbo"). Defaults to "gpt-3.5-turbo".
   * @returns A promise that resolves to the LLM's completion as a string.
   * @throws Error if the API request fails or returns an unexpected response.
   */
  async generateCompletion(prompt: string, model: string = 'gpt-3.5-turbo'): Promise<string> {
    try {
      const completion = await this.openai.chat.completions.create({
        model: model,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = completion.choices[0]?.message?.content;
      if (content === null || content === undefined) {
        throw new Error('OpenAI API returned an empty or unexpected response.');
      }
      return content;
    } catch (error) {
      logger.error('Error generating completion from OpenAI:', { 
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        details: error // Preserve original error details if any
      });
      if (error instanceof Error) {
        throw new Error(`OpenAI API request failed: ${error.message}`);
      }
      throw new Error('OpenAI API request failed with an unknown error.');
    }
  }
}

let defaultOpenAiLlmProvider: OpenAiLlmProvider | null = null;

import { logger } from '../../util/logger'; // Import logger

try {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    defaultOpenAiLlmProvider = new OpenAiLlmProvider(apiKey);
    logger.info('Default OpenAiLlmProvider initialized successfully.');
  } else {
    logger.warn('OPENAI_API_KEY environment variable not set. Default OpenAiLlmProvider will not be available.');
  }
} catch (error) {
  logger.warn('Failed to initialize Default OpenAiLlmProvider:', { 
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined 
  });
}

/**
 * Default instance of OpenAiLlmProvider.
 * This instance is created if the OPENAI_API_KEY environment variable is set.
 * If the API key is not available, this will be null and a warning will be logged.
 */
export default defaultOpenAiLlmProvider;
