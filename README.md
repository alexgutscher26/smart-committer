# smart-committer

AI-assisted commit message generator that analyzes your code diffs using multiple AI models (Claude and OpenAI).

## Features

- Multiple AI models:
  - Claude (default): Anthropic's Claude 3 models (haiku, sonnet, opus)
  - OpenAI: GPT-4 and GPT-3.5 models
- Multiple diff sources:
  - Staged: Only staged changes
  - Unstaged: Only unstaged changes
  - All: All changes since last commit
- Multiple commit message styles:
  - Plain: Simple, direct messages
  - Conventional: Follows conventional commit format
  - Emoji: Includes relevant emoji
  - Gitmoji: Uses gitmoji format
- Multiple languages support
- Batch mode for generating messages for multiple commits
- Custom prompt templates
- Configurable via CLI options or config file
- Progress indicators and color-coded output
- Error handling and validation
- Large diff size handling with warnings
- Dry run mode for testing
- Configurable max diff size
- **Commit Scope Detection**: Automatically detect scope from file paths
- **Interactive Mode**: Refine AI-generated commit messages interactively
- **Commit History Analysis**: Learn project conventions from commit history
- **Multi-Model Ensemble**: Generate messages using multiple AI models
- **Template System**: Custom commit message templates with variable substitution
- **Commit Statistics**: Analytics and insights on commit patterns
- **Enhanced Git Hooks**: Improved hook functionality with auto-stage and fallback options

## Installation

```bash
npm install -g smart-committer
```

## Usage

```
smart-committer [options]
```

## Options

```
--model <model>              AI model to use (claude, openai) [default: claude]
--model-version <version>    Specific model version (haiku, sonnet, opus for Claude; 4, 4-turbo, 3.5-turbo for OpenAI)
--diff <source>             Diff source: staged, unstaged, all [default: staged]
--style <style>             Commit message style: plain, conventional, emoji, gitmoji [default: plain]
--lang <lang>               Language for commit message [default: en]
--batch                     Batch mode for analyzing multiple commits
--prompt <prompt>          Custom prompt template
--config <path>            Path to config file [default: .smartcommitter.json]
--apply                    Apply the generated message and commit changes
--dry-run                 Show what would be done without actually committing
--max-diff-size <size>    Maximum diff size in characters [default: 10000]
--detect-scope            Automatically detect scope from file paths
--scope <scope>           Manually specify scope for conventional commits
--interactive             Enable interactive mode to refine the commit message
--learn-history           Analyze commit history to learn project conventions
--ensemble                Use multiple AI models for generation
--template <name>         Use a specific commit template
--analyze                 Generate commit statistics and insights
```

## Setup

1. Install dependencies:

   ```
   npm install
   ```

2. Set up your API keys:
   - For Claude: `CLAUDE_API_KEY=your_claude_api_key_here`
   - For OpenAI: `OPENAI_API_KEY=your_openai_api_key_here`

   Create a `.env` file in your project root or home directory:

   ```
   CLAUDE_API_KEY=your_claude_api_key_here
   OPENAI_API_KEY=your_openai_api_key_here
   ```

## Examples

1. Basic usage:

   ```
   git add .
   smart-committer
   ```

2. Using conventional commit format with automatic scope detection:

   ```
   smart-committer --style conventional --detect-scope
   ```

3. Using interactive mode to refine the commit message:

   ```
   smart-committer --interactive
   ```

4. Using OpenAI model with ensemble generation:

   ```
   smart-committer --model openai --ensemble
   ```

5. Batch mode for multiple commits:

   ```
   smart-committer --batch
   ```

6. Using a custom template:

   ```
   smart-committer --template conventional
   ```

7. Analyzing commit history and generating statistics:

   ```
   smart-committer --learn-history --analyze
   ```

8. Using a config file:

   ```
   smart-committer --config ./commit-config.json
   ```

## Configuration

Create a `smart-committer.config.json` file with your preferred settings:

```json
{
  "model": "claude-3-haiku-20240307",
  "style": "conventional",
  "lang": "en",
  "diff": "staged",
  "batch": false,
  "detectScope": false,
  "interactive": false,
  "learnHistory": false,
  "ensemble": false,
  "template": "",
  "templatesDir": "./commit-templates",
  "analyze": false,
  "hooks": {
    "autoStage": false,
    "fallbackMessage": "chore: auto-commit"
  }
}
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

## New Features

### Commit Scope Detection

Automatically detect the scope of changes based on file paths and include it in conventional commit messages.

```sh
smart-committer --style conventional --detect-scope
# or manually specify scope
smart-committer --style conventional --scope api
```

### Interactive Mode

Refine AI-generated commit messages interactively with options to accept, edit, regenerate, or cancel.

```sh
smart-committer --interactive
```

### Commit History Analysis

Learn project conventions by analyzing previous commit messages.

```sh
smart-committer --learn-history
```

### Multi-Model Ensemble Generation

Generate commit messages using multiple AI models simultaneously.

```sh
smart-committer --ensemble
```

### Template System

Use custom commit templates with variable substitution.

```sh
smart-committer --template conventional
```

Create templates in the `./commit-templates` directory with variables like `{{scope}}`, `{{style}}`, `{{lang}}`, etc.

### Commit Statistics and Insights

Generate analytics and insights on commit patterns.

```sh
smart-committer --analyze
```

### Enhanced Git Hooks

Improved Git hook functionality with auto-stage and fallback message options.

Install hooks with:
```sh
node install-hook.js
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
  "batch": false,
  "detectScope": false,
  "interactive": false,
  "learnHistory": false,
  "ensemble": false,
  "template": "",
  "templatesDir": "./commit-templates",
  "analyze": false,
  "hooks": {
    "autoStage": false,
    "fallbackMessage": "chore: auto-commit"
  }
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
| `--detect-scope`    | Automatically detect scope from file paths                                  |
| `--interactive`     | Enable interactive mode to refine commit messages                           |
| `--learn-history`   | Analyze commit history to learn project conventions                         |
| `--ensemble`        | Use multiple AI models for generation                                       |
| `--template <name>` | Use a specific commit template                                              |
| `--analyze`         | Generate commit statistics and insights                                     |

**Examples:**

```sh
smart-committer --style conventional --detect-scope --commit
smart-committer --diff all --interactive --commit
smart-committer --ensemble --model claude-3-sonnet-20240229
smart-committer --template conventional --lang fr
```

---

## Template System

Create custom commit templates in the `./commit-templates` directory. Templates support variable substitution:

- `{{scope}}` - Commit scope (detected or specified)
- `{{style}}` - Commit style (conventional, plain, etc.)
- `{{lang}}` - Language
- `{{model}}` - AI model being used
- `{{diff}}` - Git diff content
- `{{detectedScope}}` - Automatically detected scope

Example template (`commit-templates/conventional.txt`):
```
Generate a conventional commit message for the following code changes.

{{#if detectedScope}}Use the scope "{{detectedScope}}" if appropriate.{{/if}}
{{#if scope}}Use the specified scope "{{scope}}" if appropriate.{{/if}}

Git diff:
{{diff}}

Format the commit message as: <type>(<scope>): <description>
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

Enhanced hook features:
- Auto-stage files before generating messages
- Fallback commit messages if generation fails
- Configurable through the `hooks` section in your config file

---

## Commit Statistics and Insights

Generate detailed analytics on your commit patterns:

```sh
smart-committer --analyze
```

This provides insights on:
- Commit types and frequencies
- Common scopes
- Message length statistics
- Commit frequency by time
- Author statistics
- Improvement suggestions

---

## Error Handling & Troubleshooting

- **Missing API key:** Set `CLAUDE_API_KEY` or `OPENAI_API_KEY` in your `.env` file.
- **Network/API errors:** Check your connection and API limits.
- **Invalid config:** Fix or delete `smart-committer.config.json` if parsing fails.
- **No changes found:** Stage or modify files before running.
- **Batch mode errors:** Ensure your commit range is valid and contains commits.
- **Template errors:** Check template syntax and file paths.

---

## License

MIT