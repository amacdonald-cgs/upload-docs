import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import FormData from 'form-data';
import { initializeDatabase, insertDocument, updateDocumentStatusAndText, getDocumentById } from './db';

// Initialize Express application
export const app = express();
// Define the port for the server, fallback to 3001 if not specified in environment
const port = process.env.PORT || 3001;
// Define the URL for the Tika service, fallback to local Docker service if not specified
const TIKA_URL = process.env.TIKA_URL || 'http://tika:9998/tika';

// Define the directory for storing uploads.
// It's relative to the 'dist' folder after compilation, hence '../uploads'.
const uploadsDir = path.join(__dirname, '..', 'uploads');
// Ensure the uploads directory exists, create it if it doesn't.
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure Multer for file storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir); // Save files to the 'uploads' directory
  },
  filename: function (req, file, cb) {
    // Use a timestamp to ensure unique filenames and prevent overwrites
    cb(null, Date.now() + '-' + file.originalname);
  }
});
// Initialize Multer middleware with the configured storage
const upload = multer({ storage: storage });

// Basic logging middleware to log all incoming requests
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Middleware to parse JSON request bodies
app.use(express.json());

// Simple root endpoint to check if the server is running
app.get('/', (req: Request, res: Response) => {
  res.send('Backend server is running!');
});

/**
 * POST /api/upload
 * Handles file uploads. The file is temporarily stored, a record is created in the database,
 * the file is sent to Tika for text extraction, and the database record is updated.
 * The temporary file is deleted afterwards.
 */
app.post('/api/upload', upload.single('document'), async (req: Request, res: Response, next: NextFunction) => {
  if (!req.file) {
    return res.status(400).send({ message: 'No file uploaded.' });
  }

  const { filename, originalname, mimetype, size, path: filePath } = req.file;
  let documentId: number | null = null; // To store the ID of the document record

  try {
    // Insert initial document record into the database with 'processing' status
    documentId = await insertDocument(filename, originalname, mimetype, size);
    console.log(`[${new Date().toISOString()}] Inserted document record with ID: ${documentId}`);

    // Create a readable stream for the uploaded file
    const fileStream = fs.createReadStream(filePath);
    const formData = new FormData();
    formData.append('file', fileStream); // 'file' is the field Tika expects

    console.log(`[${new Date().toISOString()}] Sending file ${originalname} (ID: ${documentId}) to Tika...`);
    // Send file to Tika for text extraction
    const tikaResponse = await axios.post(TIKA_URL, formData, {
      headers: {
        ...formData.getHeaders(), // Set correct headers for multipart/form-data
        'Accept': 'text/plain'    // Request plain text from Tika
      },
      maxBodyLength: Infinity,    // Allow for large request bodies
      maxContentLength: Infinity  // Allow for large response bodies
    });
    const extractedText = tikaResponse.data;
    console.log(`[${new Date().toISOString()}] Extracted text from ${originalname} (ID: ${documentId}).`);

    // Update the document record with the extracted text and 'completed' status
    await updateDocumentStatusAndText(documentId, 'completed', extractedText);
    console.log(`[${new Date().toISOString()}] Updated document (ID: ${documentId}) status to 'completed' and stored text.`);

    // Respond to the client with success
    res.status(200).send({
      message: 'File processed and text extracted successfully.',
      documentId: documentId,
      filename: filename,
      originalname: originalname,
    });

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error during document processing (ID: ${documentId || 'N/A'}):`, error);
    // If an error occurs after the document record was created, update its status to 'error'
    if (documentId) {
      try {
        await updateDocumentStatusAndText(documentId, 'error', 'Processing failed. Check logs.');
      } catch (dbError) {
        // Log critical error if updating status fails
        console.error(`[${new Date().toISOString()}] CRITICAL: Failed to update document (ID: ${documentId}) status to 'error':`, dbError);
      }
    }
    // Pass the error to the global error handler
    // Ensure the error is an instance of Error for consistent handling
    return next(error instanceof Error ? error : new Error(String(error)));
  } finally {
    // Always attempt to delete the temporary file from the 'uploads' directory
    fs.unlink(filePath, (err) => {
      if (err) console.error(`[${new Date().toISOString()}] Error deleting temp file ${filePath} (ID: ${documentId || 'N/A'}):`, err);
      else console.log(`[${new Date().toISOString()}] Deleted temp file ${filePath} (ID: ${documentId || 'N/A'}).`);
    });
  }
});

/**
 * GET /api/document/:id
 * Retrieves a specific document by its ID, including its metadata and extracted text.
 */
app.get('/api/document/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).send({ message: 'Invalid document ID.' });
    }
    const document = await getDocumentById(id);
    if (!document) {
      return res.status(404).send({ message: 'Document not found.' });
    }
    res.status(200).send(document);
  } catch (error) {
    next(error); // Pass errors to the global error handler
  }
});

/**
 * GET /api/document/:id/status
 * Retrieves the current processing status of a specific document by its ID.
 */
app.get('/api/document/:id/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).send({ message: 'Invalid document ID.' });
    }
    const document = await getDocumentById(id); // Reuses getDocumentById, could be optimized to fetch only status
    if (!document) {
      return res.status(404).send({ message: 'Document not found.' });
    }
    res.status(200).send({ id: document.id, status: document.status });
  } catch (error) {
    next(error); // Pass errors to the global error handler
  }
});

// Global error handling middleware.
// This catches any errors passed by `next(error)` calls in route handlers.
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(`[${new Date().toISOString()}] Global Error Handler: ${err.message}`);
  console.error(err.stack);

  // Specific handling for Multer errors (e.g., file too large)
  if (err instanceof multer.MulterError) {
    return res.status(400).send({ message: `Multer error: ${err.message}` });
  }
  // Generic error response
  res.status(500).send({ message: err.message || 'An unexpected error occurred.' });
});

// Asynchronous function to start the server.
// This ensures that database initialization is complete before the server starts listening for requests.
export const startServer = async () => {
  try {
    await initializeDatabase(); // Initialize database connection and tables
    app.listen(port, () => {
      console.log(`Backend server listening at http://localhost:${port}`);
    });
  } catch (error) {
    console.error('Failed to start the server:', error);
    process.exit(1); // Exit if server fails to start (e.g., DB connection issue)
  }
};

// Start the server if this file is run directly
if (require.main === module) {
  startServer();
}
