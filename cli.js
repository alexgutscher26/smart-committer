#!/usr/bin/env node
require('dotenv').config();
const { Command } = require('commander');
const simpleGit = require('simple-git');

const program = new Command();
const git = simpleGit();

// Claude API endpoint and model
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-3-haiku-20240307'; // Use a public model

async function getDiffSource(source) {
  try {
    if (source === 'staged') {
      // Staged changes
      return await git.diff(['--cached']);
    } else if (source === 'unstaged') {
      // Unstaged (working tree) changes
      return await git.diff();
    } else if (source === 'all') {
      // All changes (HEAD vs working tree)
      return await git.diff(['HEAD']);
    } else {
      throw new Error('Unknown diff source. Use staged, unstaged, or all.');
    }
  } catch (err) {
    console.error('Could not get git diff for requested source.');
    process.exit(1);
  }
}

async function generateCommitMessage(diff, customPrompt) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    console.error('Error: CLAUDE_API_KEY not set in environment.');
    process.exit(1);
  }

  const prompt = customPrompt || `Analyze the following git diff and respond ONLY with a concise, clear, single-line commit message describing the changes. Do NOT include explanations, formatting, or extra text.\n\nGit diff:\n${diff}`;

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
  .option('--diff <source>', 'Diff source: staged, unstaged, all', 'staged')
  .option('--style <style>', 'Commit message style: plain, conventional, semantic, summary-body', 'plain')
  .option('--lang <lang>', 'Language for the commit message (e.g., en, es, fr, de, zh)', 'en')
  .option('--type <type>', 'Commit type for conventional style (feat, fix, chore, etc.)')
  .option('--commit', 'Directly create a git commit with the generated message')
  .action(async (opts) => {
    try {
      const diffSource = opts.diff || 'staged';
      const diff = await getDiffSource(diffSource);
      if (!diff.trim()) {
        console.log(`No ${diffSource} changes found.`);
        process.exit(0);
      }
      // Determine prompt and formatting based on style
      const style = opts.style || 'plain';
      let promptStyle = '';
      const type = opts.type || 'feat';
      const lang = opts.lang || 'en';
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
      const prompt = `${promptStyle}\n\nGit diff:\n${diff}`;
      let message = await generateCommitMessage(diff, prompt);
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
