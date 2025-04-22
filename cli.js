#!/usr/bin/env node
require('dotenv').config();
const { Command } = require('commander');
const simpleGit = require('simple-git');

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

/**
 * Generates a concise commit message from a git diff using an AI API.
 *
 * @async
 * @param {string} diff - The git diff to be analyzed.
 * @returns {Promise<string>} A promise that resolves with the generated commit message.
 * @throws {Error} If the CLAUDE_API_KEY is not set in the environment or if there's an error from the Claude API.
 *
 * @example
 * generateCommitMessage("diff --git a/file.txt b/file.txt\nnew file mode 100644").then(message => {
 *   console.log(message); // Example commit message: "Add new file.txt"
 * });
 */
async function generateCommitMessage(diff) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    console.error('Error: CLAUDE_API_KEY not set in environment.');
    process.exit(1);
  }

  const prompt = `Analyze the following git diff and respond ONLY with a concise, clear, single-line commit message describing the changes. Do NOT include explanations, formatting, or extra text.\n\nGit diff:\n${diff}`;

  // Use global fetch if available (Node 18+), otherwise use node-fetch
  let fetchFn = global.fetch;
  if (!fetchFn) {
    fetchFn = (await import('node-fetch')).default;
  }

  const response = await fetchFn(CLAUDE_API_URL, {
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
  // Use only the first non-empty line as the commit message
  const raw = data.content[0].text.trim();
  const firstLine = raw.split('\n').find(line => line.trim().length > 0) || raw;
  return firstLine.trim();
}

program
  .name('smart-committer')
  .description('AI-assisted commit message generator (powered by Claude)')
  .option('-c, --conventional', 'Format message as a conventional commit')
  .option('--commit', 'Directly create a git commit with the generated message')
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

      if (opts.commit) {
        // Directly commit with the generated message
        try {
          const commitResult = await git.commit(message);
          console.log('\nCommitted with message above.');
          // Optionally show commit hash/summary
          if (commitResult.commit) {
            console.log(`Commit hash: ${commitResult.commit}`);
          }
        } catch (commitErr) {
          console.error('Failed to create commit:', commitErr.message);
          process.exit(1);
        }
      }
    } catch (err) {
      console.error('Failed to generate commit message:', err.message);
      process.exit(1);
    }
  });

program.parse(process.argv);
