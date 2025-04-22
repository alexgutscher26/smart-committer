#!/usr/bin/env node
require('dotenv').config();
const { Command } = require('commander');
const simpleGit = require('simple-git');
const fetch = require('node-fetch');

const program = new Command();
const git = simpleGit();

// Claude API endpoint and model
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-3-haiku-20240307'; // Use a public model

async function getStagedDiff() {
  // Try to get staged diff with '--cached', fallback to 'HEAD' if error
  try {
    // Most environments: staged changes
    return await git.diff(['--cached']);
  } catch (err) {
    try {
      // Fallback: diff against HEAD (includes staged changes)
      return await git.diff(['HEAD']);
    } catch (err2) {
      console.error('Could not get git diff for staged changes.');
      process.exit(1);
    }
  }
}

async function generateCommitMessage(diff) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    console.error('Error: CLAUDE_API_KEY not set in environment.');
    process.exit(1);
  }

  const prompt = `Analyze the following git diff and generate a concise, clear commit message describing the changes.\n\nGit diff:\n${diff}`;

  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 64,
      messages: [
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error: ${err}`);
  }
  const data = await response.json();
  return data.content[0].text.trim();
}

program
  .name('smart-committer')
  .description('AI-assisted commit message generator (powered by Claude)')
  .option('-c, --conventional', 'Format message as a conventional commit')
  .action(async (opts) => {
    try {
      const diff = await getStagedDiff();
      if (!diff.trim()) {
        console.log('No staged changes found.');
        process.exit(0);
      }
      let message = await generateCommitMessage(diff);
      if (opts.conventional) {
        message = `feat: ${message}`; // Simple prefix, can be improved
      }
      console.log('\nSuggested commit message:\n');
      console.log(message);
    } catch (err) {
      console.error('Failed to generate commit message:', err.message);
      process.exit(1);
    }
  });

program.parse(process.argv);
