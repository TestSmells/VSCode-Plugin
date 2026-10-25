'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const corpusRoot = path.join(repositoryRoot, 'regression-corpus');
const manifestPath = path.join(corpusRoot, 'expected-results.json');
const adapterPath = path.join(repositoryRoot, 'out', 'testSmellDetector.js');
const jarPath = path.join(repositoryRoot, 'detector', 'tsdetect.jar');

if (!fs.existsSync(adapterPath)) {
  failSetup('The compiled detector adapter is missing. Run npm run compile first.');
}

if (!fs.existsSync(jarPath)) {
  failSetup(`The bundled detector is missing: ${jarPath}`);
}

const { runDetector } = require(adapterPath);
const manifest = readManifest();

runCorpus().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});

async function runCorpus() {
  validateManifest(manifest);

  let failures = 0;

  for (const fixture of manifest.cases) {
    const actual = await analyzeFixture(fixture);
    const differences = compareResult(fixture.expected, actual);

    if (differences.length === 0) {
      console.log(`PASS ${fixture.id}`);
      continue;
    }

    failures += 1;
    console.error(`FAIL ${fixture.id}`);
    for (const difference of differences) {
      console.error(`  - ${difference}`);
    }
  }

  if (failures > 0) {
    throw new Error(
      `${failures} of ${manifest.cases.length} regression fixtures did not match.`,
    );
  }

  console.log(
    `All ${manifest.cases.length} regression fixtures match the expected results.`,
  );
}

async function analyzeFixture(fixture) {
  const testFilePath = resolveCorpusFile(fixture.testFile);
  const productionFilePath = resolveCorpusFile(fixture.productionFile);

  try {
    const result = await runDetector({
      applicationName: fixture.id,
      jarPath,
      javaPath: process.env.JAVA_PATH || 'java',
      productionFilePath,
      testFilePath,
    });

    return {
      status: 'success',
      testMethods: result.numberOfTestMethods,
      smells: [...new Set(result.detectedSmells)].sort(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'error',
      category: categorizeError(message),
      message,
    };
  }
}

function compareResult(expected, actual) {
  const differences = [];

  if (expected.status !== actual.status) {
    return [`expected status ${expected.status}, received ${actual.status}`];
  }

  if (expected.status === 'success') {
    if (expected.testMethods !== actual.testMethods) {
      differences.push(
        `expected ${expected.testMethods} test methods, received ${actual.testMethods}`,
      );
    }

    if (JSON.stringify(expected.smells) !== JSON.stringify(actual.smells)) {
      differences.push(
        `expected smells ${JSON.stringify(expected.smells)}, received ${JSON.stringify(actual.smells)}`,
      );
    }
    return differences;
  }

  if (expected.category !== actual.category) {
    differences.push(
      `expected error category ${expected.category}, received ${actual.category}`,
    );
  }

  for (const text of expected.messageContains || []) {
    if (!actual.message.includes(text)) {
      differences.push(`expected the error message to contain ${JSON.stringify(text)}`);
    }
  }

  return differences;
}

function categorizeError(message) {
  if (message.includes('ParseProblemException')) {
    return 'malformed-input';
  }
  if (message.includes('did not return a result row')) {
    return 'missing-output';
  }
  if (
    message.includes('unexpected CSV result format') ||
    message.includes('malformed CSV')
  ) {
    return 'invalid-output';
  }
  return 'detector-failure';
}

function resolveCorpusFile(relativePath) {
  const resolvedPath = path.resolve(corpusRoot, relativePath);
  const relativeToCorpus = path.relative(corpusRoot, resolvedPath);

  if (
    relativeToCorpus.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToCorpus)
  ) {
    failSetup(`Corpus path leaves the corpus directory: ${relativePath}`);
  }

  if (!fs.existsSync(resolvedPath)) {
    failSetup(`Corpus source file does not exist: ${relativePath}`);
  }

  return resolvedPath;
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    failSetup(`Cannot read ${manifestPath}: ${reason}`);
  }
}

function validateManifest(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.cases)) {
    failSetup('The regression manifest does not use the supported schema version.');
  }

  if (value.cases.length < 10) {
    failSetup('The regression manifest must contain at least 10 fixtures.');
  }

  const identifiers = new Set();
  for (const fixture of value.cases) {
    if (!fixture.id || identifiers.has(fixture.id)) {
      failSetup(`A fixture has a missing or duplicate id: ${fixture.id}`);
    }
    identifiers.add(fixture.id);

    if (!fixture.testFile || !fixture.productionFile || !fixture.expected) {
      failSetup(`Fixture ${fixture.id} is missing required fields.`);
    }

    if (fixture.expected.status === 'success') {
      const smells = fixture.expected.smells;
      if (!Array.isArray(smells)) {
        failSetup(`Fixture ${fixture.id} does not contain a smell list.`);
      }
      const normalizedSmells = [...new Set(smells)].sort();
      if (JSON.stringify(smells) !== JSON.stringify(normalizedSmells)) {
        failSetup(`Fixture ${fixture.id} has a non-normalized smell list.`);
      }
    }
  }
}

function failSetup(message) {
  console.error(`Corpus setup error: ${message}`);
  process.exit(1);
}
