import request from 'supertest';
import { app } from '../index';
import * as db from '../db';
import axios from 'axios';

jest.mock('../db');
jest.mock('axios');

describe('express routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('root responds', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/running/i);
  });

  test('GET /api/document/:id validates id', async () => {
    const res = await request(app).get('/api/document/abc');
    expect(res.status).toBe(400);
  });

  test('GET /api/document/:id returns 404 when missing', async () => {
    (db.getDocumentById as jest.Mock).mockResolvedValue(undefined);
    const res = await request(app).get('/api/document/1');
    expect(res.status).toBe(404);
  });

  test('GET /api/document/:id returns document', async () => {
    (db.getDocumentById as jest.Mock).mockResolvedValue({ id: 1, status: 'completed' });
    const res = await request(app).get('/api/document/1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
  });

  test('GET /api/document/:id/status returns status', async () => {
    (db.getDocumentById as jest.Mock).mockResolvedValue({ id: 1, status: 'pending' });
    const res = await request(app).get('/api/document/1/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 1, status: 'pending' });
  });

  test('POST /api/upload without file', async () => {
    const res = await request(app).post('/api/upload');
    expect(res.status).toBe(400);
  });

  test('POST /api/upload success path', async () => {
    (db.insertDocument as jest.Mock).mockResolvedValue(1);
    (axios.post as jest.Mock).mockResolvedValue({ data: 'text' });
    const res = await request(app)
      .post('/api/upload')
      .attach('document', Buffer.from('hello'), 'hello.txt');
    expect(res.status).toBe(200);
    expect(db.insertDocument).toHaveBeenCalled();
    expect(db.updateDocumentStatusAndText).toHaveBeenCalledWith(1, 'completed', 'text');
  });
});
