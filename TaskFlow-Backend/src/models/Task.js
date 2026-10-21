const mongoose = require('mongoose');

// Status is where a task is in the workflow; priority is how important it is.
// They are independent: a task can be both urgent and blocked.
const TASK_STATUSES = ['todo', 'in_progress', 'in_review', 'blocked', 'done'];
const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'];

const taskSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    status: {
      type: String,
      enum: TASK_STATUSES,
      default: 'todo',
    },
    priority: {
      type: String,
      enum: TASK_PRIORITIES,
      default: 'medium',
    },
  },
  { timestamps: true }
);

taskSchema.statics.STATUSES = TASK_STATUSES;
taskSchema.statics.PRIORITIES = TASK_PRIORITIES;

const Task = mongoose.model('Task', taskSchema);

module.exports = Task;
