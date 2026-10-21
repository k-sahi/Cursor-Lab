// The one place that reads auth config, so requireAuth and the auth routes
// can never disagree about the secret. There is deliberately no fallback secret:
// a server that silently signs tokens with a well-known default is worse than one
// that refuses to start.

function getJwtConfig() {
  const secret = process.env.JWT_SECRET;
  const expiresIn = process.env.JWT_EXPIRES_IN;

  if (!secret) {
    throw new Error('JWT_SECRET is not set. Copy .env.example to .env and set it.');
  }
  if (!expiresIn) {
    throw new Error('JWT_EXPIRES_IN is not set (for example "7d"). See .env.example.');
  }

  return { secret, expiresIn };
}

// Called once at startup by server.js so a missing value fails fast with a clear
// message, instead of surfacing later as a 500 on the first login.
function assertConfig() {
  getJwtConfig();
}

module.exports = {
  getJwtConfig,
  assertConfig,
};
