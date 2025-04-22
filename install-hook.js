#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const hookDir = path.join(process.cwd(), '.git', 'hooks');
const hookFile = path.join(hookDir, 'prepare-commit-msg');
const smartCommitCmd = 'npx smart-committer --style conventional --commit --lang en';

if (!fs.existsSync(hookDir)) {
  console.error('.git/hooks directory not found. Are you in a git repository?');
  process.exit(1);
}

const hookScript = `#!/bin/sh\n# smart-committer prepare-commit-msg hook\n\n# Only run for normal commits, not merges or rebases\nif [ -z "$2" ]; then\n  ${smartCommitCmd}\n  exit $?\nfi\n`;

fs.writeFileSync(hookFile, hookScript, { mode: 0o755 });
console.log('prepare-commit-msg hook installed!');
