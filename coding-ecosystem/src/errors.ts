export class StartupFailure extends Error {
  readonly isRetryable: boolean;

  constructor(message: string, isRetryable: boolean) {
    super(message);
    this.name = "StartupFailure";
    this.isRetryable = isRetryable;
  }
}

export function isStartupFailure(err: unknown): err is StartupFailure {
  return err instanceof StartupFailure;
}
