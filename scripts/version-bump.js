#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Get version type from command line argument
const versionType = process.argv[2] || 'patch';

// Read current package.json
const packagePath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

// Store the old version before updating
const oldVersion = packageJson.version;

// Parse current version
const [major, minor, patch] = packageJson.version.split('.').map(Number);

// Calculate new version based on type
let newVersion;
switch (versionType) {
  case 'major':
    newVersion = `${major + 1}.0.0`;
    break;
  case 'minor':
    newVersion = `${major}.${minor + 1}.0`;
    break;
  case 'patch':
  default:
    newVersion = `${major}.${minor}.${patch + 1}`;
    break;
}

// Update package.json
packageJson.version = newVersion;
fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));

console.log(`✅ Version bumped from ${oldVersion} to ${newVersion}`);
console.log(`📦 Ready to publish ${newVersion}`);

// Also update package-lock.json if it exists
const lockPath = path.join(__dirname, '..', 'package-lock.json');
if (fs.existsSync(lockPath)) {
  const lockJson = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  lockJson.version = newVersion;
  lockJson.packages[''].version = newVersion;
  fs.writeFileSync(lockPath, JSON.stringify(lockJson, null, 2));
  console.log(`🔒 Updated package-lock.json`);
} 