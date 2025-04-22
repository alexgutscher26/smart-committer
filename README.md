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

## License
MIT

