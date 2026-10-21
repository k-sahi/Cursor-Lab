// One-off migration: move workflow states out of `priority` into `status`.
//
//   Before: priority in { urgent, blocked, in_review }
//   After:  status   in { todo, in_progress, in_review, blocked, done }
//           priority in { low, medium, high, urgent }
//
//   old priority   ->  new status   new priority
//   urgent             todo         urgent
//   blocked            blocked      medium
//   in_review          in_review    medium
//   (missing)          todo         medium
//
// Safe to run more than once: it only touches documents that still have an old
// value or no status. Run with:  npm run migrate:tasks   (uses MONGO_URI from .env)
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: '.env.local' });
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/taskflow';

async function migrate(collection) {
  const results = {};
  results.urgent = await collection.updateMany(
    { priority: 'urgent', status: { $exists: false } },
    { $set: { status: 'todo' } }
  );
  results.blocked = await collection.updateMany(
    { priority: 'blocked' },
    { $set: { status: 'blocked', priority: 'medium' } }
  );
  results.inReview = await collection.updateMany(
    { priority: 'in_review' },
    { $set: { status: 'in_review', priority: 'medium' } }
  );
  results.missingStatus = await collection.updateMany(
    { status: { $exists: false } },
    { $set: { status: 'todo' } }
  );
  results.missingPriority = await collection.updateMany(
    { priority: { $exists: false } },
    { $set: { priority: 'medium' } }
  );
  return Object.fromEntries(Object.entries(results).map(([k, r]) => [k, r.modifiedCount]));
}

async function main() {
  await mongoose.connect(MONGO_URI, { dbName: 'taskflow' });
  const counts = await migrate(mongoose.connection.collection('tasks'));
  console.log('Tasks migrated:', counts);
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Migration failed:', err.message);
    process.exit(1);
  });
}

module.exports = { migrate };
