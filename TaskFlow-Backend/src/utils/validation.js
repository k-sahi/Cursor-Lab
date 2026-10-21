// Shared validator for enum fields on request bodies (task status and priority).
// Returns { ok: true, value } where value is undefined when the field was omitted
// or blank, or { ok: false, message } for a 400 response.
function validateEnum(value, allowed, label) {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }

  if (typeof value !== 'string') {
    return { ok: false, message: `${label} must be a string.` };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, value: undefined };
  }

  if (!allowed.includes(trimmed)) {
    return {
      ok: false,
      message: `Invalid ${label.toLowerCase()}: ${trimmed}. Allowed values are: ${allowed.join(', ')}.`,
    };
  }

  return { ok: true, value: trimmed };
}

module.exports = {
  validateEnum,
};
