const { validateEnum } = require('../src/utils/validation');
const errorHandler = require('../src/middleware/errorHandler');
const Task = require('../src/models/Task');

jest.mock('../src/utils/logger', () => {
  const loggerMock = { info: jest.fn(), error: jest.fn() };
  return { createLogger: jest.fn(() => loggerMock), loggerMock };
});

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

describe('validateEnum', () => {
  const allowed = ['low', 'medium'];

  it('treats missing and blank values as "not provided"', () => {
    expect(validateEnum(undefined, allowed, 'Priority')).toEqual({ ok: true, value: undefined });
    expect(validateEnum(null, allowed, 'Priority')).toEqual({ ok: true, value: undefined });
    expect(validateEnum('  ', allowed, 'Priority')).toEqual({ ok: true, value: undefined });
  });

  it('trims and accepts allowed values', () => {
    expect(validateEnum(' low ', allowed, 'Priority')).toEqual({ ok: true, value: 'low' });
  });

  it('rejects unknown values and non-strings with a helpful message', () => {
    expect(validateEnum('urgent', allowed, 'Priority')).toEqual({
      ok: false,
      message: 'Invalid priority: urgent. Allowed values are: low, medium.',
    });
    expect(validateEnum(3, allowed, 'Priority').ok).toBe(false);
  });
});

describe('Task model', () => {
  it('separates workflow status from priority', () => {
    expect(Task.STATUSES).toEqual(['todo', 'in_progress', 'in_review', 'blocked', 'done']);
    expect(Task.PRIORITIES).toEqual(['low', 'medium', 'high', 'urgent']);
    // Nothing that describes progress is still a priority.
    expect(Task.PRIORITIES).not.toEqual(expect.arrayContaining(['blocked']));
    expect(Task.PRIORITIES).not.toEqual(expect.arrayContaining(['in_review']));
  });

  it('defaults new tasks to todo / medium', () => {
    const task = new Task({ project: '64b7f0000000000000000000', title: 'x' });
    expect(task.status).toBe('todo');
    expect(task.priority).toBe('medium');
  });

  it('rejects an old-style priority value', () => {
    const task = new Task({ project: '64b7f0000000000000000000', title: 'x', priority: 'blocked' });
    const err = task.validateSync();
    expect(err.errors.priority).toBeDefined();
  });
});

describe('errorHandler', () => {
  const req = { method: 'GET', originalUrl: '/x' };

  it('maps an invalid ObjectId (CastError) to 400', () => {
    const res = mockRes();
    errorHandler({ name: 'CastError', path: '_id' }, req, res, jest.fn());
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ message: 'Invalid _id' });
  });

  it('maps a duplicate key error to 409', () => {
    const res = mockRes();
    errorHandler({ code: 11000, keyPattern: { owner: 1, code: 1 } }, req, res, jest.fn());
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/already exists/);
  });

  it('maps malformed JSON bodies to 400', () => {
    const res = mockRes();
    errorHandler({ type: 'entity.parse.failed', status: 400 }, req, res, jest.fn());
    expect(res.statusCode).toBe(400);
  });

  it('hides internal error messages behind a generic 500', () => {
    const res = mockRes();
    errorHandler(new Error('connection string with password'), req, res, jest.fn());
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ message: 'Internal server error' });
  });
});
