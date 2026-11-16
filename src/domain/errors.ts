export type DomainErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "INSUFFICIENT_STOCK"
  | "INVALID_STATE"
  | "LOGIN_FAILED"
  | "DUPLICATE";

/** İş kuralı ihlali. Arayüz `code` alanına göre Türkçe ileti gösterir; `message` geliştirici içindir. */
export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
