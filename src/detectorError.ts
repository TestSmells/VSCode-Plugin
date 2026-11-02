/** Failure categories that the extension can explain to a user. */
export type DetectorFailureKind =
  | 'cancelled'
  | 'timeout'
  | 'missing-executable'
  | 'missing-jar'
  | 'output-limit'
  | 'process-failed'
  | 'invalid-output';

/** An actionable detector failure plus details intended for the Output panel. */
export class DetectorExecutionError extends Error {
  constructor(
    public readonly kind: DetectorFailureKind,
    message: string,
    public readonly technicalDetails: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'DetectorExecutionError';
  }
}
