import { ConversationMemory } from './dist/ConversationMemory.js';
import { ToolHandlers } from './dist/tools/ToolHandlers.js';
import { getSQLiteManager } from './dist/storage/SQLiteManager.js';

const db = getSQLiteManager();
const memory = new ConversationMemory();
const handlers = new ToolHandlers(memory, db);

console.log('🚀 Testing Migration Feature...\n');

// First, test dry run
console.log('1️⃣  Testing DRY RUN...');
const dryRunResult = await handlers.migrateProject({
  source_folder: '/Users/joker/.claude/projects/-Users-joker-test-migration-demo-my-sample-app',
  old_project_path: '/Users/joker/test-migration-demo/my-sample-app',
  new_project_path: '/Users/joker/test-migration-demo/awesome-sample-app',
  dry_run: true
});

console.log('✅ Dry Run Results:');
console.log('   Success:', dryRunResult.success);
console.log('   Files would be copied:', dryRunResult.files_copied);
console.log('   Database would be updated:', dryRunResult.database_updated);
console.log('   Message:', dryRunResult.message);
console.log('');

// Now, test actual migration
console.log('2️⃣  Testing ACTUAL MIGRATION...');
const migrationResult = await handlers.migrateProject({
  source_folder: '/Users/joker/.claude/projects/-Users-joker-test-migration-demo-my-sample-app',
  old_project_path: '/Users/joker/test-migration-demo/my-sample-app',
  new_project_path: '/Users/joker/test-migration-demo/awesome-sample-app',
  dry_run: false
});

console.log('✅ Migration Results:');
console.log('   Success:', migrationResult.success);
console.log('   Source:', migrationResult.source_folder);
console.log('   Target:', migrationResult.target_folder);
console.log('   Files copied:', migrationResult.files_copied);
console.log('   Database updated:', migrationResult.database_updated);
console.log('   Backup created:', migrationResult.backup_created);
console.log('   Message:', migrationResult.message);
