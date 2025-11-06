import { ConversationMemory } from './dist/ConversationMemory.js';
import { ToolHandlers } from './dist/tools/ToolHandlers.js';
import { getSQLiteManager } from './dist/storage/SQLiteManager.js';

const db = getSQLiteManager();
const memory = new ConversationMemory();
const handlers = new ToolHandlers(memory, db);

console.log('🔍 Testing Discovery Feature...\n');

const result = await handlers.discoverOldConversations({
  current_project_path: '/Users/joker/test-migration-demo/awesome-sample-app'
});

console.log('✅ Discovery Results:');
console.log('Success:', result.success);
console.log('Current path:', result.current_project_path);
console.log('Candidates found:', result.candidates.length);
console.log('\nCandidate Details:');
result.candidates.forEach((c, i) => {
  console.log(`\n[${i + 1}] ${c.folder_name}`);
  console.log(`    Path: ${c.folder_path}`);
  console.log(`    Original: ${c.stored_project_path}`);
  console.log(`    Score: ${c.score}`);
  console.log(`    Stats: ${c.stats.conversations} conversations, ${c.stats.files} files`);
});

console.log('\n📄 Message:', result.message);
