import { spawn } from 'node:child_process';

import {
  DetectorExecutionError,
  DetectorFailureKind,
} from './detectorError';

const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const FORCE_KILL_DELAY_MILLISECONDS = 1_000;

export interface ProcessOptions {
  executable: string;
  args: string[];
  timeoutMilliseconds: number;
  signal?: AbortSignal;
  maxOutputBytes?: number;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
}

interface ProcessOutcome {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
}

/** Run one bounded process and stop it when cancelled or timed out. */
export function executeProcess(
  options: ProcessOptions,
): Promise<ProcessResult> {
  if (
    !Number.isFinite(options.timeoutMilliseconds) ||
    options.timeoutMilliseconds <= 0
  ) {
    throw new TypeError('Process timeout must be greater than zero.');
  }

  if (options.signal?.aborted) {
    return Promise.reject(
      createExecutionError('cancelled', options, emptyOutcome()),
    );
  }

  return new Promise((resolve, reject) => {
    const child = spawn(options.executable, options.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const maxOutputBytes =
      options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let terminationReason: DetectorFailureKind | undefined;
    let settled = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

    const timeoutTimer = setTimeout(() => {
      terminate('timeout');
    }, options.timeoutMilliseconds);

    const onAbort = (): void => {
      terminate('cancelled');
    };

    const cleanUp = (): void => {
      clearTimeout(timeoutTimer);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      options.signal?.removeEventListener('abort', onAbort);
    };

    const settleWithError = (error: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanUp();
      reject(error);
    };

    const terminate = (reason: DetectorFailureKind): void => {
      if (settled || terminationReason) {
        return;
      }
      terminationReason = reason;
      child.kill();
      forceKillTimer = setTimeout(() => {
        if (!settled) {
          child.kill('SIGKILL');
        }
      }, FORCE_KILL_DELAY_MILLISECONDS);
    };

    const collectOutput = (
      chunk: Buffer | string,
      target: 'stderr' | 'stdout',
    ): void => {
      const text = chunk.toString();
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > maxOutputBytes) {
        terminate('output-limit');
        return;
      }
      if (target === 'stdout') {
        stdout += text;
      } else {
        stderr += text;
      }
    };

    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) {
      onAbort();
    }
    child.stdout?.on('data', (chunk: Buffer | string) => {
      collectOutput(chunk, 'stdout');
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      collectOutput(chunk, 'stderr');
    });

    child.once('error', (error: NodeJS.ErrnoException) => {
      const kind: DetectorFailureKind =
        error.code === 'ENOENT' ? 'missing-executable' : 'process-failed';
      settleWithError(
        createExecutionError(
          kind,
          options,
          {
            exitCode: null,
            signal: null,
            stderr,
            stdout,
          },
          error,
        ),
      );
    });

    child.once('close', (exitCode, signal) => {
      if (settled) {
        return;
      }

      const outcome = { exitCode, signal, stderr, stdout };
      if (terminationReason) {
        settleWithError(
          createExecutionError(terminationReason, options, outcome),
        );
        return;
      }

      if (exitCode !== 0) {
        settleWithError(
          createExecutionError('process-failed', options, outcome),
        );
        return;
      }

      settled = true;
      cleanUp();
      resolve({ stderr, stdout });
    });
  });
}

function emptyOutcome(): ProcessOutcome {
  return { exitCode: null, signal: null, stderr: '', stdout: '' };
}

function createExecutionError(
  kind: DetectorFailureKind,
  options: ProcessOptions,
  outcome: ProcessOutcome,
  cause?: unknown,
): DetectorExecutionError {
  const seconds = options.timeoutMilliseconds / 1_000;
  const messages: Record<DetectorFailureKind, string> = {
    cancelled: 'Test smell analysis was cancelled.',
    timeout: `Test smell analysis exceeded its ${seconds}-second timeout. Increase the analysis timeout or check whether Java is responding.`,
    'missing-executable': `Java could not be started from "${options.executable}". Install Java 11 or newer, or update Test Smell Detector: Java Path in VS Code settings.`,
    'missing-jar': 'A required detector JAR is missing.',
    'output-limit':
      'The detector produced too much process output. Check the Java and detector configuration.',
    'process-failed':
      'The detector process failed. Confirm Java 11 or newer is installed and review the technical details in the Output panel.',
    'invalid-output': 'The detector returned invalid output.',
  };

  const processSummary = outcome.stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const message =
    kind === 'process-failed' && processSummary
      ? `${messages[kind]} Java reported: ${processSummary}`
      : messages[kind];

  return new DetectorExecutionError(
    kind,
    message,
    formatTechnicalDetails(options, outcome, cause),
    cause === undefined ? undefined : { cause },
  );
}

function formatTechnicalDetails(
  options: ProcessOptions,
  outcome: ProcessOutcome,
  cause?: unknown,
): string {
  const lines = [
    `Executable: ${options.executable}`,
    `Arguments: ${options.args.map((argument) => JSON.stringify(argument)).join(' ')}`,
    `Timeout: ${options.timeoutMilliseconds} ms`,
    `Exit code: ${outcome.exitCode ?? '(none)'}`,
    `Signal: ${outcome.signal ?? '(none)'}`,
  ];

  if (cause instanceof Error) {
    lines.push(`Process error: ${cause.message}`);
  }

  lines.push(
    `Standard output:\n${outcome.stdout.trim() || '(empty)'}`,
    `Standard error:\n${outcome.stderr.trim() || '(empty)'}`,
  );
  return lines.join('\n');
}
