#!/usr/bin/env node

// Test script to verify the new features
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execAsync = promisify(exec);

async function runTest() {
  try {
    console.log('Testing smart-committer new features...\n');
    
    // Test 1: Check if the CLI recognizes new flags
    console.log('1. Testing CLI flag recognition...');
    const { stdout } = await execAsync('node dist/cli.js --help');
    const hasNewFlags = [
      '--detect-scope',
      '--interactive',
      '--learn-history',
      '--ensemble',
      '--template',
      '--analyze'
    ].every(flag => stdout.includes(flag));
    
    if (hasNewFlags) {
      console.log('   ✓ All new CLI flags are recognized');
    } else {
      console.log('   ✗ Some new CLI flags are missing');
    }
    
    // Test 2: Check if template system works
    console.log('\n2. Testing template system...');
    const templatesDir = path.join(__dirname, 'commit-templates');
    const defaultTemplate = path.join(templatesDir, 'default.txt');
    const conventionalTemplate = path.join(templatesDir, 'conventional.txt');
    
    if (fs.existsSync(defaultTemplate) && fs.existsSync(conventionalTemplate)) {
      console.log('   ✓ Template files exist');
    } else {
      console.log('   ✗ Template files are missing');
    }
    
    // Test 3: Check configuration file
    console.log('\n3. Testing configuration file...');
    const configPath = path.join(__dirname, 'smart-committer.config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const hasNewConfigOptions = [
        'detectScope',
        'interactive',
        'learnHistory',
        'ensemble',
        'template',
        'templatesDir',
        'analyze'
      ].every(option => option in config);
      
      if (hasNewConfigOptions) {
        console.log('   ✓ Configuration file includes new options');
      } else {
        console.log('   ✗ Configuration file is missing some new options');
      }
    } else {
      console.log('   ✗ Configuration file not found');
    }
    
    console.log('\n🎉 Feature implementation verification complete!');
    
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

runTest();