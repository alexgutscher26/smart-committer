# smart-committer

AI-assisted commit message generator that analyzes your code diffs using Claude (Anthropic).

## Features
- CLI tool to generate commit messages based on staged git diffs
- Uses Claude (Anthropic) for concise, relevant messages
- Optional support for conventional commit format

## Installation
```
npm install -g smart-committer
```

## Usage
```
smart-committer [options]
```

Options:
- `-c, --conventional`  Format message as a conventional commit

## Setup
1. Get your Claude API key from Anthropic.
2. Create a `.env` file in your project or home directory:
   ```
   CLAUDE_API_KEY=your_claude_api_key_here
   ```

## Example
```
git add .
smart-committer
```

## Smart Committer

AI-assisted commit message generator for Git, powered by Claude. Generate clear, consistent, and customizable commit messages for any workflow.

---

## Quick Start

1. **Install dependencies:**
   ```sh
   pnpm install
   # or
   npm install
   ```
2. **Set up your Claude API key:**
   - Create a `.env` file in your project root:
     ```env
     CLAUDE_API_KEY=sk-...
     ```
3. **(Optional) Create a config file:**
   - Add `smart-committer.config.json` to your project root to set defaults (see below).
4. **Run the CLI:**
   ```sh
   node cli.js --commit
   # or, if installed globally:
   smart-committer --commit
   ```

---

## Features

- **AI Model Selection:** Choose any Claude model (e.g., haiku, sonnet) via CLI or config.
- **Multi-language Support:** Generate commit messages in any language (e.g., en, es, fr, de, zh).
- **Commit Message Styles:** Supports plain, conventional, semantic, and summary-body formats.
- **Diff Source Selection:** Choose to generate messages from staged, unstaged, or all changes.
- **Custom Prompting:** Add extra context to guide the AI with `--extra-prompt`.
- **Batch Mode:** Generate commit messages for a range of commits (great after rebase/squash).
- **Pre-commit Hook Integration:** Automatically suggest messages before every commit.
- **Robust Error Handling:** Clear, actionable error messages for all failure scenarios.
- **Config File Support:** Set your preferred defaults in `smart-committer.config.json`.

---

## Configuration

### Config File (`smart-committer.config.json`)
Create this file in your repo root to set persistent defaults:
```json
{
  "model": "claude-3-haiku-20240307",
  "style": "conventional",
  "lang": "en",
  "diff": "staged",
  "type": "feat",
  "extraPrompt": "",
  "batch": false
}
```
**Precedence:** CLI > config file > built-in defaults

---

## CLI Options

| Option              | Description                                                                |
|---------------------|----------------------------------------------------------------------------|
| `--model <model>`   | Claude model to use (e.g., claude-3-haiku-20240307, claude-3-sonnet-20240229) |
| `--style <style>`   | Commit message style: plain, conventional, semantic, summary-body           |
| `--lang <lang>`     | Language for the commit message (en, es, fr, de, zh, etc.)                  |
| `--diff <source>`   | Diff source: staged, unstaged, all                                          |
| `--type <type>`     | Commit type for conventional style (feat, fix, chore, etc.)                 |
| `--extra-prompt <t>`| Extra context to guide the AI (e.g., "security fix")                        |
| `--commit`          | Directly create a git commit with the generated message                     |
| `--batch`           | Batch mode: generate messages for a commit range                            |

**Examples:**
```sh
smart-committer --style summary-body --lang fr --commit
smart-committer --diff all --extra-prompt "Urgent bugfix" --commit
smart-committer --batch --model claude-3-sonnet-20240229
```

---

## Batch Mode
Generate commit messages for a range of commits (e.g., after rebase):
```sh
smart-committer --batch
```
You will be prompted for a commit range (e.g., `HEAD~3..HEAD`).

---

## Pre-commit Hook Integration
Install a `prepare-commit-msg` hook to auto-suggest messages:
```sh
node install-hook.js
```
This creates `.git/hooks/prepare-commit-msg` that runs smart-committer. Edit `install-hook.js` to customize style/language.

---

## Error Handling & Troubleshooting
- **Missing API key:** Set `CLAUDE_API_KEY` in your `.env` file.
- **Network/API errors:** Check your connection and Claude API limits.
- **Invalid config:** Fix or delete `smart-committer.config.json` if parsing fails.
- **No changes found:** Stage or modify files before running.
- **Batch mode errors:** Ensure your commit range is valid and contains commits.

---

## License
MIT

