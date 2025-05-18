#!/usr/bin/env node
const path = require('path');

// Change to the directory containing this file
process.chdir(path.dirname(__filename));

// Import and run the main program
require('./index.js');
