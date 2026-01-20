import fs from 'fs';
import os from 'os';
import path from 'path';
import { getSQLiteManager, resetSQLiteManager } from '../../storage/SQLiteManager.js';

describe('SQLiteManager path resolution', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    resetSQLiteManager();
  });

  it('uses a single DB path when CCCMEMORY_DB_MODE=single', () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cccmemory-home-'));
    process.env.HOME = tempHome;
    process.env.CCCMEMORY_DB_MODE = 'single';
    delete process.env.CCCMEMORY_DB_PATH;

    const db = getSQLiteManager();
    expect(db.getDbPath()).toBe(path.join(tempHome, '.cccmemory.db'));
    db.close();
  });
});
