import { Pool } from 'pg';
import logger from './util/logger';

// Ensure DATABASE_URL is set, otherwise the application cannot function.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  logger.error('FATAL: DATABASE_URL environment variable is not set.');
  process.exit(1); // Exit if DB URL is not found, as it's critical
}

// Create a new PostgreSQL connection pool.
// The pool manages multiple client connections.
const pool = new Pool({
  connectionString: databaseUrl,
  // Recommended: SSL configuration for production, but can be omitted for local Docker setup
  // ssl: {
  //   rejectUnauthorized: false // Only for development/testing if using self-signed certs
  // }
});

// Event listener for new client connections.
pool.on('connect', () => {
  logger.info('Connected to PostgreSQL database!');
});

// Event listener for errors that occur on idle clients.
pool.on('error', (err) => {
  logger.error(`Unexpected error on idle client: ${err}`);
  process.exit(-1); // Exit on pool errors to prevent undefined behavior
});

/**
 * Initializes the database by connecting and ensuring the 'documents' table exists.
 * This function is called on application startup.
 * @throws Will throw an error if connection fails or table creation fails.
 */
export const initializeDatabase = async () => {
  const client = await pool.connect();
  try {
    // Test query to ensure connection is working
    await client.query('SELECT NOW()');
    logger.info('Database connection test successful.');

    // SQL to create the 'documents' table if it doesn't already exist.
    // This table stores metadata and extracted text for uploaded documents.
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS documents (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        originalname VARCHAR(255) NOT NULL,
        mimetype VARCHAR(100),
        size BIGINT,
        status VARCHAR(50) DEFAULT 'pending', -- e.g., pending, processing, completed, error
        extracted_text TEXT,
        upload_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processing_timestamp TIMESTAMP
      );
    `;
    await client.query(createTableQuery);
    logger.info('Table "documents" checked/created successfully.');

    // SQL to create the 'prompts' table if it doesn't already exist.
    const createPromptsTableQuery = `
      CREATE TABLE IF NOT EXISTS prompts (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        prompt_text TEXT NOT NULL,
        model_provider VARCHAR(100),
        model_name VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await client.query(createPromptsTableQuery);
    logger.info('Table "prompts" checked/created successfully.');

  } catch (err) {
    logger.error(`Error initializing database or creating table: ${err}`);
    throw err; // Re-throw to be caught by application startup logic
  } finally {
    client.release(); // Release the client back to the pool
  }
};

/**
 * Executes a SQL query using the connection pool.
 * @param text The SQL query string.
 * @param params Optional array of parameters for the query.
 * @returns A Promise resolving to the query result.
 */
export const query = (text: string, params?: any[]) => pool.query(text, params);

/**
 * Inserts a new document record into the 'documents' table.
 * Sets the initial status to 'processing'.
 * @param filename The name of the file as stored on the server.
 * @param originalname The original name of the uploaded file.
 * @param mimetype The MIME type of the file.
 * @param size The size of the file in bytes.
 * @returns A Promise resolving to the ID of the newly inserted document.
 */
export const insertDocument = async (filename: string, originalname: string, mimetype: string, size: number) => {
  const result = await query(
    'INSERT INTO documents (filename, originalname, mimetype, size, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [filename, originalname, mimetype, size, 'processing']
  );
  return result.rows[0].id;
};

/**
 * Updates the status and extracted text of a document in the 'documents' table.
 * Also sets the 'processing_timestamp' to the current time.
 * @param id The ID of the document to update.
 * @param status The new status (e.g., 'completed', 'error').
 * @param extractedText Optional extracted text from the document.
 */
export const updateDocumentStatusAndText = async (id: number, status: string, extractedText?: string) => {
  await query(
    'UPDATE documents SET status = $1, extracted_text = $2, processing_timestamp = CURRENT_TIMESTAMP WHERE id = $3',
    [status, extractedText, id]
  );
};

/**
 * Retrieves a document by its ID from the 'documents' table.
 * @param id The ID of the document to retrieve.
 * @returns A Promise resolving to the document object, or undefined if not found.
 */
export const getDocumentById = async (id: number) => {
  const result = await query('SELECT id, filename, originalname, mimetype, size, status, extracted_text, upload_timestamp, processing_timestamp FROM documents WHERE id = $1', [id]);
  return result.rows[0]; // Returns undefined if no row found
};

// Export the pool itself if direct access is needed (though using query function is preferred)
export default pool;

/**
 * Retrieves all documents from the database ordered by upload timestamp.
 */
export const listDocuments = async () => {
  const result = await query(
    'SELECT id, filename, originalname, mimetype, size, status, upload_timestamp, processing_timestamp FROM documents ORDER BY upload_timestamp DESC'
  );
  return result.rows;
};

// -- Prompt Library Functions --

/**
 * @interface Prompt
 * Defines the structure for a prompt object retrieved from the database.
 */
export interface Prompt {
  id: number;
  name: string;
  prompt_text: string;
  model_provider?: string | null;
  model_name?: string | null;
  created_at: Date;
}

/**
 * Creates a new prompt in the 'prompts' table.
 * @param name - The unique name of the prompt.
 * @param promptText - The main text content of the prompt.
 * @param modelProvider - (Optional) The preferred model provider (e.g., 'openai').
 * @param modelName - (Optional) The preferred model name (e.g., 'gpt-3.5-turbo').
 * @returns A Promise resolving to the ID of the newly created prompt.
 * @throws Error if the prompt name already exists or if there's a database error.
 */
export const createPrompt = async (name: string, promptText: string, modelProvider?: string, modelName?: string): Promise<number> => {
  try {
    const result = await query(
      'INSERT INTO prompts (name, prompt_text, model_provider, model_name) VALUES ($1, $2, $3, $4) RETURNING id',
      [name, promptText, modelProvider, modelName]
    );
    logger.info(`Prompt "${name}" created successfully with ID: ${result.rows[0].id}`);
    return result.rows[0].id;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === '23505') { // Unique violation for 'name'
      logger.error(`Error creating prompt: Prompt name "${name}" already exists.`);
      throw new Error(`Prompt name "${name}" already exists.`);
    }
    logger.error(`Error creating prompt "${name}": ${error}`);
    throw error;
  }
};

/**
 * Retrieves a prompt by its unique name from the 'prompts' table.
 * @param name - The name of the prompt to retrieve.
 * @returns A Promise resolving to the Prompt object, or null if not found.
 */
export const getPromptByName = async (name: string): Promise<Prompt | null> => {
  const result = await query('SELECT * FROM prompts WHERE name = $1', [name]);
  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0] as Prompt;
};

/**
 * Retrieves a prompt by its ID from the 'prompts' table.
 * @param id - The ID of the prompt to retrieve.
 * @returns A Promise resolving to the Prompt object, or null if not found.
 */
export const getPromptById = async (id: number): Promise<Prompt | null> => {
  const result = await query('SELECT * FROM prompts WHERE id = $1', [id]);
  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0] as Prompt;
};

/**
 * Lists all available prompts from the 'prompts' table, ordered by creation date.
 * @returns A Promise resolving to an array of Prompt objects.
 */
export const listPrompts = async (): Promise<Prompt[]> => {
  const result = await query('SELECT * FROM prompts ORDER BY created_at DESC');
  return result.rows as Prompt[];
};
