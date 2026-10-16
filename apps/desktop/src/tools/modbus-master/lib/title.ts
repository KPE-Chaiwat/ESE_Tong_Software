/** Window title: `Modbus Master - {profile name or "Untitled"}{" *" if modified} - {pill label}` (DES-001 2.3). */
export function windowTitle(
  profileName: string | null,
  modified: boolean,
  pillLabel: string,
): string {
  return `Modbus Master - ${profileName ?? "Untitled"}${modified ? " *" : ""} - ${pillLabel}`;
}
