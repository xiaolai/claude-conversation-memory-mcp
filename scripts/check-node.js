#!/usr/bin/env node
/* eslint-env node */
/* eslint-disable no-console */

const rawVersion = process.versions.node || "0.0.0";
const major = Number(rawVersion.split(".")[0] || 0);
const minMajor = 20;
const maxMajorExclusive = 23;

if (Number.isNaN(major) || major < minMajor || major >= maxMajorExclusive) {
  console.error("❌ cccmemory supports Node.js 20 or 22 LTS only.");
  console.error(`   Detected Node.js ${rawVersion}.`);
  console.error("   Please switch to Node 20/22 and reinstall:");
  console.error("   - nvm install 22 && nvm use 22");
  console.error("   - npm install -g cccmemory");
  process.exit(1);
}
