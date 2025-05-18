import { Command } from 'commander';
import dotenv from 'dotenv';
import { SimpleGit, simpleGit, DefaultLogFields, ListLogLine } from 'simple-git';
import ora from 'ora';
import chalk from 'chalk';
import { z } from 'zod';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

// Load environment variables
dotenv.config();

// Configuration schema
const configSchema = z.object({
  model: z.enum(['claude', 'openai']).default('claude'),
  modelVersion: z.string().optional(),
  style: z.enum(['plain', 'conventional', 'emoji', 'gitmoji']).default('plain'),
  lang: z.string().default('en'),
  diff: z.enum(['staged', 'unstaged', 'all']).default('staged'),
  batch: z.boolean().default(false),
  customPrompt: z.string().optional(),
  maxDiffSize: z.number().default(10000),
  apply: z.boolean().default(false),
  dryRun: z.boolean().default(false)
});

type Config = z.infer<typeof configSchema>;

// AI Model configuration
const AI_MODELS = {
  claude: {
    url: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-3-haiku-20240307',
    models: {
      haiku: 'claude-3-haiku-20240307',
      sonnet: 'claude-3-sonnet-20240229',
      opus: 'claude-3-opus-20240229'
    }
  },
  openai: {
    defaultModel: 'gpt-4',
    models: {
      '4': 'gpt-4',
      '4-turbo': 'gpt-4-turbo-preview',
      '3.5-turbo': 'gpt-3.5-turbo'
    }
  }
};

// Type definitions
interface AIProvider {
  generateCommitMessage(diff: string, config: Config): Promise<string>;
  getModelName(): string;
}

// Claude API provider
class ClaudeProvider implements AIProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string | undefined, modelVersion?: string) {
    if (!apiKey) {
      throw new Error('Claude API key is required. Set CLAUDE_API_KEY in your environment.');
    }
    
    this.client = new Anthropic({ apiKey });
    
    // Set model based on version if provided
    if (modelVersion && modelVersion in AI_MODELS.claude.models) {
      this.model = AI_MODELS.claude.models[modelVersion as keyof typeof AI_MODELS.claude.models];
    } else if (modelVersion) {
      // Use directly provided model string
      this.model = modelVersion;
    } else {
      this.model = AI_MODELS.claude.defaultModel;
    }
  }

  getModelName(): string {
    return this.model;
  }

  async generateCommitMessage(diff: string, config: Config): Promise<string> {
    const spinner = ora(`Generating commit message with Claude (${this.model})...`).start();
    
    try {
      const prompt = this.buildPrompt(diff, config);
      
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      });

      if (!response.content) {
        throw new Error('No content received from Claude');
      }

      // Find the first text block in the response
      const textBlock = response.content.find(block => 'text' in block);
      if (!textBlock) {
        throw new Error('No text content received from Claude');
      }

      spinner.succeed('Generated commit message');
      return textBlock.text.trim();
    } catch (error) {
      spinner.fail('Failed to generate commit message');
      console.error(chalk.red(`Error details: ${error instanceof Error ? error.message : String(error)}`));
      throw error;
    }
  }

  private buildPrompt(diff: string, config: Config): string {
    let prompt = 'You are a professional software developer. Generate a concise, clear commit message describing the code changes.';
    
    if (config.customPrompt) {
      prompt = config.customPrompt;
    } else {
      if (config.style === 'conventional') {
        prompt += ' Use conventional commit format with appropriate type (feat, fix, docs, style, refactor, perf, test, build, ci, chore).';
      } else if (config.style === 'emoji') {
        prompt += ' Include a relevant emoji at the start.';
      } else if (config.style === 'gitmoji') {
        prompt += ' Use gitmoji format (https://gitmoji.dev/) with appropriate emoji code.';
      }
      
      if (config.lang && config.lang !== 'en') {
        prompt += ` Write the message in ${config.lang}.`;
      }
    }
    
    prompt += `\n\nGit diff:\n${diff}`;
    
    // Add character limit guidance
    prompt += '\n\nImportant guidelines:';
    prompt += '\n1. Ensure the message is under 72 characters for the first line.';
    prompt += '\n2. Use present tense.';
    prompt += '\n3. Focus on WHY the change was made, not just what was changed.';
    prompt += '\n4. If appropriate, include a body with more details after a blank line.';
    prompt += '\n5. Return ONLY the commit message without any additional formatting or explanation.';
    
    return prompt;
  }
}

// OpenAI provider
class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string | undefined, modelVersion?: string) {
    if (!apiKey) {
      throw new Error('OpenAI API key is required. Set OPENAI_API_KEY in your environment.');
    }
    
    this.client = new OpenAI({ apiKey });
    
    // Set model based on version if provided
    if (modelVersion && modelVersion in AI_MODELS.openai.models) {
      this.model = AI_MODELS.openai.models[modelVersion as keyof typeof AI_MODELS.openai.models];
    } else if (modelVersion) {
      // Use directly provided model string
      this.model = modelVersion;
    } else {
      this.model = AI_MODELS.openai.defaultModel;
    }
  }

  getModelName(): string {
    return this.model;
  }

  async generateCommitMessage(diff: string, config: Config): Promise<string> {
    const spinner = ora(`Generating commit message with OpenAI (${this.model})...`).start();
    
    try {
      const prompt = this.buildPrompt(diff, config);
      
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 1000
      });

      if (!completion.choices[0]?.message?.content) {
        throw new Error('No content received from OpenAI');
      }

      spinner.succeed('Generated commit message');
      return completion.choices[0].message.content.trim();
    } catch (error) {
      spinner.fail('Failed to generate commit message');
      console.error(chalk.red(`Error details: ${error instanceof Error ? error.message : String(error)}`));
      throw error;
    }
  }

  private buildPrompt(diff: string, config: Config): string {
    let prompt = 'You are a professional software developer. Generate a concise, clear commit message describing the code changes.';
    
    if (config.customPrompt) {
      prompt = config.customPrompt;
    } else {
      if (config.style === 'conventional') {
        prompt += ' Use conventional commit format with appropriate type (feat, fix, docs, style, refactor, perf, test, build, ci, chore).';
      } else if (config.style === 'emoji') {
        prompt += ' Include a relevant emoji at the start.';
      } else if (config.style === 'gitmoji') {
        prompt += ' Use gitmoji format (https://gitmoji.dev/) with appropriate emoji code.';
      }
      
      if (config.lang && config.lang !== 'en') {
        prompt += ` Write the message in ${config.lang}.`;
      }
    }
    
    prompt += `\n\nGit diff:\n${diff}`;
    
    // Add character limit guidance
    prompt += '\n\nImportant guidelines:';
    prompt += '\n1. Ensure the message is under 72 characters for the first line.';
    prompt += '\n2. Use present tense.';
    prompt += '\n3. Focus on WHY the change was made, not just what was changed.';
    prompt += '\n4. If appropriate, include a body with more details after a blank line.';
    prompt += '\n5. Return ONLY the commit message without any additional formatting or explanation.';
    
    return prompt;
  }
}

// Git utilities
class GitUtils {
  private git: SimpleGit;
  private execAsync = promisify(exec);

  constructor() {
    this.git = simpleGit();
  }

  async isGitRepo(): Promise<boolean> {
    try {
      await this.git.revparse(['--is-inside-work-tree']);
      return true;
    } catch (error) {
      return false;
    }
  }

  async getDiffSource(source: string): Promise<string> {
    try {
      let diff = '';
      
      if (source === 'staged') {
        diff = await this.git.diff(['--cached']);
      } else if (source === 'unstaged') {
        diff = await this.git.diff();
      } else if (source === 'all') {
        diff = await this.git.diff(['HEAD']);
      } else {
        throw new Error('Unknown diff source. Use staged, unstaged, or all.');
      }
      
      if (!diff.trim()) {
        throw new Error(`No ${source} changes found. Make sure you have staged or made changes.`);
      }
      
      return diff;
    } catch (error) {
      throw new Error(`Git diff error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async commitWithMessage(message: string): Promise<string> {
    try {
      const result = await this.execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`);
      return result.stdout;
    } catch (error) {
      throw new Error(`Commit error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getLogForRange(range: string): Promise<(DefaultLogFields & ListLogLine)[]> {
    try {
      const log = await this.git.log({
        from: range.split('..')[0],
        to: range.split('..')[1] || 'HEAD'
      });
      return [...log.all];
    } catch (error) {
      throw new Error(`Git log error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getDiffForCommit(commitHash: string): Promise<string> {
    try {
      return await this.git.diff([`${commitHash}^..${commitHash}`]);
    } catch (error) {
      throw new Error(`Git diff error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

// Main application
class SmartCommitter {
  private config: Config;
  private gitUtils: GitUtils;
  
  constructor(config: Config) {
    this.config = config;
    this.gitUtils = new GitUtils();
  }

  async run(): Promise<void> {
    try {
      // Check if we're in a git repository
      const isRepo = await this.gitUtils.isGitRepo();
      if (!isRepo) {
        throw new Error('Not in a git repository. Please run this command from a git repository.');
      }

      // Get diff based on configuration
      const diff = await this.gitUtils.getDiffSource(this.config.diff);
      
      // Check diff size
      if (diff.length > this.config.maxDiffSize) {
        console.warn(chalk.yellow(`⚠️ Warning: Diff is large (${diff.length} chars). This may affect API response time and quality.`));
        console.warn(chalk.yellow(`   Consider committing smaller changes or increasing the maxDiffSize option if needed.`));
      }
      
      // Initialize AI provider
      const provider = this.createProvider();
      console.log(chalk.blue(`Using ${this.config.model} model: ${provider.getModelName()}`));
      
      if (this.config.batch) {
        await this.processBatchMode(provider);
      } else {
        await this.processSingleCommit(provider, diff);
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  }

  private createProvider(): AIProvider {
    if (this.config.model === 'openai') {
      const apiKey = process.env.OPENAI_API_KEY;
      return new OpenAIProvider(apiKey, this.config.modelVersion);
    } else {
      const apiKey = process.env.CLAUDE_API_KEY;
      return new ClaudeProvider(apiKey, this.config.modelVersion);
    }
  }

  private async processSingleCommit(provider: AIProvider, diff: string): Promise<void> {
    // Generate commit message
    const message = await provider.generateCommitMessage(diff, this.config);
    
    console.log(chalk.green('Generated commit message:'));
    console.log(chalk.bold(message));
    
    if (this.config.apply) {
      if (this.config.dryRun) {
        console.log(chalk.yellow('Dry run mode: Would commit with the message above'));
      } else {
        try {
          const result = await this.gitUtils.commitWithMessage(message);
          console.log(chalk.green('Committed successfully!'));
          console.log(result);
        } catch (error) {
          console.error(chalk.red(`Failed to commit: ${error instanceof Error ? error.message : String(error)}`));
        }
      }
    } else {
      console.log(chalk.blue('Tip: Use --apply to automatically commit with this message'));
    }
  }

  private async processBatchMode(provider: AIProvider): Promise<void> {
    // For batch mode, we need to prompt for commit range
    const { default: inquirer } = await import('inquirer');
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'range',
        message: 'Enter commit range (e.g., HEAD~3..HEAD)',
        default: 'HEAD~3..HEAD'
      }
    ]);

    // Get commits for the range
    const commits = await this.gitUtils.getLogForRange(answers.range);
    
    if (commits.length === 0) {
      console.log(chalk.yellow('No commits found in the specified range.'));
      return;
    }
    
    console.log(chalk.blue(`Found ${commits.length} commits in range`));
    
    // Process each commit
    for (const commit of commits) {
      console.log(`\n${chalk.cyan('Processing commit:')} ${commit.hash} - ${commit.message}`);
      
      try {
        const commitDiff = await this.gitUtils.getDiffForCommit(commit.hash);
        const generatedMessage = await provider.generateCommitMessage(commitDiff, this.config);
        
        console.log(chalk.green('Original message:'), chalk.dim(commit.message));
        console.log(chalk.green('Generated message:'), chalk.bold(generatedMessage));
        
        // If we're in batch mode, we can't apply the messages directly
        // but we can show the user the comparisons
      } catch (error) {
        console.error(chalk.red(`Error processing commit ${commit.hash}: ${error instanceof Error ? error.message : String(error)}`));
      }
    }
  }
}

// Load configuration from file
function loadConfig(configPath: string): Partial<Config> {
  try {
    if (!fs.existsSync(configPath)) {
      return {};
    }
    
    const configFile = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(configFile);
  } catch (error) {
    console.error(chalk.red(`Error loading config file: ${error instanceof Error ? error.message : String(error)}`));
    return {};
  }
}

// Main function
async function main() {
  const program = new Command();

  program
    .name('smart-committer')
    .version('0.3.0')
    .description('AI-assisted commit message generator')
    .option('--model <model>', 'AI model to use (claude, openai)', 'claude')
    .option('--model-version <version>', 'Specific model version (haiku, sonnet, opus for Claude; 4, 4-turbo, 3.5-turbo for OpenAI)')
    .option('--diff <source>', 'Diff source: staged, unstaged, all', 'staged')
    .option('--style <style>', 'Commit message style: plain, conventional, emoji, gitmoji', 'plain')
    .option('--lang <lang>', 'Language for commit message', 'en')
    .option('--batch', 'Batch mode for analyzing multiple commits')
    .option('--prompt <prompt>', 'Custom prompt template')
    .option('--config <path>', 'Path to config file', '.smartcommitter.json')
    .option('--apply', 'Apply the generated message and commit changes')
    .option('--dry-run', 'Show what would be done without actually committing')
    .option('--max-diff-size <size>', 'Maximum diff size in characters', '10000')
    .action(async (cliOpts) => {
      try {
        // Load config file if it exists
        const fileConfig = loadConfig(cliOpts.config);
        
        // Merge config sources with CLI options taking precedence
        const mergedConfig = {
          ...fileConfig,
          ...Object.fromEntries(
            Object.entries(cliOpts)
              .filter(([_, value]) => value !== undefined)
              .map(([key, value]) => [
                // Convert kebab-case to camelCase for config keys
                key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()),
                value
              ])
          )
        };
        
        // Parse and validate config
        const config = configSchema.parse(mergedConfig);
        
        // Initialize and run the application
        const app = new SmartCommitter(config);
        await app.run();
      } catch (error) {
        if (error instanceof z.ZodError) {
          console.error(chalk.red('Invalid configuration:'));
          console.error(error.errors.map(e => `- ${e.path.join('.')}: ${e.message}`).join('\n'));
        } else {
          console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
        }
        process.exit(1);
      }
    });

  program.parse(process.argv);
}

// Run the application
main();