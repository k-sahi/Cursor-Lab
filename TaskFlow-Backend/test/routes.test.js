// Endpoint tests for auth, ownership, tasks and the migration.
//
// They run the real Express app against a real MongoDB, so they need a server:
//   MONGO_URI_TEST=mongodb://localhost:27017 npm test
// (docker run -d -p 27017:27017 mongo:7 is enough). Without MONGO_URI_TEST they
// are skipped, so `npm test` still works offline. CI provides a MongoDB service.
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

jest.mock('../src/services/emailService', () => ({
  sendMail: jest.fn().mockResolvedValue({}),
}));

const { createApp } = require('../src/app');
const { migrate } = require('../scripts/migrate-task-status');

const MONGO_URI_TEST = process.env.MONGO_URI_TEST;
const describeDb = MONGO_URI_TEST ? describe : describe.skip;

describeDb('API routes', () => {
  let server;
  let base;

  async function api(method, path, { token, body, rawBody } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined || rawBody !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  let counter = 0;
  async function registerUser(name = 'User') {
    counter += 1;
    const email = `${name.toLowerCase()}${counter}@example.com`;
    const res = await api('POST', '/api/auth/register', {
      body: { name, email, password: 'secret123' },
    });
    expect(res.status).toBe(201);
    return { token: res.body.token, user: res.body.user, email };
  }

  async function createProject(token, code = `P${++counter}`) {
    const res = await api('POST', '/api/projects', { token, body: { name: `Project ${code}`, code } });
    expect(res.status).toBe(201);
    return res.body.project;
  }

  beforeAll(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await mongoose.connect(MONGO_URI_TEST, { dbName: `taskflow_test_${process.pid}_${Date.now()}` });
    // Build unique indexes (email, owner+code) before tests rely on them.
    await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  describe('health and routing', () => {
    it('serves the health check at /', async () => {
      const res = await api('GET', '/');
      expect(res).toEqual({ status: 200, body: { status: 'ok', message: 'TaskFlow API is running' } });
    });

    it('returns JSON 404 for unknown routes', async () => {
      const res = await api('GET', '/api/nope');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ message: 'Not found' });
    });

    it('returns 400 for malformed JSON', async () => {
      const res = await api('POST', '/api/auth/login', { rawBody: '{"email":' });
      expect(res.status).toBe(400);
    });
  });

  describe('auth', () => {
    it('registers, rejects duplicates and missing fields', async () => {
      const { email } = await registerUser('Ada');
      const dup = await api('POST', '/api/auth/register', {
        body: { name: 'Ada', email: email.toUpperCase(), password: 'x' },
      });
      expect(dup.status).toBe(409);
      const missing = await api('POST', '/api/auth/register', { body: { email: 'x@example.com' } });
      expect(missing.status).toBe(400);
    });

    it('never returns the password hash', async () => {
      const { user } = await registerUser('Hash');
      expect(user).toEqual({ id: expect.any(String), name: 'Hash', email: expect.any(String) });
    });

    it('logs in, and gives the same 401 for unknown email and wrong password', async () => {
      const { email } = await registerUser('Bob');
      const ok = await api('POST', '/api/auth/login', { body: { email, password: 'secret123' } });
      expect(ok.status).toBe(200);
      expect(ok.body.token).toEqual(expect.any(String));

      const wrongPassword = await api('POST', '/api/auth/login', { body: { email, password: 'nope' } });
      const unknownEmail = await api('POST', '/api/auth/login', {
        body: { email: 'ghost@example.com', password: 'nope' },
      });
      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      expect(wrongPassword.body).toEqual(unknownEmail.body);
    });

    it('/me works with a valid token', async () => {
      const { token, user } = await registerUser('Me');
      const res = await api('GET', '/api/auth/me', { token });
      expect(res.status).toBe(200);
      expect(res.body.user).toEqual(user);
    });

    it.each([
      ['no token', undefined],
      ['a malformed token', 'garbage'],
      ['a token with the wrong signature', jwt.sign({ sub: 'x' }, 'wrong-secret')],
      ['an expired token', jwt.sign({ sub: 'x', exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET)],
    ])('returns 401, not 500, for %s', async (_label, token) => {
      for (const path of ['/api/auth/me', '/api/projects', '/api/notifications']) {
        const res = await api('GET', path, { token });
        expect(res.status).toBe(401);
        expect(res.body.message).toEqual(expect.any(String));
      }
    });
  });

  describe('ownership: user B cannot see or touch user A\'s data', () => {
    let alice;
    let bob;
    let project;
    let task;

    beforeAll(async () => {
      alice = await registerUser('Alice');
      bob = await registerUser('Bob');
      project = await createProject(alice.token, 'ALICE1');
      const t = await api('POST', `/api/projects/${project._id}/tasks`, {
        token: alice.token,
        body: { title: 'Secret task' },
      });
      task = t.body.task;
    });

    it('A sees the project, B does not', async () => {
      const a = await api('GET', '/api/projects', { token: alice.token });
      const b = await api('GET', '/api/projects', { token: bob.token });
      expect(a.body.projects.map((p) => p._id)).toContain(project._id);
      expect(b.body.projects).toEqual([]);
    });

    it.each([
      ['GET', '/api/projects/:id', undefined],
      ['PUT', '/api/projects/:id', { name: 'Hijacked' }],
      ['DELETE', '/api/projects/:id', undefined],
      ['GET', '/api/projects/:id/tasks', undefined],
      ['POST', '/api/projects/:id/tasks', { title: 'Injected' }],
    ])('%s %s by B returns 404', async (method, path, body) => {
      const res = await api(method, path.replace(':id', project._id), { token: bob.token, body });
      expect(res.status).toBe(404);
    });

    it('B cannot update or delete A\'s task', async () => {
      const path = `/api/projects/${project._id}/tasks/${task._id}`;
      expect((await api('PUT', path, { token: bob.token, body: { title: 'x' } })).status).toBe(404);
      expect((await api('DELETE', path, { token: bob.token })).status).toBe(404);
    });

    it('A\'s data is unchanged afterwards', async () => {
      const res = await api('GET', `/api/projects/${project._id}/tasks`, { token: alice.token });
      expect(res.body.tasks.map((t) => t.title)).toEqual(['Secret task']);
      const p = await api('GET', `/api/projects/${project._id}`, { token: alice.token });
      expect(p.body.project.name).toBe('Project ALICE1');
    });

    it('B\'s notifications contain nothing about A', async () => {
      const res = await api('GET', '/api/notifications', { token: bob.token });
      expect(res.body.notifications).toEqual([]);
    });
  });

  describe('projects', () => {
    it('returns 400 for an invalid id instead of 500', async () => {
      const { token } = await registerUser('Cast');
      const res = await api('GET', '/api/projects/not-an-id', { token });
      expect(res.status).toBe(400);
    });

    it('codes are unique per user (409), but two users may share one', async () => {
      const a = await registerUser('Dup');
      const b = await registerUser('Dup');
      await createProject(a.token, 'SAME');
      const again = await api('POST', '/api/projects', { token: a.token, body: { name: 'x', code: 'same' } });
      expect(again.status).toBe(409);
      await createProject(b.token, 'SAME');
    });

    it('paginates and embeds tasks', async () => {
      const { token } = await registerUser('Pager');
      for (let i = 0; i < 7; i += 1) await createProject(token, `PG${i}`);
      const first = await api('GET', '/api/projects?page=1&limit=6', { token });
      const second = await api('GET', '/api/projects?page=2&limit=6', { token });
      expect(first.body.projects).toHaveLength(6);
      expect(second.body.projects).toHaveLength(1);
      expect(first.body.pagination).toEqual({ page: 1, limit: 6, totalProjects: 7, totalPages: 2 });
      expect(first.body.projects[0].tasks).toEqual([]);
    });

    it('deleting a project deletes its tasks', async () => {
      const { token } = await registerUser('Cascade');
      const p = await createProject(token);
      await api('POST', `/api/projects/${p._id}/tasks`, { token, body: { title: 't1' } });
      expect((await api('DELETE', `/api/projects/${p._id}`, { token })).status).toBe(204);
      const remaining = await mongoose.connection.collection('tasks').countDocuments({ project: new mongoose.Types.ObjectId(p._id) });
      expect(remaining).toBe(0);
    });
  });

  describe('tasks: status and priority', () => {
    let token;
    let project;

    beforeAll(async () => {
      ({ token } = await registerUser('Tasks'));
      project = await createProject(token);
    });

    const tasksPath = () => `/api/projects/${project._id}/tasks`;

    it('defaults to status todo and priority medium', async () => {
      const res = await api('POST', tasksPath(), { token, body: { title: 'Write tests' } });
      expect(res.status).toBe(201);
      expect(res.body.task).toMatchObject({ title: 'Write tests', status: 'todo', priority: 'medium' });
    });

    it('accepts both fields on create', async () => {
      const res = await api('POST', tasksPath(), {
        token,
        body: { title: 'Fix prod', status: 'in_progress', priority: 'urgent' },
      });
      expect(res.body.task).toMatchObject({ status: 'in_progress', priority: 'urgent' });
    });

    it.each([
      [{ title: 'x', status: 'urgent' }, /Invalid status/],
      [{ title: 'x', priority: 'blocked' }, /Invalid priority/],
      [{ title: '   ' }, /Title is required/],
    ])('rejects %j with 400', async (body, message) => {
      const res = await api('POST', tasksPath(), { token, body });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(message);
    });

    it('updates one field without touching the others', async () => {
      const created = await api('POST', tasksPath(), { token, body: { title: 'Partial', priority: 'high' } });
      const path = `${tasksPath()}/${created.body.task._id}`;

      const status = await api('PUT', path, { token, body: { status: 'blocked' } });
      expect(status.body.task).toMatchObject({ title: 'Partial', status: 'blocked', priority: 'high' });

      const title = await api('PUT', path, { token, body: { title: 'Renamed' } });
      expect(title.body.task).toMatchObject({ title: 'Renamed', status: 'blocked', priority: 'high' });

      expect((await api('PUT', path, { token, body: {} })).status).toBe(400);
      expect((await api('PUT', path, { token, body: { priority: 'in_review' } })).status).toBe(400);
    });

    it('records a notification for each task change', async () => {
      const res = await api('GET', '/api/notifications', { token });
      const types = res.body.notifications.map((n) => n.type);
      expect(types).toContain('task_created');
      expect(types).toContain('task_updated');
    });
  });

  describe('migration script', () => {
    it('maps old priority values to status + priority, and is idempotent', async () => {
      const tasks = mongoose.connection.db.collection('migration_check');
      const project = new mongoose.Types.ObjectId();
      await tasks.insertMany([
        { project, title: 'a', priority: 'urgent' },
        { project, title: 'b', priority: 'blocked' },
        { project, title: 'c', priority: 'in_review' },
        { project, title: 'd' },
        { project, title: 'e', status: 'done', priority: 'low' },
      ]);

      await migrate(tasks);
      const second = await migrate(tasks);

      const byTitle = Object.fromEntries(
        (await tasks.find().toArray()).map((t) => [t.title, [t.status, t.priority]])
      );
      expect(byTitle).toEqual({
        a: ['todo', 'urgent'],
        b: ['blocked', 'medium'],
        c: ['in_review', 'medium'],
        d: ['todo', 'medium'],
        e: ['done', 'low'],
      });
      expect(Object.values(second).every((n) => n === 0)).toBe(true);
    });
  });
});
