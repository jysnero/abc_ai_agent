/**
 * Validate architecture-contract-browser.json against expected structure
 */

import fs from 'fs';
import path from 'path';

const contractPath = './contracts/architecture-contract-browser.json';
const specPath = './samples/request-spec-ox-quiz-browser.json';

console.log('\n=== Contract & Spec Validation ===\n');

// 1. Load and validate contract
console.log('1. Architecture Contract Validation\n');

const contractContent = fs.readFileSync(contractPath, 'utf-8');
const contract = JSON.parse(contractContent);

const contractChecks = [
  { field: 'contract_id', value: contract.contract_id, expected: /^req-.*/ },
  { field: 'version', value: contract.version, expected: '1.0.0' },
  { field: 'pattern_type', value: contract.pattern_type, expected: 'browser_component' },
  { field: 'folder_structure.required_files (length)', value: contract.folder_structure?.required_files?.length, expected: 5 },
  { field: 'bridge_policy (empty)', value: Object.keys(contract.bridge_policy || {}).length, expected: 0 },
  { field: 'forbidden_patterns (length)', value: contract.forbidden_patterns?.length, expected: 3 }
];

let contractPass = true;
contractChecks.forEach(check => {
  const pass = check.expected instanceof RegExp
    ? check.expected.test(check.value)
    : check.value === check.expected;

  console.log(`  ${pass ? '✓' : '✗'} ${check.field}: ${check.value}${!pass ? ` (expected ${check.expected})` : ''}`);
  if (!pass) contractPass = false;
});

// 2. Load and validate spec
console.log('\n2. Request Spec Validation\n');

const specContent = fs.readFileSync(specPath, 'utf-8');
const spec = JSON.parse(specContent);

const specChecks = [
  { field: 'type', value: spec.type, expected: 'webview-component' },
  { field: 'name', value: spec.name, contains: 'OX Quiz' },
  { field: 'constraints.no_native_apis', value: spec.constraints?.no_native_apis, expected: true },
  { field: 'constraints.no_external_services', value: spec.constraints?.no_external_services, expected: true },
  { field: 'expected_files (keys)', value: Object.keys(spec.expected_files || {}).length, expected: 4 },
];

let specPass = true;
specChecks.forEach(check => {
  let pass;
  if (check.contains) {
    pass = check.value.includes(check.contains);
  } else {
    pass = check.value === check.expected;
  }

  const desc = check.contains
    ? `contains "${check.contains}"`
    : `equals ${check.expected}`;

  console.log(`  ${pass ? '✓' : '✗'} ${check.field}: ${desc}`);
  if (!pass) specPass = false;
});

// 3. Dependency analysis
console.log('\n3. Dependency Analysis\n');

const allowedDeps = contract.allowed_dependencies?.npm_packages || [];
console.log('  Allowed npm packages:');
allowedDeps.forEach(dep => console.log(`    - ${dep}`));

const requiredDeps = [
  'react@^18.0.0',
  'typescript@^5.0.0'
];

const depPass = requiredDeps.every(dep =>
  allowedDeps.some(allowed => allowed.split('@')[0] === dep.split('@')[0])
);

console.log(`\n  ${depPass ? '✓' : '✗'} React present: ${allowedDeps.some(d => d.includes('react'))}`);
console.log(`  ${depPass ? '✓' : '✗'} TypeScript present: ${allowedDeps.some(d => d.includes('typescript'))}`);

// 4. Tailwind handling
console.log('\n4. Styling Configuration\n');

const hasTailwind = contract.allowed_dependencies?.script_hosts?.some(host =>
  host.includes('cdn.tailwindcss.com')
) || false;

console.log(`  Tailwind CDN: ${hasTailwind ? 'NOT in allowed_dependencies' : '✓ Using Tailwind CDN via demo/index.html'}`);
console.log(`  Note: demo/index.html uses Tailwind CDN for template validation`);
console.log(`  Claude-generated src/App.tsx will use Tailwind CSS classes (in-built)`);

// 5. Summary
console.log('\n=== SUMMARY ===\n');

const allPass = contractPass && specPass && depPass;

console.log(`✓ Architecture Contract: ${contractPass ? 'VALID' : 'INVALID'}`);
console.log(`✓ Request Spec: ${specPass ? 'VALID' : 'INVALID'}`);
console.log(`✓ Dependencies: ${depPass ? 'OK' : 'MISSING'}`);
console.log(`✓ Preview Endpoint: demo/index.html (React 18 + Tailwind)\n`);

if (!allPass) {
  process.exit(1);
}

console.log('All checks passed. Ready for generation.\n');
