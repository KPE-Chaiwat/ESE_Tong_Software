import type { ConnectionConfig } from "@/shared/ipc/modbus-master.types";
import type { ConnectionDraftStoreApi } from "../store/connection-draft.store";
import { connectionToForm } from "../validation/forms";
import { connectionSchema, validate } from "../validation/schemas";

/**
 * How the runtime talks to the CONNECTION section form (react-hook-form). The form registers the
 * real implementation while it is mounted; the default validates the typed draft in the draft
 * store, which is what tests and a hidden form see.
 */
export interface ConnectionFormGateway {
  /** Validates the fields, shows their messages, focuses the first invalid one. Null when invalid. */
  validate(): Promise<ConnectionConfig | null>;
  /** A connection that came from Rust (a reload): the form shows it. */
  adopt(config: ConnectionConfig): void;
  /**
   * Shows a backend `validation` message under the DTO field it names and focuses that input.
   * Returns false when the form has no such input.
   */
  showFieldError(field: string, message: string): boolean;
}

export interface ConnectionFormHolder {
  current: ConnectionFormGateway;
  /** Restores the default draft-store gateway (the form unmounted). */
  restore(): void;
}

export function createDraftGateway(draft: ConnectionDraftStoreApi): ConnectionFormGateway {
  return {
    async validate() {
      const result = validate(connectionSchema, connectionToForm(draft.getState().connection));
      return result.ok ? result.value : null;
    },
    adopt(config) {
      draft.getState().setConnection(config);
    },
    showFieldError: () => false,
  };
}

export function createConnectionFormHolder(draft: ConnectionDraftStoreApi): ConnectionFormHolder {
  const holder: ConnectionFormHolder = {
    current: createDraftGateway(draft),
    restore() {
      holder.current = createDraftGateway(draft);
    },
  };
  return holder;
}
