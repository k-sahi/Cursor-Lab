const express = require('express');
const Task = require('../models/Task');
const Project = require('../models/Project');
const requireAuth = require('../middleware/requireAuth');
const notificationService = require('../services/notificationService');
const { validateEnum } = require('../utils/validation');

const router = express.Router({ mergeParams: true });

router.use(requireAuth);

async function ensureProjectOwned(req, res, next) {
  const project = await Project.findOne({ _id: req.params.projectId, owner: req.userId });
  if (!project) {
    return res.status(404).json({ message: 'Project not found' });
  }
  req.project = project;
  next();
}

router.use(ensureProjectOwned);

// Validates the optional status and priority fields of a request body.
// Returns { ok: true, fields } with only the fields that were provided,
// or { ok: false, message }.
function validateTaskFields(body) {
  const fields = {};

  const status = validateEnum(body.status, Task.STATUSES, 'Status');
  if (!status.ok) return status;
  if (status.value !== undefined) fields.status = status.value;

  const priority = validateEnum(body.priority, Task.PRIORITIES, 'Priority');
  if (!priority.ok) return priority;
  if (priority.value !== undefined) fields.priority = priority.value;

  return { ok: true, fields };
}

router.get('/', async (req, res) => {
  const tasks = await Task.find({ project: req.params.projectId }).sort({ createdAt: 1 });
  res.json({ tasks });
});

router.post('/', async (req, res) => {
  const { title } = req.body || {};

  if (typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ message: 'Title is required' });
  }

  const result = validateTaskFields(req.body);
  if (!result.ok) {
    return res.status(400).json({ message: result.message });
  }

  const task = await Task.create({
    project: req.params.projectId,
    title: title.trim(),
    ...result.fields,
  });

  await notificationService.taskCreated(req.userId, req.userEmail, task, req.project?.name);

  res.status(201).json({ task });
});

// Partial update: send any of title, status, priority.
router.put('/:taskId', async (req, res) => {
  const { title } = req.body || {};
  const update = {};

  if (title !== undefined) {
    if (typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ message: 'Title cannot be empty' });
    }
    update.title = title.trim();
  }

  const result = validateTaskFields(req.body || {});
  if (!result.ok) {
    return res.status(400).json({ message: result.message });
  }
  Object.assign(update, result.fields);

  if (Object.keys(update).length === 0) {
    return res
      .status(400)
      .json({ message: 'Nothing to update: send title, status, or priority' });
  }

  const task = await Task.findOneAndUpdate(
    { _id: req.params.taskId, project: req.params.projectId },
    update,
    { new: true, runValidators: true }
  );

  if (!task) {
    return res.status(404).json({ message: 'Task not found' });
  }

  await notificationService.taskUpdated(req.userId, req.userEmail, task, req.project?.name);

  res.json({ task });
});

router.delete('/:taskId', async (req, res) => {
  const task = await Task.findOne({
    _id: req.params.taskId,
    project: req.params.projectId,
  });

  if (!task) {
    return res.status(404).json({ message: 'Task not found' });
  }

  const title = task.title;
  await Task.deleteOne({
    _id: req.params.taskId,
    project: req.params.projectId,
  });

  await notificationService.taskDeleted(req.userId, req.userEmail, title, req.project?.name);

  res.status(204).end();
});

module.exports = router;
