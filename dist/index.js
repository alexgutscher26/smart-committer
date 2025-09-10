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
const path_1 = __importDefault(require("path"));
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
    dryRun: zod_1.z.boolean().default(false),
    detectScope: zod_1.z.boolean().default(false),
    scope: zod_1.z.string().optional(),
    interactive: zod_1.z.boolean().default(false),
    learnHistory: zod_1.z.boolean().default(false),
    ensemble: zod_1.z.boolean().default(false),
    template: zod_1.z.string().optional(),
    templatesDir: zod_1.z.string().default('./commit-templates'),
    analyze: zod_1.z.boolean().default(false), // New option for analysis mode
    hooks: zod_1.z.object({
        autoStage: zod_1.z.boolean().default(false),
        fallbackMessage: zod_1.z.string().default('chore: auto-commit')
    }).optional()
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
            }
            else {
                console.warn(chalk_1.default.yellow(`Failed to load template "${config.template}", using default prompt`));
            }
        }
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
    /**
     * Detect the scope of changes based on file paths in the diff
     * @param diff The git diff string
     * @returns The detected scope or null if no clear scope is found
     */
    detectScopeFromDiff(diff) {
        // Extract file paths from the diff
        const filePaths = [];
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
        const dirNames = [];
        for (const filePath of filePaths) {
            // Get the first directory component
            const parts = filePath.split('/');
            if (parts.length > 1) {
                dirNames.push(parts[0]);
            }
            else {
                // For files in root directory, use the filename without extension
                const fileName = filePath.split('.')[0];
                dirNames.push(fileName);
            }
        }
        // Count occurrences of each directory name
        const dirCount = {};
        for (const dir of dirNames) {
            dirCount[dir] = (dirCount[dir] || 0) + 1;
        }
        // Find the most common directory
        let maxCount = 0;
        let commonDir = null;
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
                    const nextLevelDirs = [];
                    for (const filePath of filePaths) {
                        const parts = filePath.split('/');
                        if (parts.length > 1 && parts[0] === dir && parts[1]) {
                            nextLevelDirs.push(parts[1]);
                        }
                    }
                    if (nextLevelDirs.length > 0) {
                        // Count occurrences of next level directories
                        const nextLevelCount = {};
                        for (const nextDir of nextLevelDirs) {
                            nextLevelCount[nextDir] = (nextLevelCount[nextDir] || 0) + 1;
                        }
                        // Find the most common next level directory
                        let maxNextCount = 0;
                        let commonNextDir = null;
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
    async analyzeCommitHistory(limit = 50) {
        try {
            // Get commit history
            const log = await this.git.log({
                maxCount: limit
            });
            // Initialize analysis results
            const commitTypes = {};
            const commonScopes = {};
            let totalMessageLength = 0;
            const prefixCount = {};
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
        }
        catch (error) {
            throw new Error(`Git log analysis error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Generate detailed commit statistics and insights
     * @param limit Number of commits to analyze (default: 100)
     * @returns Detailed analysis results
     */
    async generateCommitStatistics(limit = 100) {
        try {
            // Get commit history
            const log = await this.git.log({
                maxCount: limit
            });
            // Initialize analysis results
            const commitTypes = {};
            const commonScopes = {};
            const messageLengths = [];
            const dailyCommits = {};
            const hourlyCommits = {};
            const authorStats = {};
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
            const finalAuthorStats = {};
            for (const [author, stats] of Object.entries(authorStats)) {
                const avgLength = stats.messageLengths.reduce((a, b) => a + b, 0) / stats.messageLengths.length;
                finalAuthorStats[author] = {
                    commits: stats.commits,
                    avgMessageLength: Math.round(avgLength)
                };
            }
            // Generate suggestions based on analysis
            const suggestions = [];
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
        }
        catch (error) {
            throw new Error(`Git log analysis error: ${error instanceof Error ? error.message : String(error)}`);
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
            // If analyze mode is enabled, generate statistics and exit
            if (this.config.analyze) {
                console.log(chalk_1.default.blue('Generating commit statistics and insights...'));
                const stats = await this.gitUtils.generateCommitStatistics(100);
                console.log(chalk_1.default.green('\n=== Commit Statistics Report ==='));
                console.log(`Total commits analyzed: ${stats.totalCommits}`);
                console.log(chalk_1.default.green('\nCommit Types:'));
                const sortedTypes = Object.entries(stats.commitTypes)
                    .sort((a, b) => b[1] - a[1]);
                sortedTypes.forEach(([type, count]) => {
                    const percentage = ((count / stats.totalCommits) * 100).toFixed(1);
                    console.log(`  ${type}: ${count} (${percentage}%)`);
                });
                console.log(chalk_1.default.green('\nCommon Scopes:'));
                const sortedScopes = Object.entries(stats.commonScopes)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 10);
                sortedScopes.forEach(([scope, count]) => {
                    console.log(`  ${scope}: ${count}`);
                });
                console.log(chalk_1.default.green('\nMessage Length Statistics:'));
                console.log(`  Min: ${stats.messageLengths.min} characters`);
                console.log(`  Max: ${stats.messageLengths.max} characters`);
                console.log(`  Average: ${Math.round(stats.messageLengths.average)} characters`);
                console.log(`  Median: ${Math.round(stats.messageLengths.median)} characters`);
                console.log(chalk_1.default.green('\nCommit Frequency (Busiest Hours):'));
                const sortedHours = Object.entries(stats.commitFrequency.hourly)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5);
                sortedHours.forEach(([hour, count]) => {
                    console.log(`  ${hour}:00: ${count} commits`);
                });
                console.log(chalk_1.default.green('\nAuthor Statistics:'));
                const sortedAuthors = Object.entries(stats.authorStats)
                    .sort((a, b) => b[1].commits - a[1].commits);
                sortedAuthors.forEach(([author, stats]) => {
                    console.log(`  ${author}: ${stats.commits} commits (avg ${stats.avgMessageLength} chars)`);
                });
                if (stats.suggestions.length > 0) {
                    console.log(chalk_1.default.green('\nSuggestions for Improvement:'));
                    stats.suggestions.forEach(suggestion => {
                        console.log(`  • ${suggestion}`);
                    });
                }
                return;
            }
            // Analyze commit history if requested
            if (this.config.learnHistory) {
                console.log(chalk_1.default.blue('Analyzing commit history...'));
                const historyAnalysis = await this.gitUtils.analyzeCommitHistory(50);
                console.log(chalk_1.default.green('Commit history analysis:'));
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
        let finalMessage;
        // If ensemble mode is enabled, generate messages from multiple models
        if (this.config.ensemble) {
            console.log(chalk_1.default.blue('Generating commit messages using ensemble approach...'));
            // Create providers for different models
            const providers = [];
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
                const messagePromises = providers.map(p => p.generateCommitMessage(diff, this.config).catch(err => {
                    console.warn(chalk_1.default.yellow(`Warning: Failed to generate message with ${p.getModelName()}: ${err.message}`));
                    return null;
                }));
                const messages = await Promise.all(messagePromises);
                const validMessages = messages.filter((msg) => msg !== null);
                if (validMessages.length === 0) {
                    throw new Error('All ensemble models failed to generate commit messages');
                }
                if (validMessages.length === 1) {
                    finalMessage = validMessages[0];
                }
                else {
                    // In ensemble mode, we'll use the first valid message
                    // In a more advanced implementation, we could implement voting or combination logic
                    console.log(chalk_1.default.green('Generated commit messages from multiple models:'));
                    validMessages.forEach((msg, index) => {
                        console.log(`${index + 1}. ${chalk_1.default.bold(msg)}`);
                    });
                    // For now, use the first message
                    finalMessage = validMessages[0];
                }
            }
            catch (error) {
                console.error(chalk_1.default.red(`Ensemble generation failed: ${error instanceof Error ? error.message : String(error)}`));
                // Fall back to single model generation
                finalMessage = await provider.generateCommitMessage(diff, this.config);
            }
        }
        else {
            // Standard single model generation
            finalMessage = await provider.generateCommitMessage(diff, this.config);
        }
        if (this.config.interactive) {
            const inquirer = await Promise.resolve().then(() => __importStar(require('inquirer')));
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
                    console.log(chalk_1.default.blue('Regenerating commit message...'));
                    finalMessage = await provider.generateCommitMessage(diff, this.config);
                    break;
                case 'cancel':
                    console.log(chalk_1.default.yellow('Commit cancelled by user.'));
                    return;
            }
        }
        console.log(chalk_1.default.green('Generated commit message:'));
        console.log(chalk_1.default.bold(finalMessage));
        if (this.config.apply) {
            if (this.config.dryRun) {
                console.log(chalk_1.default.yellow('Dry run mode: Would commit with the message above'));
            }
            else {
                try {
                    const result = await this.gitUtils.commitWithMessage(finalMessage);
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
/**
 * Load and process a commit template
 * @param templateName Name of the template to load
 * @param templatesDir Directory where templates are stored
 * @param variables Variables to substitute in the template
 * @returns Processed template content or null if template not found
 */
function loadAndProcessTemplate(templateName, templatesDir, variables) {
    try {
        const templatePath = path_1.default.join(templatesDir, `${templateName}.txt`);
        if (!fs_1.default.existsSync(templatePath)) {
            console.warn(chalk_1.default.yellow(`Template "${templateName}" not found at ${templatePath}`));
            return null;
        }
        let templateContent = fs_1.default.readFileSync(templatePath, 'utf-8');
        // Substitute variables in the template
        for (const [key, value] of Object.entries(variables)) {
            if (value !== undefined) {
                templateContent = templateContent.replace(new RegExp(`{{${key}}}`, 'g'), value);
            }
        }
        return templateContent.trim();
    }
    catch (error) {
        console.error(chalk_1.default.red(`Error loading template "${templateName}": ${error instanceof Error ? error.message : String(error)}`));
        return null;
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
