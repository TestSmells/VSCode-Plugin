import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { parseCsv } from './csv';
import { DetectorExecutionError } from './detectorError';
import { executeProcess } from './processRunner';

const LOCATION_FORMAT_VERSION = 'TSDETECT_LOCATIONS_V1';
export const DEFAULT_DETECTOR_TIMEOUT_MILLISECONDS = 60_000;

/** All filesystem and runtime inputs required for one detector invocation. */
export interface DetectorOptions {
  applicationName: string;
  jarPath: string;
  javaPath: string;
  productionFilePath: string;
  signal?: AbortSignal;
  testFilePath: string;
  timeoutMilliseconds?: number;
}

/** One-based Java source positions; the ending column is exclusive. */
export interface DetectorLocation {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

/** One engine-confirmed smell mapped to a method, class, or file. */
export interface DetectorFinding {
  name: string;
  scope: 'method' | 'class' | 'file';
  elementName: string;
  location?: DetectorLocation;
}

/** The editor-facing subset of tsDetect's results. */
export interface DetectorResult {
  detectedSmells: string[];
  findings: DetectorFinding[];
  numberOfTestMethods: number;
}

/**
 * Runs tsDetect through the location bridge and converts its normalized CSV
 * output into findings that VS Code can place on source declarations.
 */
export async function runDetector(options: DetectorOptions): Promise<DetectorResult> {
  const bridgePath = path.join(
    path.dirname(options.jarPath),
    'tsdetect-locations.jar',
  );

  // Fail before creating temporary files if either bundled JAR is missing.
  await assertReadableJar(options.jarPath, 'tsDetect engine');
  await assertReadableJar(bridgePath, 'source-location bridge');

  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), 'test-smell-detector-'),
  );
  const outputPath = path.join(temporaryDirectory, 'locations.csv');

  try {
    await executeProcess({
      executable: options.javaPath,
      args: [
        '-cp',
        [bridgePath, options.jarPath].join(path.delimiter),
        'LocationBridge',
        options.applicationName,
        options.testFilePath,
        options.productionFilePath,
        outputPath,
      ],
      signal: options.signal,
      timeoutMilliseconds:
        options.timeoutMilliseconds ?? DEFAULT_DETECTOR_TIMEOUT_MILLISECONDS,
    });

    let rows: string[][];
    try {
      rows = parseCsv(await readFile(outputPath, 'utf8'));
    } catch (cause: unknown) {
      throw invalidOutputError(
        'The detector did not produce a readable result file. Reinstall the extension if this continues.',
        outputPath,
        cause,
      );
    }
    if (
      rows.length === 0 ||
      rows[0].length !== 2 ||
      rows[0][0] !== LOCATION_FORMAT_VERSION
    ) {
      throw invalidOutputError(
        'The detector returned an unsupported result format. Reinstall or update the extension.',
        outputPath,
      );
    }

    const numberOfTestMethods = Number(rows[0][1]);
    if (
      !Number.isSafeInteger(numberOfTestMethods) ||
      numberOfTestMethods < 0
    ) {
      throw invalidOutputError(
        'The detector returned an invalid test method count.',
        outputPath,
      );
    }

    let parsedFindings: DetectorFinding[];
    try {
      parsedFindings = rows.slice(1).map(parseFinding);
    } catch (cause: unknown) {
      throw invalidOutputError(
        'The detector returned malformed finding details. Reinstall or update the extension if this continues.',
        outputPath,
        cause,
      );
    }
    const findings = [
      ...new Map(
        parsedFindings.map((finding) => [findingKey(finding), finding]),
      ).values(),
    ];
    const detectedSmells = [...new Set(findings.map((finding) => finding.name))];

    return {
      detectedSmells,
      findings,
      numberOfTestMethods,
    };
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

async function assertReadableJar(
  jarPath: string,
  description: string,
): Promise<void> {
  try {
    await access(jarPath);
  } catch (cause: unknown) {
    const causeMessage =
      cause instanceof Error ? cause.message : String(cause);
    throw new DetectorExecutionError(
      'missing-jar',
      `The bundled ${description} JAR is missing or unreadable. Reinstall the extension from a complete VSIX package.`,
      `Required JAR: ${jarPath}\nFilesystem error: ${causeMessage}`,
      { cause },
    );
  }
}

function invalidOutputError(
  message: string,
  outputPath: string,
  cause?: unknown,
): DetectorExecutionError {
  const causeMessage =
    cause === undefined
      ? '(none)'
      : cause instanceof Error
        ? cause.message
        : String(cause);
  return new DetectorExecutionError(
    'invalid-output',
    message,
    `Expected result file: ${outputPath}\nRead/parse error: ${causeMessage}`,
    cause === undefined ? undefined : { cause },
  );
}

function findingKey(finding: DetectorFinding): string {
  const location = finding.location;
  return [
    finding.name,
    finding.scope,
    finding.elementName,
    location?.startLine ?? '',
    location?.startColumn ?? '',
    location?.endLine ?? '',
    location?.endColumn ?? '',
  ].join('\u0000');
}

function parseFinding(row: string[]): DetectorFinding {
  if (
    row.length !== 7 ||
    !row[0] ||
    !['method', 'class', 'file'].includes(row[1])
  ) {
    throw new Error('tsDetect returned an invalid source finding.');
  }

  const scope = row[1] as DetectorFinding['scope'];
  const finding: DetectorFinding = {
    name: row[0],
    scope,
    elementName: row[2],
  };

  if (scope === 'file') {
    return finding;
  }

  const [startLine, startColumn, endLine, endColumn] = row
    .slice(3)
    .map(Number);
  if (
    ![startLine, startColumn, endLine, endColumn].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    ) ||
    endLine < startLine ||
    (endLine === startLine && endColumn <= startColumn)
  ) {
    throw new Error('tsDetect returned an invalid source location.');
  }

  finding.location = { startLine, startColumn, endLine, endColumn };
  return finding;
}
