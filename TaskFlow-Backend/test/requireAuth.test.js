const jwt = require('jsonwebtoken');
const requireAuth = require('../src/middleware/requireAuth');
const { getJwtConfig, assertConfig } = require('../src/config');

function run(authorization) {
  const req = { headers: authorization === undefined ? {} : { authorization } };
  const res = {
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
  const next = jest.fn();
  requireAuth(req, res, next);
  return { req, res, next };
}

const sign = (payload, options = {}, secret = process.env.JWT_SECRET) =>
  jwt.sign(payload, secret, options);

describe('requireAuth', () => {
  it('accepts a valid Bearer token and sets userId and userEmail', () => {
    const token = sign({ sub: 'user-1', email: 'a@example.com' }, { expiresIn: '1h' });
    const { req, res, next } = run(`Bearer ${token}`);
    expect(next).toHaveBeenCalledWith();
    expect(res.statusCode).toBe(200);
    expect(req.userId).toBe('user-1');
    expect(req.userEmail).toBe('a@example.com');
  });

  it('returns 401 when the header is missing', () => {
    const { res, next } = run(undefined);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ message: 'Missing Authorization header' });
  });

  it('returns 401 for a non-Bearer scheme', () => {
    const token = sign({ sub: 'user-1' });
    const { res } = run(`Basic ${token}`);
    expect(res.statusCode).toBe(401);
  });

  // Token errors must be 401s, never 500s.
  it('returns 401 (not 500) for a malformed token', () => {
    const { res, next } = run('Bearer not-a-jwt');
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ message: 'Invalid token' });
  });

  it('returns 401 for a token signed with another secret', () => {
    const token = sign({ sub: 'user-1' }, {}, 'some-other-secret');
    const { res } = run(`Bearer ${token}`);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ message: 'Invalid token' });
  });

  it('returns 401 "Token expired" for an expired token', () => {
    const token = sign({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) - 60 });
    const { res } = run(`Bearer ${token}`);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ message: 'Token expired' });
  });
});

describe('config', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('returns the secret and expiry from the environment', () => {
    expect(getJwtConfig()).toEqual({
      secret: process.env.JWT_SECRET,
      expiresIn: process.env.JWT_EXPIRES_IN,
    });
  });

  it('fails fast when JWT_SECRET is missing (no hidden fallback secret)', () => {
    delete process.env.JWT_SECRET;
    expect(() => assertConfig()).toThrow(/JWT_SECRET is not set/);
  });

  it('fails fast when JWT_EXPIRES_IN is missing', () => {
    delete process.env.JWT_EXPIRES_IN;
    expect(() => assertConfig()).toThrow(/JWT_EXPIRES_IN is not set/);
  });

  it('makes requireAuth reject every token when the secret is missing', () => {
    const token = sign({ sub: 'user-1' });
    delete process.env.JWT_SECRET;
    const next = jest.fn();
    requireAuth({ headers: { authorization: `Bearer ${token}` } }, {}, next);
    // Not a token problem, so it goes to the error handler instead of answering 401.
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/JWT_SECRET/) }));
  });
});
