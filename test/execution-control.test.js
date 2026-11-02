const assert = require('node:assert/strict');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
  DetectorExecutionError,
} = require('../out/detectorError.js');
const { executeProcess } = require('../out/processRunner.js');
const { runDetector } = require('../out/testSmellDetector.js');

function expectDetectorFailure(kind, messagePattern) {
  return (error) => {
    assert.ok(error instanceof DetectorExecutionError);
    assert.equal(error.kind, kind);
    assert.match(error.message, messagePattern);
    assert.ok(error.technicalDetails.length > 0);
    return true;
  };
}

test('stops a detector process after the configured timeout', async () => {
  await assert.rejects(
    executeProcess({
      executable: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 10_000)'],
      timeoutMilliseconds: 100,
    }),
    expectDetectorFailure('timeout', /exceeded its .* timeout/i),
  );
});

test('stops a detector process when analysis is cancelled', async () => {
  const controller = new AbortController();
  const execution = executeProcess({
    executable: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 10_000)'],
    signal: controller.signal,
    timeoutMilliseconds: 5_000,
  });

  setTimeout(() => controller.abort(), 50);

  await assert.rejects(
    execution,
    expectDetectorFailure('cancelled', /cancelled/i),
  );
});

test('provides Java guidance when the configured executable is missing', async () => {
  const missingExecutable = path.join(
    tmpdir(),
    `missing-java-${process.pid}-${Date.now()}`,
  );

  await assert.rejects(
    executeProcess({
      executable: missingExecutable,
      args: [],
      timeoutMilliseconds: 1_000,
    }),
    expectDetectorFailure('missing-executable', /install Java 11 or newer/i),
  );
});

test('provides reinstall guidance when a bundled JAR is missing', async () => {
  const missingJar = path.join(
    tmpdir(),
    `missing-tsdetect-${process.pid}-${Date.now()}.jar`,
  );

  await assert.rejects(
    runDetector({
      applicationName: 'execution-control-test',
      jarPath: missingJar,
      javaPath: process.execPath,
      productionFilePath: 'Production.java',
      testFilePath: 'ProductionTest.java',
      timeoutMilliseconds: 1_000,
    }),
    expectDetectorFailure('missing-jar', /reinstall the extension/i),
  );
});
