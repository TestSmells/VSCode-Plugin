import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

import { encodeCsvRow, parseCsv } from './csv';

const execFileAsync = promisify(execFile);

// Smell columns follow seven metadata columns: app, class, absolute paths,
// relative paths, and the number of test methods.
const RESULT_METADATA_COLUMNS = 7;

/** All filesystem and runtime inputs required for one detector invocation. */
export interface DetectorOptions {
  applicationName: string;
  jarPath: string;
  javaPath: string;
  productionFilePath: string;
  testFilePath: string;
}

/** The small, editor-facing subset of tsDetect's complete CSV result. */
export interface DetectorResult {
  detectedSmells: string[];
  numberOfTestMethods: number;
}

/**
 * Runs tsDetect for one test/production pair and converts its CSV output into
 * a result that the VS Code layer can display.
 */
export async function runDetector(options: DetectorOptions): Promise<DetectorResult> {
  // Fail before creating temporary files if the bundled detector is missing.
  await access(options.jarPath);

  // A unique directory prevents concurrent runs from sharing CSV files.
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), 'test-smell-detector-'),
  );
  const inputPath = path.join(temporaryDirectory, 'input.csv');
  const outputPath = path.join(temporaryDirectory, 'output.csv');

  try {
    // The existing CLI expects one headerless row containing the application,
    // test-file path, and production-file path.
    const inputRow = encodeCsvRow([
      options.applicationName,
      options.testFilePath,
      options.productionFilePath,
    ]);
    await writeFile(inputPath, `${inputRow}\n`, 'utf8');

    // execFile passes an argument array directly to Java and intentionally
    // avoids interpreting source paths through a command shell.
    await execFileAsync(
      options.javaPath,
      ['-jar', options.jarPath, '-f', inputPath, '-o', outputPath],
      {
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      },
    );

    // One invocation produces a header row followed by one result row.
    const rows = parseCsv(await readFile(outputPath, 'utf8'));
    if (rows.length < 2) {
      throw new Error('tsDetect did not return a result row.');
    }

    const headers = rows[0];
    const values = rows[1];
    if (
      headers.length !== values.length ||
      headers.length <= RESULT_METADATA_COLUMNS
    ) {
      throw new Error('tsDetect returned an unexpected CSV result format.');
    }

    // The CSV header supplies user-facing smell names. Keep only columns whose
    // corresponding result value indicates that a smell was detected.
    const detectedSmells = headers
      .slice(RESULT_METADATA_COLUMNS)
      .filter((_, index) => isDetected(values[index + RESULT_METADATA_COLUMNS]));
    const numberOfTestMethods = Number.parseInt(values[6], 10);

    return {
      detectedSmells,
      numberOfTestMethods: Number.isNaN(numberOfTestMethods)
        ? 0
        : numberOfTestMethods,
    };
  } finally {
    // Temporary inputs and outputs are removed after successful and failed runs.
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

function isDetected(value: string): boolean {
  const normalizedValue = value.trim().toLowerCase();

  // tsDetect supports boolean and numerical result granularities.
  return normalizedValue === 'true' || Number(normalizedValue) > 0;
}
