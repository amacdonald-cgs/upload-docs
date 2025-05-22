import { insertDocument, updateDocumentStatusAndText, getDocumentById } from '../db';
import { Pool } from 'pg';

jest.mock('pg', () => {
  const mQuery = jest.fn();
  const mClient = { query: mQuery, release: jest.fn() };
  const mPool = {
    connect: jest.fn().mockResolvedValue(mClient),
    query: mQuery,
    on: jest.fn(),
  };
  return { Pool: jest.fn(() => mPool) };
});

describe('database helpers', () => {
  const pool = new Pool() as any;
  beforeEach(() => {
    (pool.query as jest.Mock).mockReset();
  });

  test('insertDocument stores metadata and returns id', async () => {
    (pool.query as jest.Mock).mockResolvedValue({ rows: [{ id: 123 }] });
    const id = await insertDocument('f', 'o', 'text/plain', 10);
    expect(pool.query).toHaveBeenCalledWith(
      'INSERT INTO documents (filename, originalname, mimetype, size, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      ['f', 'o', 'text/plain', 10, 'processing']
    );
    expect(id).toBe(123);
  });

  test('updateDocumentStatusAndText updates status and text', async () => {
    (pool.query as jest.Mock).mockResolvedValue({});
    await updateDocumentStatusAndText(1, 'completed', 'text');
    expect(pool.query).toHaveBeenCalledWith(
      'UPDATE documents SET status = $1, extracted_text = $2, processing_timestamp = CURRENT_TIMESTAMP WHERE id = $3',
      ['completed', 'text', 1]
    );
  });

  test('getDocumentById returns single row', async () => {
    (pool.query as jest.Mock).mockResolvedValue({ rows: [{ id: 1 }] });
    const row = await getDocumentById(1);
    expect(pool.query).toHaveBeenCalledWith(
      'SELECT id, filename, originalname, mimetype, size, status, extracted_text, upload_timestamp, processing_timestamp FROM documents WHERE id = $1',
      [1]
    );
    expect(row).toEqual({ id: 1 });
  });
});
