## TaskFlow repository coding standards

Generated with `/generate` (`.cursor/skills/generate/SKILL.md`); the human-readable version is `docs/coding-practices.md`.

### Repo structure

- **Frontend**: `TaskFlow-API/` (Vite 7 + React 19 + Tailwind 4, ESM). The whole UI is `src/App.jsx`.
- **Backend**: `TaskFlow-Backend/` (Express 5 + Mongoose 9, CommonJS).
  - `src/app.js` builds the Express app (no DB, no port); `server.js` checks config, connects to MongoDB and listens.
  - `src/routes`, `src/models`, `src/middleware`, `src/services`, `src/utils`, `src/config.js`.
  - Tests: unit tests next to services (`*.test.js`) and in `test/`; route tests in `test/routes.test.js`.

### JavaScript style (observed)

- **Do** use single quotes in JS/JSX.
- **Do** end statements with semicolons in backend files and `src/App.jsx`. (Tooling config files and `main.jsx` omit them; leave those as they are.)
- **Do** use trailing commas in multiline objects, arrays and argument lists.
- **Do** name constants for allowed values in `UPPER_SNAKE_CASE` (`TASK_STATUSES`, `TASK_PRIORITIES`).

### Backend do / don't

- **Routes**
  - Do mount every endpoint under `/api/*` in `src/app.js`. Don't add routes in `server.js`.
  - Do keep exactly one handler per method + path.
  - Do nest child resources with `router.use('/:parentId/children', require('./children'))` and `express.Router({ mergeParams: true })`.
- **Auth**
  - Do protect routers with `router.use(requireAuth)`, or a single route with `router.get(path, requireAuth, handler)`. Don't parse `Authorization` headers in route handlers.
  - Do read JWT settings only through `getJwtConfig()` in `src/config.js`. Don't add fallback secrets.
  - Do answer `401 { message }` for missing, malformed, wrongly signed or expired tokens; never let `jwt.verify` errors become 500s.
- **Ownership**
  - Do include `owner: req.userId` in every query for user-owned data, so other users' records return `404` (never `403`, which leaks that the id exists).
  - Do check the parent project's ownership in middleware (`ensureProjectOwned`) before touching nested tasks.
- **Request bodies**
  - Do read bodies as `req.body || {}` (Express 5 leaves `req.body` undefined when there is no JSON body).
  - Do validate required fields at the route and return `400 { message }`.
  - Do validate enum fields with `validateEnum(value, allowed, label)` from `src/utils/validation.js` against the model's constants (`Task.STATUSES`, `Task.PRIORITIES`).
  - Do treat `PUT` as a partial update: apply only provided fields, reject an empty update with `400`, and pass `runValidators: true`.
- **Response shapes**
  - Collections `{ <plural>: [...] }`, single items `{ <singular>: {...} }`, errors `{ message }`, deletes `204` with no body.
  - Paginated lists add `pagination: { page, limit, totalProjects, totalPages }`.
- **Errors**
  - Do let async handlers throw: Express 5 forwards rejections to `src/middleware/errorHandler.js`.
  - The error handler maps `CastError` → 400, `ValidationError` → 400, duplicate key (`11000`) → 409, bad JSON → 400, everything else → 500 with a generic message. Don't leak internal error messages in 500 responses.
- **Side effects**
  - Do call `notificationService.*` after the database write succeeds.
  - Do keep email best-effort: email failures are logged and never fail the request. Only project create and delete send email.
- **Logging**
  - Do use `createLogger('<moduleName>')` from `src/utils/logger.js`, one logger per module. Don't use `console.*` in `src/` or `server.js` outside `logger.js` (CLI scripts in `scripts/` may print to the console).
  - Do log at the start of each handler or service function with ids as context (`userId`, `projectId`, `taskId`), and log `errorMessage` (not whole error objects) in `catch` blocks.
- **Data model**
  - Task `status` is workflow (`todo`, `in_progress`, `in_review`, `blocked`, `done`; default `todo`); `priority` is importance (`low`, `medium`, `high`, `urgent`; default `medium`). Don't mix them.
  - Do delete child documents explicitly when deleting a parent (MongoDB has no cascade).
  - Do ship a re-runnable migration script under `scripts/` when changing stored enum values.

### Frontend do / don't

- Do read the API base from `import.meta.env.VITE_API_BASE` with the `http://localhost:4000` fallback.
- Do keep auth in `localStorage` under `tf_token` and `tf_user`, and wrap `JSON.parse` of stored data in `try/catch`.
- Do use plain `fetch` with JSON bodies and `Authorization: Bearer ${token}`; check `res.ok` before using the response.
- Do send only the changed fields when updating a task (`{ status }`, `{ priority }`, `{ title }`).
- Do keep status and priority option lists in sync with `Task.STATUSES` and `Task.PRIORITIES`.
- Don't disable `react-hooks/exhaustive-deps` except on a single line with a comment explaining why.

### Testing

- Do unit test services and middleware with Jest mocks (see the shared `loggerMock` pattern).
- Do add route tests to `test/routes.test.js` for any new endpoint, including the "another user gets 404" case.
- Route tests need `MONGO_URI_TEST`; CI provides MongoDB. Don't make unit tests depend on a database.

### Known issues (action items)

- `src/App.jsx` is ~1,000 lines with three components; split `ProjectTasks` and the notifications panel into their own files when it next grows.
- Front-end `fetch` calls don't handle `401` globally; an expired token mid-session only clears on the next page load (`/api/auth/me`).
- `notifications.js` and `tasks.js` routes have no per-handler logging yet; run `/add-logging` on them.
