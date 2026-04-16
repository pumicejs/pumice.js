import type { ServerPlugin } from "./types/plugin.js";

/**
 * Ensures a plugin with `unique: true` is not registered twice (same `id`).
 * Called from {@link Server.use} and {@link ServerBuilder.use}.
 */
export function assertUniquePluginRegistration(
  existing: readonly ServerPlugin[],
  incoming: ServerPlugin,
  where: string,
): void {
  if (!incoming.unique) {
    return;
  }

  if (typeof incoming.id !== "string" || incoming.id.length === 0) {
    throw new Error(
      `${where}: server plugin has unique: true but "id" must be a non-empty string.`,
    );
  }

  const conflict = existing.find(
    (plugin) => plugin.unique === true && plugin.id === incoming.id,
  );

  if (conflict !== undefined) {
    throw new Error(
      `${where}: duplicate server plugin id "${incoming.id}". Only one plugin with unique: true and this id may be registered.`,
    );
  }
}
