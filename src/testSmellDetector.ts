import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { parseCsv } from './csv';
const execFileAsync = promisify(execFile);
export interface DetectorOptions {
  applicationName: string; jarPath: string; javaPath: string;
  productionFilePath: string; testFilePath: string;
}
export interface DetectorFinding {
  name: string;
  scope: 'method' | 'class' | 'file';
  elementName: string;
  /** One-based positions. End column is exclusive. */
  location?: { startLine: number; startColumn: number; endLine: number; endColumn: number };
}
export interface DetectorResult {
  detectedSmells: string[];
  numberOfTestMethods: number;
  findings: DetectorFinding[];
}
export async function runDetector(options: DetectorOptions): Promise<DetectorResult> {
  const bridgePath = path.join(path.dirname(options.jarPath), 'tsdetect-locations.jar');
  await access(options.jarPath);
  try { await access(bridgePath); } catch {
    throw new Error('Missing detector/tsdetect-locations.jar. Copy both detector JARs from the update.');
  }
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'test-smell-detector-'));
  const outputPath = path.join(temporaryDirectory, 'locations.csv');
  try {
    await execFileAsync(options.javaPath, [
      '-cp', [bridgePath, options.jarPath].join(path.delimiter), 'LocationBridge',
      options.applicationName, options.testFilePath, options.productionFilePath, outputPath,
    ], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    const rows = parseCsv(await readFile(outputPath, 'utf8'));
    if (rows[0]?.length !== 2 || rows[0][0] !== 'TSDETECT_LOCATIONS_V1') {
      throw new Error('Unexpected location bridge output.');
    }
    const numberOfTestMethods = Number(rows[0][1]);
    if (!Number.isSafeInteger(numberOfTestMethods) || numberOfTestMethods < 0) {
      throw new Error('Invalid test method count.');
    }
    const findings: DetectorFinding[] = rows.slice(1).map(row => {
      if (row.length !== 7 || !row[0] || !['method', 'class', 'file'].includes(row[1])) {
        throw new Error('Invalid finding in location bridge output.');
      }
      const scope = row[1] as DetectorFinding['scope'];
      let location: DetectorFinding['location'];
      if (scope !== 'file') {
        const [startLine, startColumn, endLine, endColumn] = row.slice(3).map(Number);
        if (![startLine, startColumn, endLine, endColumn].every(v => Number.isSafeInteger(v) && v > 0)
          || endLine < startLine || (endLine === startLine && endColumn <= startColumn)) {
          throw new Error('Invalid source location in detector output.');
        }
        location = { startLine, startColumn, endLine, endColumn };
      }
      return { name: row[0], scope, elementName: row[2], location };
    });
    return { findings, detectedSmells: [...new Set(findings.map(f => f.name))], numberOfTestMethods };
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}
