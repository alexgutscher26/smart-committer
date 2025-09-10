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
  dryRun: z.boolean().default(false),
  detectScope: z.boolean().default(false),
  scope: z.string().optional(),
  interactive: z.boolean().default(false),
  learnHistory: z.boolean().default(false),
  ensemble: z.boolean().default(false),
  template: z.string().optional(),
  templatesDir: z.string().default('./commit-templates'),
  analyze: z.boolean().default(false), // New option for analysis mode
  hooks: z.object({
    autoStage: z.boolean().default(false),
    fallbackMessage: z.string().default('chore: auto-commit')
  }).optional()
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
    // Check if a template is specified
    if (config.template) {
      const variables = {
        scope: config.scope,
        style: config.style,
        lang: config.lang,
        model: this.getModelName()
      };
      
      const templateContent = loadAndProcessTemplate(config.template, config.templatesDir || './commit-templates', variables);
      if (templateContent) {
        // Replace placeholders in the template with actual values
        let prompt = templateContent.replace('{{diff}}', diff);
        
        // Add any additional context that might be useful
        if (config.detectScope) {
          const gitUtils = new GitUtils();
          const detectedScope = gitUtils.detectScopeFromDiff(diff);
          if (detectedScope) {
            prompt = prompt.replace('{{detectedScope}}', detectedScope);
          }
        }
        
        return prompt;
      } else {
        console.warn(chalk.yellow(`Failed to load template "${config.template}", using default prompt`));
      }
    }

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

  /**
   * Detect the scope of changes based on file paths in the diff
   * @param diff The git diff string
   * @returns The detected scope or null if no clear scope is found
   */
  detectScopeFromDiff(diff: string): string | null {
    // Extract file paths from the diff
    const filePaths: string[] = [];
    const lines = diff.split('\n');
    
    for (const line of lines) {
      // Look for lines that indicate file changes in diff format
      if (line.startsWith('--- a/') || line.startsWith('+++ b/')) {
        const filePath = line.substring(6); // Remove '--- a/' or '+++ b/'
        if (filePath && filePath !== '/dev/null') {
          filePaths.push(filePath);
        }
      }
    }
    
    if (filePaths.length === 0) {
      return null;
    }
    
    // Extract directory names and find common patterns
    const dirNames: string[] = [];
    for (const filePath of filePaths) {
      // Get the first directory component
      const parts = filePath.split('/');
      if (parts.length > 1) {
        dirNames.push(parts[0]);
      } else {
        // For files in root directory, use the filename without extension
        const fileName = filePath.split('.')[0];
        dirNames.push(fileName);
      }
    }
    
    // Count occurrences of each directory name
    const dirCount: Record<string, number> = {};
    for (const dir of dirNames) {
      dirCount[dir] = (dirCount[dir] || 0) + 1;
    }
    
    // Find the most common directory
    let maxCount = 0;
    let commonDir: string | null = null;
    
    for (const [dir, count] of Object.entries(dirCount)) {
      if (count > maxCount) {
        maxCount = count;
        commonDir = dir;
      }
    }
    
    // If the most common directory appears in more than 50% of files, use it as scope
    if (commonDir && maxCount > filePaths.length / 2) {
      return commonDir;
    }
    
    // Special handling for common project structures
    const specialDirs = ['src', 'lib', 'test', 'tests', 'components', 'pages', 'utils', 'config'];
    for (const dir of specialDirs) {
      if (dirNames.includes(dir)) {
        // Check if this directory is common among files
        const dirOccurrences = dirNames.filter(d => d === dir).length;
        if (dirOccurrences > filePaths.length / 3) {
          // Look at the next level directory for more specific scope
          const nextLevelDirs: string[] = [];
          for (const filePath of filePaths) {
            const parts = filePath.split('/');
            if (parts.length > 1 && parts[0] === dir && parts[1]) {
              nextLevelDirs.push(parts[1]);
            }
          }
          
          if (nextLevelDirs.length > 0) {
            // Count occurrences of next level directories
            const nextLevelCount: Record<string, number> = {};
            for (const nextDir of nextLevelDirs) {
              nextLevelCount[nextDir] = (nextLevelCount[nextDir] || 0) + 1;
            }
            
            // Find the most common next level directory
            let maxNextCount = 0;
            let commonNextDir: string | null = null;
            
            for (const [nextDir, count] of Object.entries(nextLevelCount)) {
              if (count > maxNextCount) {
                maxNextCount = count;
                commonNextDir = nextDir;
              }
            }
            
            if (commonNextDir && maxNextCount > nextLevelDirs.length / 2) {
              return `${dir}/${commonNextDir}`;
            }
          }
          
          return dir;
        }
      }
    }
    
    return null;
  }

  /**
   * Analyze commit history to learn project conventions
   * @param limit Number of commits to analyze (default: 50)
   * @returns Analysis results including common patterns
   */
  async analyzeCommitHistory(limit: number = 50): Promise<{
    commitTypes: Record<string, number>;
    commonScopes: Record<string, number>;
    averageMessageLength: number;
    mostCommonPrefix: string;
  }> {
    try {
      // Get commit history
      const log = await this.git.log({
        maxCount: limit
      });
      
      // Initialize analysis results
      const commitTypes: Record<string, number> = {};
      const commonScopes: Record<string, number> = {};
      let totalMessageLength = 0;
      const prefixCount: Record<string, number> = {};
      
      // Analyze each commit message
      for (const commit of log.all) {
        const message = commit.message.trim();
        totalMessageLength += message.length;
        
        // Extract commit type (for conventional commits)
        const typeMatch = message.match(/^(\w+)(?:\(.+\))?:/);
        if (typeMatch) {
          const type = typeMatch[1];
          commitTypes[type] = (commitTypes[type] || 0) + 1;
        }
        
        // Extract scope (for conventional commits)
        const scopeMatch = message.match(/^\w+\((.+)\):/);
        if (scopeMatch) {
          const scope = scopeMatch[1];
          commonScopes[scope] = (commonScopes[scope] || 0) + 1;
        }
        
        // Track common prefixes (first 10 characters)
        if (message.length >= 10) {
          const prefix = message.substring(0, 10);
          prefixCount[prefix] = (prefixCount[prefix] || 0) + 1;
        }
      }
      
      // Calculate average message length
      const averageMessageLength = log.all.length > 0 ? totalMessageLength / log.all.length : 0;
      
      // Find most common prefix
      let mostCommonPrefix = '';
      let maxPrefixCount = 0;
      for (const [prefix, count] of Object.entries(prefixCount)) {
        if (count > maxPrefixCount) {
          maxPrefixCount = count;
          mostCommonPrefix = prefix;
        }
      }
      
      return {
        commitTypes,
        commonScopes,
        averageMessageLength,
        mostCommonPrefix
      };
    } catch (error) {
      throw new Error(`Git log analysis error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate detailed commit statistics and insights
   * @param limit Number of commits to analyze (default: 100)
   * @returns Detailed analysis results
   */
  async generateCommitStatistics(limit: number = 100): Promise<{
    totalCommits: number;
    commitTypes: Record<string, number>;
    commonScopes: Record<string, number>;
    messageLengths: {
      min: number;
      max: number;
      average: number;
      median: number;
    };
    commitFrequency: {
      daily: Record<string, number>;
      hourly: Record<string, number>;
    };
    authorStats: Record<string, { commits: number; avgMessageLength: number }>;
    suggestions: string[];
  }> {
    try {
      // Get commit history
      const log = await this.git.log({
        maxCount: limit
      });
      
      // Initialize analysis results
      const commitTypes: Record<string, number> = {};
      const commonScopes: Record<string, number> = {};
      const messageLengths: number[] = [];
      const dailyCommits: Record<string, number> = {};
      const hourlyCommits: Record<string, number> = {};
      const authorStats: Record<string, { commits: number; messageLengths: number[] }> = {};
      
      // Analyze each commit message
      for (const commit of log.all) {
        const message = commit.message.trim();
        messageLengths.push(message.length);
        
        // Extract commit type (for conventional commits)
        const typeMatch = message.match(/^(\w+)(?:\(.+\))?:/);
        if (typeMatch) {
          const type = typeMatch[1];
          commitTypes[type] = (commitTypes[type] || 0) + 1;
        }
        
        // Extract scope (for conventional commits)
        const scopeMatch = message.match(/^\w+\((.+)\):/);
        if (scopeMatch) {
          const scope = scopeMatch[1];
          commonScopes[scope] = (commonScopes[scope] || 0) + 1;
        }
        
        // Track commit dates
        const date = new Date(commit.date);
        const dayKey = date.toISOString().split('T')[0];
        const hourKey = date.getHours().toString();
        
        dailyCommits[dayKey] = (dailyCommits[dayKey] || 0) + 1;
        hourlyCommits[hourKey] = (hourlyCommits[hourKey] || 0) + 1;
        
        // Track author statistics
        if (commit.author_name) {
          if (!authorStats[commit.author_name]) {
            authorStats[commit.author_name] = { commits: 0, messageLengths: [] };
          }
          authorStats[commit.author_name].commits += 1;
          authorStats[commit.author_name].messageLengths.push(message.length);
        }
      }
      
      // Calculate message length statistics
      const sortedLengths = [...messageLengths].sort((a, b) => a - b);
      const messageLengthStats = {
        min: sortedLengths[0] || 0,
        max: sortedLengths[sortedLengths.length - 1] || 0,
        average: messageLengths.length > 0 ? messageLengths.reduce((a, b) => a + b, 0) / messageLengths.length : 0,
        median: sortedLengths.length > 0 ? 
          sortedLengths.length % 2 === 0 ? 
            (sortedLengths[sortedLengths.length / 2 - 1] + sortedLengths[sortedLengths.length / 2]) / 2 : 
            sortedLengths[Math.floor(sortedLengths.length / 2)] : 
          0
      };
      
      // Calculate author average message lengths
      const finalAuthorStats: Record<string, { commits: number; avgMessageLength: number }> = {};
      for (const [author, stats] of Object.entries(authorStats)) {
        const avgLength = stats.messageLengths.reduce((a, b) => a + b, 0) / stats.messageLengths.length;
        finalAuthorStats[author] = {
          commits: stats.commits,
          avgMessageLength: Math.round(avgLength)
        };
      }
      
      // Generate suggestions based on analysis
      const suggestions: string[] = [];
      
      // Check for commit type consistency
      const totalConventionalCommits = Object.values(commitTypes).reduce((a, b) => a + b, 0);
      if (totalConventionalCommits / log.all.length < 0.5) {
        suggestions.push('Consider adopting conventional commit format for better consistency');
      }
      
      // Check message length
      if (messageLengthStats.average > 72) {
        suggestions.push(`Average commit message length (${Math.round(messageLengthStats.average)} chars) exceeds recommended 72 characters`);
      }
      
      // Check commit frequency
      const busiestDay = Object.entries(dailyCommits).sort((a, b) => b[1] - a[1])[0];
      if (busiestDay && busiestDay[1] > 10) {
        suggestions.push(`High commit frequency on ${busiestDay[0]} (${busiestDay[1]} commits) - consider batching related changes`);
      }
      
      return {
        totalCommits: log.all.length,
        commitTypes,
        commonScopes,
        messageLengths: messageLengthStats,
        commitFrequency: {
          daily: dailyCommits,
          hourly: hourlyCommits
        },
        authorStats: finalAuthorStats,
        suggestions
      };
    } catch (error) {
      throw new Error(`Git log analysis error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async commitWithMessage(message: string): Promise<string> {
    try {
      const escapedMessage = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const result = await this.execAsync(`git commit -m "${escapedMessage}"`);
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

      // If analyze mode is enabled, generate statistics and exit
      if (this.config.analyze) {
        console.log(chalk.blue('Generating commit statistics and insights...'));
        const stats = await this.gitUtils.generateCommitStatistics(100);
        
        console.log(chalk.green('\n=== Commit Statistics Report ==='));
        console.log(`Total commits analyzed: ${stats.totalCommits}`);
        
        console.log(chalk.green('\nCommit Types:'));
        const sortedTypes = Object.entries(stats.commitTypes)
          .sort((a, b) => b[1] - a[1]);
        sortedTypes.forEach(([type, count]) => {
          const percentage = ((count / stats.totalCommits) * 100).toFixed(1);
          console.log(`  ${type}: ${count} (${percentage}%)`);
        });
        
        console.log(chalk.green('\nCommon Scopes:'));
        const sortedScopes = Object.entries(stats.commonScopes)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10);
        sortedScopes.forEach(([scope, count]) => {
          console.log(`  ${scope}: ${count}`);
        });
        
        console.log(chalk.green('\nMessage Length Statistics:'));
        console.log(`  Min: ${stats.messageLengths.min} characters`);
        console.log(`  Max: ${stats.messageLengths.max} characters`);
        console.log(`  Average: ${Math.round(stats.messageLengths.average)} characters`);
        console.log(`  Median: ${Math.round(stats.messageLengths.median)} characters`);
        
        console.log(chalk.green('\nCommit Frequency (Busiest Hours):'));
        const sortedHours = Object.entries(stats.commitFrequency.hourly)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);
        sortedHours.forEach(([hour, count]) => {
          console.log(`  ${hour}:00: ${count} commits`);
        });
        
        console.log(chalk.green('\nAuthor Statistics:'));
        const sortedAuthors = Object.entries(stats.authorStats)
          .sort((a, b) => b[1].commits - a[1].commits);
        sortedAuthors.forEach(([author, stats]) => {
          console.log(`  ${author}: ${stats.commits} commits (avg ${stats.avgMessageLength} chars)`);
        });
        
        if (stats.suggestions.length > 0) {
          console.log(chalk.green('\nSuggestions for Improvement:'));
          stats.suggestions.forEach(suggestion => {
            console.log(`  • ${suggestion}`);
          });
        }
        
        return;
      }

      // Analyze commit history if requested
      if (this.config.learnHistory) {
        console.log(chalk.blue('Analyzing commit history...'));
        const historyAnalysis = await this.gitUtils.analyzeCommitHistory(50);
        
        console.log(chalk.green('Commit history analysis:'));
        console.log(`- Most common commit types: ${Object.entries(historyAnalysis.commitTypes)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([type, count]) => `${type} (${count})`)
          .join(', ')}`);
        
        console.log(`- Most common scopes: ${Object.entries(historyAnalysis.commonScopes)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([scope, count]) => `${scope} (${count})`)
          .join(', ')}`);
        
        console.log(`- Average message length: ${Math.round(historyAnalysis.averageMessageLength)} characters`);
        console.log(`- Most common prefix: "${historyAnalysis.mostCommonPrefix}"`);
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
    let finalMessage: string;
    
    // If ensemble mode is enabled, generate messages from multiple models
    if (this.config.ensemble) {
      console.log(chalk.blue('Generating commit messages using ensemble approach...'));
      
      // Create providers for different models
      const providers: AIProvider[] = [];
      
      try {
        // Add Claude provider if not already the main provider
        if (this.config.model !== 'claude') {
          const claudeApiKey = process.env.CLAUDE_API_KEY;
          if (claudeApiKey) {
            providers.push(new ClaudeProvider(claudeApiKey, this.config.modelVersion));
          }
        }
        
        // Add OpenAI provider if not already the main provider
        if (this.config.model !== 'openai') {
          const openaiApiKey = process.env.OPENAI_API_KEY;
          if (openaiApiKey) {
            providers.push(new OpenAIProvider(openaiApiKey, this.config.modelVersion));
          }
        }
        
        // Add the main provider
        providers.push(provider);
        
        // Generate messages from all providers in parallel
        const messagePromises = providers.map(p => 
          p.generateCommitMessage(diff, this.config).catch(err => {
            console.warn(chalk.yellow(`Warning: Failed to generate message with ${p.getModelName()}: ${err.message}`));
            return null;
          })
        );
        
        const messages = await Promise.all(messagePromises);
        const validMessages = messages.filter((msg): msg is string => msg !== null);
        
        if (validMessages.length === 0) {
          throw new Error('All ensemble models failed to generate commit messages');
        }
        
        if (validMessages.length === 1) {
          finalMessage = validMessages[0];
        } else {
          // In ensemble mode, we'll use the first valid message
          // In a more advanced implementation, we could implement voting or combination logic
          console.log(chalk.green('Generated commit messages from multiple models:'));
          validMessages.forEach((msg, index) => {
            console.log(`${index + 1}. ${chalk.bold(msg)}`);
          });
          
          // For now, use the first message
          finalMessage = validMessages[0];
        }
      } catch (error) {
        console.error(chalk.red(`Ensemble generation failed: ${error instanceof Error ? error.message : String(error)}`));
        // Fall back to single model generation
        finalMessage = await provider.generateCommitMessage(diff, this.config);
      }
    } else {
      // Standard single model generation
      finalMessage = await provider.generateCommitMessage(diff, this.config);
    }
    
    if (this.config.interactive) {
      const inquirer = await import('inquirer');
      const answers = await inquirer.default.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'How would you like to proceed with the commit message?',
          choices: [
            { name: 'Accept as is', value: 'accept' },
            { name: 'Edit manually', value: 'edit' },
            { name: 'Regenerate', value: 'regenerate' },
            { name: 'Cancel', value: 'cancel' }
          ]
        }
      ]);
      
      switch (answers.action) {
        case 'accept':
          // Keep the generated message as is
          break;
          
        case 'edit':
          // Allow manual editing
          const editAnswers = await inquirer.default.prompt([
            {
              type: 'editor',
              name: 'editedMessage',
              message: 'Edit the commit message:',
              default: finalMessage
            }
          ]);
          finalMessage = editAnswers.editedMessage.trim();
          break;
          
        case 'regenerate':
          // Generate a new message
          console.log(chalk.blue('Regenerating commit message...'));
          finalMessage = await provider.generateCommitMessage(diff, this.config);
          break;
          
        case 'cancel':
          console.log(chalk.yellow('Commit cancelled by user.'));
          return;
      }
    }
    
    console.log(chalk.green('Generated commit message:'));
    console.log(chalk.bold(finalMessage));
    
    if (this.config.apply) {
      if (this.config.dryRun) {
        console.log(chalk.yellow('Dry run mode: Would commit with the message above'));
      } else {
        try {
          const result = await this.gitUtils.commitWithMessage(finalMessage);
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

/**
 * Load and process a commit template
 * @param templateName Name of the template to load
 * @param templatesDir Directory where templates are stored
 * @param variables Variables to substitute in the template
 * @returns Processed template content or null if template not found
 */
function loadAndProcessTemplate(
  templateName: string, 
  templatesDir: string, 
  variables: Record<string, string | undefined>
): string | null {
  try {
    const templatePath = path.join(templatesDir, `${templateName}.txt`);
    
    if (!fs.existsSync(templatePath)) {
      console.warn(chalk.yellow(`Template "${templateName}" not found at ${templatePath}`));
      return null;
    }
    
    let templateContent = fs.readFileSync(templatePath, 'utf-8');
    
    // Substitute variables in the template
    for (const [key, value] of Object.entries(variables)) {
      if (value !== undefined) {
        templateContent = templateContent.replace(new RegExp(`{{${key}}}`, 'g'), value);
      }
    }
    
    return templateContent.trim();
  } catch (error) {
    console.error(chalk.red(`Error loading template "${templateName}": ${error instanceof Error ? error.message : String(error)}`));
    return null;
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
    .option('--detect-scope', 'Automatically detect scope from file paths')
    .option('--scope <scope>', 'Manually specify scope for conventional commits')
    .option('--interactive', 'Enable interactive mode to refine the commit message')
    .option('--learn-history', 'Analyze commit history to learn project conventions')
    .option('--ensemble', 'Use multiple AI models for generation')
    .option('--template <name>', 'Use a specific commit template')
    .option('--analyze', 'Generate commit statistics and insights')
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