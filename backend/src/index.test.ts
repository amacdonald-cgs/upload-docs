import request from 'supertest';
import { app } from './index';

describe('app', () => {
  it('responds to GET / with running message', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Backend server is running');
  });
});
