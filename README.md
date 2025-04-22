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

## Git Hook Integration

You can install a `prepare-commit-msg` hook to automatically generate a commit message suggestion before each commit:

```
node install-hook.js
```

This will create a `.git/hooks/prepare-commit-msg` script that runs smart-committer. You can customize the style/language in `install-hook.js`.

## License
MIT

