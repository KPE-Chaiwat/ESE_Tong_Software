// Error type of the IPC facade and its fake. Only `shared/ipc`
// may import `@tauri-apps/api`; everything else sees rejections as `IpcError`.

/** A command rejection. `code` is the stable `AppError.code` from the backend when there is one. */
export class IpcError extends Error {
  readonly code: string;
  /** For `validation` errors: the DTO input field the backend objected to (`AppError.field`). */
  readonly field: string | null;

  constructor(message: string, code = "unknown", field: string | null = null) {
    super(message);
    this.name = "IpcError";
    this.code = code;
    this.field = field;
  }
}

/** Turns whatever `invoke` rejected with (an `AppError` object or a string) into an `IpcError`. */
export function toIpcError(e: unknown): IpcError {
  if (e instanceof IpcError) return e;
  if (typeof e === "string") return new IpcError(e);
  if (e && typeof e === "object") {
    const { message, code, field } = e as { message?: unknown; code?: unknown; field?: unknown };
    if (typeof message === "string") {
      return new IpcError(
        message,
        typeof code === "string" ? code : "unknown",
        typeof field === "string" ? field : null,
      );
    }
  }
  if (e instanceof Error) return new IpcError(e.message);
  return new IpcError("Unknown error");
}

export type Unsubscribe = () => void;
