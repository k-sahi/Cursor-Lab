const express = require('express');
const Project = require('../models/Project');
const Task = require('../models/Task');
const requireAuth = require('../middleware/requireAuth');
const notificationService = require('../services/notificationService');
const { createLogger } = require('../utils/logger');

// One logger per module and a log line at the start of every handler with context
// (see .cursor/commands/add-logging.md). Handlers have no try/catch of their own:
// Express 5 forwards rejected promises to errorHandler, which logs them.
const logger = createLogger('projectsRoutes');

const router = express.Router();

router.use(requireAuth);

router.get('/', async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 6, 1), 50);
  logger.info('listProjects called', { userId: req.userId, page, limit });

  const filter = { owner: req.userId };

  const totalProjects = await Project.countDocuments(filter);

  const projects = await Project.find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);

  // Two queries instead of one per project (avoids N+1): load this page's tasks
  // in one go and group them in memory.
  const projectIds = projects.map((p) => p._id);
  const tasks = await Task.find({ project: { $in: projectIds } }).sort({ createdAt: 1 });
  const tasksByProject = {};
  for (const t of tasks) {
    const id = t.project.toString();
    if (!tasksByProject[id]) tasksByProject[id] = [];
    tasksByProject[id].push(t);
  }
  const projectsWithTasks = projects.map((p) => ({
    ...p.toObject(),
    tasks: tasksByProject[p._id.toString()] || [],
  }));
  res.json({
    projects: projectsWithTasks,
    pagination: {
      page,
      limit,
      totalProjects,
      totalPages: Math.max(Math.ceil(totalProjects / limit), 1),
    },
  });
});

router.post('/', async (req, res) => {
  const { name, code, description } = req.body || {};
  logger.info('createProject called', { userId: req.userId, code });

  if (!name || !code) {
    return res.status(400).json({ message: 'Name and code are required' });
  }

  const project = await Project.create({
    owner: req.userId,
    name,
    code,
    description: description || '',
  });

  await notificationService.projectCreated(req.userId, req.userEmail, project);

  logger.info('Project created', { userId: req.userId, projectId: project._id });
  res.status(201).json({ project });
});

router.get('/:id', async (req, res) => {
  logger.info('getProject called', { userId: req.userId, projectId: req.params.id });
  const project = await Project.findOne({ _id: req.params.id, owner: req.userId });

  if (!project) {
    return res.status(404).json({ message: 'Project not found' });
  }

  res.json({ project });
});

router.put('/:id', async (req, res) => {
  const { name, code, description } = req.body || {};
  logger.info('updateProject called', {
    userId: req.userId,
    projectId: req.params.id,
    fields: Object.keys(req.body || {}),
  });

  const update = {};
  if (name !== undefined) update.name = name;
  if (code !== undefined) update.code = code;
  if (description !== undefined) update.description = description;

  const project = await Project.findOneAndUpdate(
    { _id: req.params.id, owner: req.userId },
    update,
    { new: true, runValidators: true }
  );

  if (!project) {
    return res.status(404).json({ message: 'Project not found' });
  }

  await notificationService.projectUpdated(req.userId, req.userEmail, project);

  res.json({ project });
});

router.delete('/:id', async (req, res) => {
  logger.info('deleteProject called', { userId: req.userId, projectId: req.params.id });
  const project = await Project.findOne({ _id: req.params.id, owner: req.userId });
  if (!project) {
    return res.status(404).json({ message: 'Project not found' });
  }
  const name = project.name;
  const code = project.code;
  // MongoDB has no cascading foreign keys: delete the tasks explicitly.
  const { deletedCount } = await Task.deleteMany({ project: req.params.id });
  await Project.deleteOne({ _id: req.params.id, owner: req.userId });
  await notificationService.projectDeleted(req.userId, req.userEmail, name, code);
  logger.info('Project deleted', { userId: req.userId, projectId: req.params.id, tasksDeleted: deletedCount });
  res.status(204).end();
});

router.use('/:projectId/tasks', require('./tasks'));

module.exports = router;
