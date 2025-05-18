"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const dotenv_1 = __importDefault(require("dotenv"));
const simple_git_1 = require("simple-git");
const ora_1 = __importDefault(require("ora"));
const chalk_1 = __importDefault(require("chalk"));
const zod_1 = require("zod");
const openai_1 = __importDefault(require("openai"));
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const fs_1 = __importDefault(require("fs"));
const child_process_1 = require("child_process");
const util_1 = require("util");
// Load environment variables
dotenv_1.default.config();
// Configuration schema
const configSchema = zod_1.z.object({
    model: zod_1.z.enum(['claude', 'openai']).default('claude'),
    modelVersion: zod_1.z.string().optional(),
    style: zod_1.z.enum(['plain', 'conventional', 'emoji', 'gitmoji']).default('plain'),
    lang: zod_1.z.string().default('en'),
    diff: zod_1.z.enum(['staged', 'unstaged', 'all']).default('staged'),
    batch: zod_1.z.boolean().default(false),
    customPrompt: zod_1.z.string().optional(),
    maxDiffSize: zod_1.z.number().default(10000),
    apply: zod_1.z.boolean().default(false),
    dryRun: zod_1.z.boolean().default(false)
});
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
// Claude API provider
class ClaudeProvider {
    constructor(apiKey, modelVersion) {
        if (!apiKey) {
            throw new Error('Claude API key is required. Set CLAUDE_API_KEY in your environment.');
        }
        this.client = new sdk_1.default({ apiKey });
        // Set model based on version if provided
        if (modelVersion && modelVersion in AI_MODELS.claude.models) {
            this.model = AI_MODELS.claude.models[modelVersion];
        }
        else if (modelVersion) {
            // Use directly provided model string
            this.model = modelVersion;
        }
        else {
            this.model = AI_MODELS.claude.defaultModel;
        }
    }
    getModelName() {
        return this.model;
    }
    async generateCommitMessage(diff, config) {
        const spinner = (0, ora_1.default)(`Generating commit message with Claude (${this.model})...`).start();
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
        }
        catch (error) {
            spinner.fail('Failed to generate commit message');
            console.error(chalk_1.default.red(`Error details: ${error instanceof Error ? error.message : String(error)}`));
            throw error;
        }
    }
    buildPrompt(diff, config) {
        let prompt = 'You are a professional software developer. Generate a concise, clear commit message describing the code changes.';
        if (config.customPrompt) {
            prompt = config.customPrompt;
        }
        else {
            if (config.style === 'conventional') {
                prompt += ' Use conventional commit format with appropriate type (feat, fix, docs, style, refactor, perf, test, build, ci, chore).';
            }
            else if (config.style === 'emoji') {
                prompt += ' Include a relevant emoji at the start.';
            }
            else if (config.style === 'gitmoji') {
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
class OpenAIProvider {
    constructor(apiKey, modelVersion) {
        if (!apiKey) {
            throw new Error('OpenAI API key is required. Set OPENAI_API_KEY in your environment.');
        }
        this.client = new openai_1.default({ apiKey });
        // Set model based on version if provided
        if (modelVersion && modelVersion in AI_MODELS.openai.models) {
            this.model = AI_MODELS.openai.models[modelVersion];
        }
        else if (modelVersion) {
            // Use directly provided model string
            this.model = modelVersion;
        }
        else {
            this.model = AI_MODELS.openai.defaultModel;
        }
    }
    getModelName() {
        return this.model;
    }
    async generateCommitMessage(diff, config) {
        const spinner = (0, ora_1.default)(`Generating commit message with OpenAI (${this.model})...`).start();
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
        }
        catch (error) {
            spinner.fail('Failed to generate commit message');
            console.error(chalk_1.default.red(`Error details: ${error instanceof Error ? error.message : String(error)}`));
            throw error;
        }
    }
    buildPrompt(diff, config) {
        let prompt = 'You are a professional software developer. Generate a concise, clear commit message describing the code changes.';
        if (config.customPrompt) {
            prompt = config.customPrompt;
        }
        else {
            if (config.style === 'conventional') {
                prompt += ' Use conventional commit format with appropriate type (feat, fix, docs, style, refactor, perf, test, build, ci, chore).';
            }
            else if (config.style === 'emoji') {
                prompt += ' Include a relevant emoji at the start.';
            }
            else if (config.style === 'gitmoji') {
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
    constructor() {
        this.execAsync = (0, util_1.promisify)(child_process_1.exec);
        this.git = (0, simple_git_1.simpleGit)();
    }
    async isGitRepo() {
        try {
            await this.git.revparse(['--is-inside-work-tree']);
            return true;
        }
        catch (error) {
            return false;
        }
    }
    async getDiffSource(source) {
        try {
            let diff = '';
            if (source === 'staged') {
                diff = await this.git.diff(['--cached']);
            }
            else if (source === 'unstaged') {
                diff = await this.git.diff();
            }
            else if (source === 'all') {
                diff = await this.git.diff(['HEAD']);
            }
            else {
                throw new Error('Unknown diff source. Use staged, unstaged, or all.');
            }
            if (!diff.trim()) {
                throw new Error(`No ${source} changes found. Make sure you have staged or made changes.`);
            }
            return diff;
        }
        catch (error) {
            throw new Error(`Git diff error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async commitWithMessage(message) {
        try {
            const result = await this.execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`);
            return result.stdout;
        }
        catch (error) {
            throw new Error(`Commit error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async getLogForRange(range) {
        try {
            const log = await this.git.log({
                from: range.split('..')[0],
                to: range.split('..')[1] || 'HEAD'
            });
            return [...log.all];
        }
        catch (error) {
            throw new Error(`Git log error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async getDiffForCommit(commitHash) {
        try {
            return await this.git.diff([`${commitHash}^..${commitHash}`]);
        }
        catch (error) {
            throw new Error(`Git diff error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
// Main application
class SmartCommitter {
    constructor(config) {
        this.config = config;
        this.gitUtils = new GitUtils();
    }
    async run() {
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
                console.warn(chalk_1.default.yellow(`⚠️ Warning: Diff is large (${diff.length} chars). This may affect API response time and quality.`));
                console.warn(chalk_1.default.yellow(`   Consider committing smaller changes or increasing the maxDiffSize option if needed.`));
            }
            // Initialize AI provider
            const provider = this.createProvider();
            console.log(chalk_1.default.blue(`Using ${this.config.model} model: ${provider.getModelName()}`));
            if (this.config.batch) {
                await this.processBatchMode(provider);
            }
            else {
                await this.processSingleCommit(provider, diff);
            }
        }
        catch (error) {
            console.error(chalk_1.default.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
            process.exit(1);
        }
    }
    createProvider() {
        if (this.config.model === 'openai') {
            const apiKey = process.env.OPENAI_API_KEY;
            return new OpenAIProvider(apiKey, this.config.modelVersion);
        }
        else {
            const apiKey = process.env.CLAUDE_API_KEY;
            return new ClaudeProvider(apiKey, this.config.modelVersion);
        }
    }
    async processSingleCommit(provider, diff) {
        // Generate commit message
        const message = await provider.generateCommitMessage(diff, this.config);
        console.log(chalk_1.default.green('Generated commit message:'));
        console.log(chalk_1.default.bold(message));
        if (this.config.apply) {
            if (this.config.dryRun) {
                console.log(chalk_1.default.yellow('Dry run mode: Would commit with the message above'));
            }
            else {
                try {
                    const result = await this.gitUtils.commitWithMessage(message);
                    console.log(chalk_1.default.green('Committed successfully!'));
                    console.log(result);
                }
                catch (error) {
                    console.error(chalk_1.default.red(`Failed to commit: ${error instanceof Error ? error.message : String(error)}`));
                }
            }
        }
        else {
            console.log(chalk_1.default.blue('Tip: Use --apply to automatically commit with this message'));
        }
    }
    async processBatchMode(provider) {
        // For batch mode, we need to prompt for commit range
        const { default: inquirer } = await Promise.resolve().then(() => __importStar(require('inquirer')));
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
            console.log(chalk_1.default.yellow('No commits found in the specified range.'));
            return;
        }
        console.log(chalk_1.default.blue(`Found ${commits.length} commits in range`));
        // Process each commit
        for (const commit of commits) {
            console.log(`\n${chalk_1.default.cyan('Processing commit:')} ${commit.hash} - ${commit.message}`);
            try {
                const commitDiff = await this.gitUtils.getDiffForCommit(commit.hash);
                const generatedMessage = await provider.generateCommitMessage(commitDiff, this.config);
                console.log(chalk_1.default.green('Original message:'), chalk_1.default.dim(commit.message));
                console.log(chalk_1.default.green('Generated message:'), chalk_1.default.bold(generatedMessage));
                // If we're in batch mode, we can't apply the messages directly
                // but we can show the user the comparisons
            }
            catch (error) {
                console.error(chalk_1.default.red(`Error processing commit ${commit.hash}: ${error instanceof Error ? error.message : String(error)}`));
            }
        }
    }
}
// Load configuration from file
function loadConfig(configPath) {
    try {
        if (!fs_1.default.existsSync(configPath)) {
            return {};
        }
        const configFile = fs_1.default.readFileSync(configPath, 'utf-8');
        return JSON.parse(configFile);
    }
    catch (error) {
        console.error(chalk_1.default.red(`Error loading config file: ${error instanceof Error ? error.message : String(error)}`));
        return {};
    }
}
// Main function
async function main() {
    const program = new commander_1.Command();
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
                ...Object.fromEntries(Object.entries(cliOpts)
                    .filter(([_, value]) => value !== undefined)
                    .map(([key, value]) => [
                    // Convert kebab-case to camelCase for config keys
                    key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()),
                    value
                ]))
            };
            // Parse and validate config
            const config = configSchema.parse(mergedConfig);
            // Initialize and run the application
            const app = new SmartCommitter(config);
            await app.run();
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                console.error(chalk_1.default.red('Invalid configuration:'));
                console.error(error.errors.map(e => `- ${e.path.join('.')}: ${e.message}`).join('\n'));
            }
            else {
                console.error(chalk_1.default.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
            }
            process.exit(1);
        }
    });
    program.parse(process.argv);
}
// Run the application
main();
