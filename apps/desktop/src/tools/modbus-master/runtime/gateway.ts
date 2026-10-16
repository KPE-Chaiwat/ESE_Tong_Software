import type { ConnectionConfig, PollDefinition } from "@/shared/ipc/modbus-master.types";
import type { ConfigStoreApi } from "../store/config.store";
import { connectionToForm, pollToForm } from "../validation/forms";
import { connectionSchema, pollSchema, validate } from "../validation/schemas";

/**
 * How the controller asks the setup form whether its drafts are valid. The form (react-hook-form)
 * registers the real implementation; this default validates the typed values in the config store,
 * which is what tests and a hidden form see.
 */
export interface FormGateway {
  /** Validates the connection fields, shows their errors and focuses the first invalid one. */
  validateConnection(): Promise<ConnectionConfig | null>;
  /** Same for the poll fields. */
  validatePoll(): Promise<PollDefinition | null>;
  /**
   * Validates the Connection and the Poll fields together, shows every message (not just the
   * first section's) and focuses the first invalid field. Used before a profile is saved.
   */
  validateAll(): Promise<{ connection: ConnectionConfig; poll: PollDefinition } | null>;
  /** Validates the poll draft silently (no errors shown, no focus change). */
  peekPoll(): PollDefinition | null;
  /** Validates the whole form after a profile load, so bad values show as invalid input. */
  revalidate(): Promise<void>;
  /**
   * Shows a backend `validation` message under the DTO field it names and focuses that input.
   * Returns false when the form has no such input.
   */
  showFieldError(field: string, message: string): boolean;
}

export interface GatewayHolder {
  current: FormGateway;
  /** Restores the default store-based gateway. */
  restore(): void;
}

export function createStoreGateway(config: ConfigStoreApi): FormGateway {
  const poll = (): PollDefinition | null => {
    const { poll: p, connection, display } = config.getState();
    const result = validate(
      pollSchema(connection.mode, display.addressBase),
      pollToForm(p, display.addressBase),
    );
    return result.ok ? result.value : null;
  };
  return {
    async validateConnection() {
      const result = validate(connectionSchema, connectionToForm(config.getState().connection));
      return result.ok ? result.value : null;
    },
    async validatePoll() {
      return poll();
    },
    peekPoll: poll,
    async validateAll() {
      const connection = await this.validateConnection();
      const pollDef = poll();
      return connection && pollDef ? { connection, poll: pollDef } : null;
    },
    async revalidate() {},
    showFieldError: () => false,
  };
}

export function createGatewayHolder(config: ConfigStoreApi): GatewayHolder {
  const holder: GatewayHolder = {
    current: createStoreGateway(config),
    restore() {
      holder.current = createStoreGateway(config);
    },
  };
  return holder;
}
