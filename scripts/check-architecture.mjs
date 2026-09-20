#!/usr/bin/env node

/**
 * Architecture Contract Validator
 *
 * Validates generated WebView services against Architecture Contract specifications.
 * Checks: JSON schema, file structure, dependencies, Bridge API, forbidden patterns, design tokens.
 *
 * Usage: node scripts/check-architecture.mjs <contract-file>
 * Example: node scripts/check-architecture.mjs contracts/examples/valid-minigame-contract.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { minimatch } from 'minimatch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

class ValidationResult {
  constructor() {
    this.passed = true;
    this.errors = [];
    this.warnings = [];
    this.details = {};
  }

  addError(message) {
    this.errors.push(message);
    this.passed = false;
  }

  addWarning(message) {
    this.warnings.push(message);
  }
}

class ArchitectureValidator {
  constructor(contractPath) {
    this.contractPath = contractPath;
    this.contract = null;
    this.result = new ValidationResult();
  }

  async validate() {
    try {
      // Phase 1: JSON Schema validation
      this.validateJsonSchema();

      // Phase 2: Path structure
      this.validatePathStructure();

      // Phase 3: Dependencies
      this.validateDependencies();

      // Phase 4: Bridge policy
      this.validateBridgePolicy();

      // Phase 5: Forbidden patterns
      this.validateForbiddenPatterns();

      // Phase 6: Design tokens
      this.validateDesignTokens();

      return this.result;
    } catch (error) {
      this.result.addError(`Validation error: ${error.message}`);
      return this.result;
    }
  }

  validateJsonSchema() {
    // Check file exists
    if (!fs.existsSync(this.contractPath)) {
      this.result.addError(`Contract file not found: ${this.contractPath}`);
      return;
    }

    // Parse JSON
    try {
      const content = fs.readFileSync(this.contractPath, 'utf-8');
      this.contract = JSON.parse(content);
    } catch (error) {
      this.result.addError(`Invalid JSON: ${error.message}`);
      return;
    }

    // Check required fields
    const requiredFields = [
      'contract_id',
      'version',
      'pattern_type',
      'issued_by',
      'folder_structure',
      'allowed_dependencies',
      'bridge_contract_ref',
      'bridge_policy',
      'forbidden_patterns',
      'design_tokens_ref'
    ];

    for (const field of requiredFields) {
      if (!(field in this.contract)) {
        this.result.addError(`Missing required field: ${field}`);
      }
    }

    // Validate issued_by
    if (this.contract.issued_by !== 'architect_agent') {
      this.result.addError(`issued_by must be "architect_agent", got "${this.contract.issued_by}"`);
    }

    // Validate additionalProperties at top level
    const allowedProperties = new Set(requiredFields);
    for (const key in this.contract) {
      if (!allowedProperties.has(key)) {
        this.result.addError(`Unexpected property: ${key}`);
      }
    }

    this.result.details.schemaValidation = 'PASSED';
  }

  validatePathStructure() {
    if (!this.contract?.folder_structure) {
      this.result.addWarning('folder_structure not defined');
      return;
    }

    const { required_files, allowed_globs } = this.contract.folder_structure;

    if (!Array.isArray(required_files)) {
      this.result.addError('required_files must be an array');
      return;
    }

    if (!Array.isArray(allowed_globs)) {
      this.result.addError('allowed_globs must be an array');
      return;
    }

    // Phase 2A: Glob pattern security checks
    for (const glob of allowed_globs) {
      // Absolute path detection
      if (path.isAbsolute(glob)) {
        this.result.addError(`Glob pattern is absolute path: ${glob}`);
        continue;
      }

      // Parent directory escape attempt detection
      if (glob.includes('../')) {
        this.result.addError(`Glob pattern contains parent directory reference: ${glob}`);
        continue;
      }

      // Validate glob syntax with minimatch (will throw on invalid patterns)
      try {
        new minimatch.Minimatch(glob, { noglobstar: false });
      } catch (err) {
        this.result.addError(`Invalid glob pattern "${glob}": ${err.message}`);
      }
    }

    // Phase 2B: Warn about common build output directories
    if (allowed_globs.some(g => g.includes('dist') || g.includes('build') || g.includes('out'))) {
      this.result.addWarning('allowed_globs includes build output directory - ensure this is intentional');
    }

    // Phase 2C: Warn about dotfiles if not explicitly included
    const hasDotfilePattern = allowed_globs.some(g => g.includes('.*') || g.includes('/.'));
    if (!hasDotfilePattern) {
      this.result.addWarning('allowed_globs does not explicitly include dotfiles (e.g., .env, .gitignore)');
    }

    this.result.details.pathValidation = {
      required_files: required_files.length,
      allowed_globs: allowed_globs.length,
      security_checks: 'passed'
    };
  }

  validateDependencies() {
    if (!this.contract?.allowed_dependencies) {
      this.result.addWarning('allowed_dependencies not defined');
      return;
    }

    const { script_hosts, npm_packages } = this.contract.allowed_dependencies;

    if (!Array.isArray(script_hosts)) {
      this.result.addError('script_hosts must be an array');
      return;
    }

    if (!Array.isArray(npm_packages)) {
      this.result.addError('npm_packages must be an array');
      return;
    }

    // Validate URIs
    const uriRegex = /^https?:\/\//;
    for (const host of script_hosts) {
      if (!uriRegex.test(host)) {
        this.result.addError(`Invalid URI: ${host}`);
      }
    }

    this.result.details.dependenciesValidation = {
      script_hosts: script_hosts.length,
      npm_packages: npm_packages.length
    };
  }

  validateBridgePolicy() {
    if (!this.contract?.bridge_contract_ref) {
      this.result.addWarning('bridge_contract_ref not defined');
      return;
    }

    const { contract_id, path: refPath } = this.contract.bridge_contract_ref;

    if (!contract_id) {
      this.result.addError('bridge_contract_ref.contract_id is required');
      return;
    }

    if (!refPath) {
      this.result.addError('bridge_contract_ref.path is required');
      return;
    }

    // Check if file exists (relative to project root)
    const fullPath = path.join(projectRoot, refPath);
    if (!fs.existsSync(fullPath)) {
      this.result.addWarning(`Bridge contract reference file not found: ${refPath}`);
    }

    // Validate bridge_policy
    if (!this.contract?.bridge_policy || typeof this.contract.bridge_policy !== 'object') {
      this.result.addError('bridge_policy must be an object');
      return;
    }

    for (const methodName in this.contract.bridge_policy) {
      const policy = this.contract.bridge_policy[methodName];

      if (!('max_calls_per_session' in policy)) {
        this.result.addError(`${methodName}: missing max_calls_per_session`);
      } else if (typeof policy.max_calls_per_session !== 'number' || policy.max_calls_per_session < 1) {
        this.result.addError(`${methodName}: max_calls_per_session must be ≥ 1`);
      }
    }

    this.result.details.bridgePolicyValidation = {
      contract_id,
      methods: Object.keys(this.contract.bridge_policy).length
    };
  }

  validateForbiddenPatterns() {
    if (!Array.isArray(this.contract?.forbidden_patterns)) {
      this.result.addError('forbidden_patterns must be an array');
      return;
    }

    const patterns = [];
    for (const pattern of this.contract.forbidden_patterns) {
      // Validate fields
      if (!pattern.id) {
        this.result.addError('Pattern missing id field');
        continue;
      }
      if (!pattern.regex) {
        this.result.addError(`Pattern ${pattern.id}: missing regex`);
        continue;
      }
      if (!pattern.reason) {
        this.result.addError(`Pattern ${pattern.id}: missing reason`);
        continue;
      }
      if (!['block', 'warn'].includes(pattern.severity)) {
        this.result.addError(`Pattern ${pattern.id}: invalid severity "${pattern.severity}"`);
        continue;
      }

      // Try to compile regex
      try {
        const compiled = new RegExp(pattern.regex);
        patterns.push({
          id: pattern.id,
          regex: compiled,
          reason: pattern.reason,
          severity: pattern.severity
        });
      } catch (error) {
        this.result.addError(`Pattern ${pattern.id}: invalid regex - ${error.message}`);
      }
    }

    this.result.details.forbiddenPatternsValidation = {
      total: this.contract.forbidden_patterns.length,
      valid: patterns.length,
      invalid: this.contract.forbidden_patterns.length - patterns.length
    };
  }

  validateDesignTokens() {
    if (!this.contract?.design_tokens_ref) {
      this.result.addWarning('design_tokens_ref not defined');
      return;
    }

    const tokenPath = path.join(projectRoot, this.contract.design_tokens_ref);
    if (!fs.existsSync(tokenPath)) {
      this.result.addWarning(`Design tokens file not found: ${this.contract.design_tokens_ref}`);
    } else {
      this.result.details.designTokensPath = this.contract.design_tokens_ref;
    }
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node scripts/check-architecture.mjs <contract-file>');
    console.log('Example: node scripts/check-architecture.mjs contracts/examples/valid-minigame-contract.json');
    process.exit(1);
  }

  const contractFile = args[0];

  console.log('🏗️  Architecture Contract Validation');
  console.log(`Contract: ${contractFile}`);
  console.log('');

  const validator = new ArchitectureValidator(contractFile);
  const result = await validator.validate();

  // Output results
  if (result.errors.length > 0) {
    console.error('❌ ERRORS:');
    result.errors.forEach(err => console.error(`  - ${err}`));
    console.log('');
  }

  if (result.warnings.length > 0) {
    console.warn('⚠️  WARNINGS:');
    result.warnings.forEach(warn => console.warn(`  - ${warn}`));
    console.log('');
  }

  if (result.passed) {
    console.log('✅ Architecture contract validation PASSED');
    console.log('');
    console.log('Details:');
    for (const [key, value] of Object.entries(result.details)) {
      if (typeof value === 'object') {
        console.log(`  ${key}:`);
        for (const [k, v] of Object.entries(value)) {
          console.log(`    - ${k}: ${v}`);
        }
      } else {
        console.log(`  - ${key}: ${value}`);
      }
    }
    process.exit(0);
  } else {
    console.log('❌ Architecture contract validation FAILED');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
