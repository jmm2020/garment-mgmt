export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id: string | number) {
    super("not_found", `${entity} ${id} not found`, 404);
  }
}

export class BusinessRuleError extends DomainError {
  constructor(rule: string, message: string, details?: unknown) {
    super(`rule.${rule}`, message, 409, details);
  }
}

export class ValidationFailedError extends DomainError {
  constructor(message: string, details?: unknown) {
    super("validation_failed", message, 400, details);
  }
}

export class AuthError extends DomainError {
  constructor(reason: "unauthorized" | "forbidden" | "invalid_credentials", message: string) {
    const status = reason === "forbidden" ? 403 : 401;
    super(`auth.${reason}`, message, status);
  }
}

export function isDomainError(err: unknown): err is DomainError {
  return err instanceof DomainError;
}
