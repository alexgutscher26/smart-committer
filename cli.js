#!/usr/bin/env node
require('dotenv').config();
const { Command } = require('commander');
const fs = require('fs');
const path = require('path');
const simpleGit = require('simple-git');

const program = new Command();
const git = simpleGit();

// Claude API endpoint and model
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
// Model is now selected via CLI/config, not hardcoded

async function getDiffSource(source) {
  try {
    if (source === 'staged') {
      // Staged changes
      return await git.diff(['--cached']);
    }
    if (source === 'unstaged') {
      // Unstaged (working tree) changes
      return await git.diff();
    }
    if (source === 'all') {
      // All changes (HEAD vs working tree)
      return await git.diff(['HEAD']);
    }
    throw new Error('Unknown diff source. Use staged, unstaged, or all.');
  } catch (err) {
    console.error('Could not get git diff for requested source.');
    process.exit(1);
  }
}

/**
 * Generates a concise commit message from a git diff using Claude API.
 *
 * @param {string} diff - The git diff to analyze.
 * @param {string} customPrompt - (Optional) A custom prompt for the Claude model. Defaults to analyzing the git diff and generating a single-line commit message.
 * @param {string} model - (Optional) The Claude API model to use. Default is 'claude-3-haiku-20240307'.
 * @returns {Promise<string>} A promise that resolves with the generated commit message or rejects on error.
 *
 * @throws {Error} If the CLAUDE_API_KEY environment variable is not set.
 * @throws {Error} If the network request to the Claude API fails.
 * @throws {Error} If the Claude API returns an unexpected response.
 *
 * @example
 * generateCommitMessage('diff --git a/example.txt b/example.txt\nnew file mode 100644').then(message => {
 *   console.log(message); // "Add example.txt"
 * }).catch(error => {
 *   console.error(error);
 * });
 */
async function generateCommitMessage(diff, customPrompt, model = 'claude-3-haiku-20240307') {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    console.error('Error: CLAUDE_API_KEY not set in environment. Please add it to your .env file.');
    process.exit(2);
  }

  const prompt = customPrompt || `Analyze the following git diff and respond ONLY with a concise, clear, single-line commit message describing the changes. Do NOT include explanations, formatting, or extra text.\n\nGit diff:\n${diff}`;

  // Use global fetch if available (Node 18+), otherwise use node-fetch
  let fetchFn = global.fetch;
  if (!fetchFn) {
    try {
      fetchFn = (await import('node-fetch')).default;
    } catch (e) {
      console.error('Failed to load node-fetch. Please install node-fetch or upgrade Node.js.');
      process.exit(1);
    }
  }

  let response;
  try {
    response = await fetchFn(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: model, 
        max_tokens: 64,
        messages: [
          { role: 'user', content: prompt }
        ]
      })
    });
  } catch (err) {
    console.error('Network error: Failed to contact Claude API.');
    console.error('Check your internet connection and try again.');
    process.exit(1);
  }

  if (!response.ok) {
    let errText = '';
    try {
      errText = await response.text();
    } catch {}
    console.error(`Claude API error: ${errText}`);
    console.error('Check your API key, network connection, and Claude API limits.');
    process.exit(1);
  }

  let data;
  try {
    data = await response.json();
  } catch (e) {
    console.error('Failed to parse Claude API response as JSON.');
    process.exit(1);
  }
  if (!data || !data.content || !Array.isArray(data.content) || !data.content[0] || !data.content[0].text) {
    console.error('Claude API returned an unexpected response.');
    process.exit(1);
  }
  // Use only the first non-empty line as the commit message
  const raw = data.content[0].text.trim();
  const firstLine = raw.split('\n').find(line => line.trim().length > 0) || raw;
  return firstLine.trim();
}

// Load config file if present
let config = {};
const configPath = path.join(process.cwd(), 'smart-committer.config.json');
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    console.error('Failed to parse smart-committer.config.json:', e.message);
    process.exit(1);
  }
}

program
  .name('smart-committer')
  .option('--model <model>', 'Claude model to use (e.g., claude-3-haiku-20240307, claude-3-sonnet-20240229)', 'claude-3-haiku-20240307')
  .description('AI-assisted commit message generator (powered by Claude)')
  .option('--diff <source>', 'Diff source: staged, unstaged, all', 'staged')
  .option('--style <style>', 'Commit message style: plain, conventional, semantic, summary-body', 'plain')
  .option('--extra-prompt <text>', 'Extra context or intent to guide the AI (e.g., "this is a bugfix")')
  .option('--lang <lang>', 'Language for the commit message (e.g., en, es, fr, de, zh)', 'en')
  .option('--type <type>', 'Commit type for conventional style (feat, fix, chore, etc.)')
  .option('--commit', 'Directly create a git commit with the generated message')
  .option('--batch', 'Batch mode: generate commit messages for a range of commits (e.g., after rebase/squash)')
  .action(async (opts) => {
    // Option precedence: CLI > config file > built-in default
    const style = opts.style || config.style || 'plain';
    const lang = opts.lang || config.lang || 'en';
    const diffSource = opts.diff || config.diff || 'staged';
    const type = opts.type || config.type || 'feat';
    const extraPrompt = opts.extraPrompt || config.extraPrompt || '';
    const batch = typeof opts.batch !== 'undefined' ? opts.batch : (config.batch || false);
    const model = opts.model || config.model || 'claude-3-haiku-20240307';
    try {
      if (batch) {
        // Batch mode: prompt for commit range, generate for each
        try {
          const inquirer = (await import('inquirer')).default;
          const { commitRange } = await inquirer.prompt([
            {
              type: 'input',
              name: 'commitRange',
              message: 'Enter commit range (e.g., HEAD~3..HEAD):',
              default: 'HEAD~3..HEAD',
            },
          ]);
          // Validate commit range
          if (!commitRange.includes('..')) {
            console.error('Invalid commit range format. Use e.g., HEAD~3..HEAD.');
            process.exit(1);
          }
          // Get commit hashes in range
          let log;
          try {
            log = await git.log({ from: commitRange.split('..')[0], to: commitRange.split('..')[1] });
          } catch (logErr) {
            console.error('Failed to get git log for the given range. Make sure the range is valid and you have enough commits.');
            process.exit(1);
          }
          if (!log.all.length) {
            console.error('No commits found in the specified range.');
            process.exit(1);
          }
          for (const entry of log.all) {
            let diff;
            try {
              diff = await git.diff([`${entry.hash}^!`]);
            } catch (diffErr) {
              console.error(`Failed to get diff for commit ${entry.hash}. Skipping.`);
              continue;
            }
            if (!diff.trim()) {
              console.warn(`Empty diff for commit ${entry.hash}, skipping.`);
              continue;
            }
            // Use the same prompt construction as below
            let promptStyle = '';
            if (style === 'conventional') {
              promptStyle = `Respond ONLY with a Conventional Commit message (type: ${type}), no explanation or formatting. Write the message in ${lang}.`;
            } else if (style === 'semantic') {
              promptStyle = `Respond ONLY with a clear, multi-line, semantic commit message (summary + body), no explanation or formatting. Write the message in ${lang}.`;
            } else if (style === 'summary-body') {
              promptStyle = `Respond ONLY with a commit message in the following format:\n<one-line summary>\n\n<detailed body>. Do NOT include explanations, formatting, or extra text. Write the message in ${lang}.`;
            } else {
              promptStyle = `Respond ONLY with a concise, clear, single-line commit message, no explanation or formatting. Write the message in ${lang}.`;
            }
            let prompt = `${promptStyle}\n\nGit diff:\n${diff}`;
            if (extraPrompt) {
              prompt += `\n\nExtra context: ${extraPrompt}`;
            }
            let message;
            try {
              message = await generateCommitMessage(diff, prompt, model);
            } catch (apiErr) {
              console.error(`Claude API error for commit ${entry.hash}: ${apiErr.message}`);
              console.error('Check your API key, network connection, and Claude API limits.');
              continue;
            }
            if (style === 'conventional') {
              message = `${type}: ${message}`;
            } else if (style === 'summary-body') {
              const [summary, ...rest] = message.split(/\r?\n\r?\n/);
              const body = rest.join('\n\n').trim();
              message = summary.trim() + (body ? `\n\n${body}` : '');
            }
            console.log(`\nCommit: ${entry.hash}\nSuggested message:\n${message}\n`);
          }
        } catch (err) {
          console.error('Batch mode failed:', err.message);
          process.exit(1);
        }
        process.exit(0);
      }
      let diff;
      try {
        diff = await getDiffSource(diffSource);
      } catch (diffErr) {
        console.error('Failed to get git diff:', diffErr.message);
        console.error('Try staging your changes or check your git repository status.');
        process.exit(1);
      }
      if (!diff.trim()) {
        console.error(`No ${diffSource} changes found. Try staging or modifying files first.`);
        process.exit(1);
      }
      // Determine prompt and formatting based on style
      let promptStyle = '';
      if (style === 'conventional') {
        promptStyle = `Respond ONLY with a Conventional Commit message (type: ${type}), no explanation or formatting. Write the message in ${lang}.`;
      } else if (style === 'semantic') {
        promptStyle = `Respond ONLY with a clear, multi-line, semantic commit message (summary + body), no explanation or formatting. Write the message in ${lang}.`;
      } else if (style === 'summary-body') {
        promptStyle = `Respond ONLY with a commit message in the following format:\n<one-line summary>\n\n<detailed body>. Do NOT include explanations, formatting, or extra text. Write the message in ${lang}.`;
      } else {
        promptStyle = `Respond ONLY with a concise, clear, single-line commit message, no explanation or formatting. Write the message in ${lang}.`;
      }
      // Compose prompt for Claude
      let prompt = `${promptStyle}\n\nGit diff:\n${diff}`;
      if (extraPrompt) {
        prompt += `\n\nExtra context: ${extraPrompt}`;
      }
      let message;
      try {
        message = await generateCommitMessage(diff, prompt);
      } catch (apiErr) {
        console.error('Claude API error:', apiErr.message);
        console.error('Check your CLAUDE_API_KEY, network connection, and Claude API limits.');
        process.exit(1);
      }
      // Post-process for conventional style
      if (style === 'conventional') {
        message = `${type}: ${message}`;
      } else if (style === 'summary-body') {
        // Only keep up to two paragraphs (summary and body)
        const [summary, ...rest] = message.split(/\r?\n\r?\n/);
        const body = rest.join('\n\n').trim();
        message = summary.trim() + (body ? `\n\n${body}` : '');
      }
      console.log('\nSuggested commit message:\n');
      console.log(message);

      if (opts.commit) {
        // Interactive edit/approve step
        // Dynamically import inquirer for ESM compatibility
        const inquirer = (await import('inquirer')).default;
        const { approvedMessage, doCommit } = await inquirer.prompt([
          {
            type: 'input',
            name: 'approvedMessage',
            message: 'Edit commit message (or press Enter to accept):',
            default: message,
          },
          {
            type: 'confirm',
            name: 'doCommit',
            message: 'Commit with this message?',
            default: true,
          }
        ]);
        if (!doCommit) {
          console.log('Aborted commit.');
          process.exit(0);
        }
        try {
          const commitResult = await git.commit(approvedMessage);
          console.log('\nCommitted with message above.');
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
