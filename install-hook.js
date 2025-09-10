#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const hookDir = path.join(process.cwd(), '.git', 'hooks');
const hookFile = path.join(hookDir, 'prepare-commit-msg');

if (!fs.existsSync(hookDir)) {
  console.error('.git/hooks directory not found. Are you in a git repository?');
  process.exit(1);
}

// Read existing configuration or use defaults
let config = {
  model: 'claude',
  style: 'conventional',
  lang: 'en',
  autoStage: false,
  fallbackMessage: 'chore: auto-commit'
};

// Try to read existing config file
const configFile = path.join(process.cwd(), 'smart-committer.config.json');
if (fs.existsSync(configFile)) {
  try {
    const configFileContent = fs.readFileSync(configFile, 'utf8');
    config = { ...config, ...JSON.parse(configFileContent) };
  } catch (err) {
    console.warn('Warning: Could not read existing config file, using defaults');
  }
}

// Create the hook script with enhanced functionality
const hookScript = `#!/bin/sh
# smart-committer prepare-commit-msg hook
# Generated on ${new Date().toISOString()}

# Configuration
MODEL="${config.model}"
STYLE="${config.style}"
LANG="${config.lang}"
AUTO_STAGE=${config.autoStage ? 'true' : 'false'}
FALLBACK_MESSAGE="${config.fallbackMessage}"

# Only run for normal commits, not merges or rebases
if [ -z "$2" ]; then
  # Auto-stage files if configured
  if [ "$AUTO_STAGE" = "true" ]; then
    echo "Auto-staging all changes..."
    git add -A
  fi
  
  # Check if there are staged changes
  if ! git diff --cached --quiet; then
    # Generate commit message using smart-committer
    echo "Generating commit message..."
    npx smart-committer --model "$MODEL" --style "$STYLE" --lang "$LANG" --diff staged > /tmp/commit-msg.txt 2>&1
    COMMIT_MSG_RESULT=$?
    
    if [ $COMMIT_MSG_RESULT -eq 0 ]; then
      # Extract the commit message from the output
      # This is a simplified approach - in a real implementation, 
      # you'd want to parse the smart-committer output more carefully
      COMMIT_MSG=$(grep -A 10 "Generated commit message:" /tmp/commit-msg.txt | tail -n +2 | head -n 1)
      
      if [ -n "$COMMIT_MSG" ] && [ "$COMMIT_MSG" != "Tip: Use --apply to automatically commit with this message" ]; then
        echo "$COMMIT_MSG" > "$1"
        echo "Commit message generated and applied."
      else
        echo "$FALLBACK_MESSAGE" > "$1"
        echo "Used fallback commit message."
      fi
    else
      # Fallback message if smart-committer fails
      echo "$FALLBACK_MESSAGE" > "$1"
      echo "smart-committer failed, used fallback commit message."
      echo "Error details:"
      cat /tmp/commit-msg.txt
    fi
    
    # Clean up temporary file
    rm -f /tmp/commit-msg.txt
  else
    echo "No staged changes found."
  fi
fi
`;

fs.writeFileSync(hookFile, hookScript, { mode: 0o755 });
console.log('Enhanced prepare-commit-msg hook installed!');
console.log('Configuration used:');
console.log(`  Model: ${config.model}`);
console.log(`  Style: ${config.style}`);
console.log(`  Language: ${config.lang}`);
console.log(`  Auto-stage: ${config.autoStage}`);
console.log(`  Fallback message: ${config.fallbackMessage}`);

// Also create or update the config file with hook settings
const hookConfig = {
  ...config,
  hooks: {
    autoStage: config.autoStage,
    fallbackMessage: config.fallbackMessage
  }
};

// Read existing config if it exists
let existingConfig = {};
if (fs.existsSync(configFile)) {
  try {
    existingConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch (err) {
    console.warn('Warning: Could not read existing config file');
  }
}

// Merge with existing config
const mergedConfig = { ...existingConfig, ...hookConfig };

// Write updated config
fs.writeFileSync(configFile, JSON.stringify(mergedConfig, null, 2));
console.log('Configuration file updated with hook settings.');