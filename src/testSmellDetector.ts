import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

import { parseCsv } from './csv';

const execFileAsync = promisify(execFile);
const LOCATION_FORMAT_VERSION = 'TSDETECT_LOCATIONS_V1';

/** All filesystem and runtime inputs required for one detector invocation. */
export interface DetectorOptions {
  applicationName: string;
  jarPath: string;
  javaPath: string;
  productionFilePath: string;
  testFilePath: string;
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
  await access(options.jarPath);
  await access(bridgePath);

  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), 'test-smell-detector-'),
  );
  const outputPath = path.join(temporaryDirectory, 'locations.csv');

  try {
    await execFileAsync(
      options.javaPath,
      [
        '-cp',
        [bridgePath, options.jarPath].join(path.delimiter),
        'LocationBridge',
        options.applicationName,
        options.testFilePath,
        options.productionFilePath,
        outputPath,
      ],
      {
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      },
    );

    const rows = parseCsv(await readFile(outputPath, 'utf8'));
    if (
      rows.length === 0 ||
      rows[0].length !== 2 ||
      rows[0][0] !== LOCATION_FORMAT_VERSION
    ) {
      throw new Error('tsDetect returned an unexpected location format.');
    }

    const numberOfTestMethods = Number(rows[0][1]);
    if (
      !Number.isSafeInteger(numberOfTestMethods) ||
      numberOfTestMethods < 0
    ) {
      throw new Error('tsDetect returned an invalid test method count.');
    }

    const parsedFindings = rows.slice(1).map(parseFinding);
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
