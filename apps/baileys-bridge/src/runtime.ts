/**
 * Linked-device auth currently uses Baileys' multi-file local state.
 * A Cloudflare Container has an ephemeral filesystem. Fail closed rather
 * than repeatedly losing/re-pairing Signal credentials on container restarts.
 */
export function assertSupportedHost(settings: { readonly BAILEYS_HOST_MODE?: string }): void {
  const mode = settings.BAILEYS_HOST_MODE ?? "local";
  if (mode !== "local") {
    throw new Error("remote_session_backend_not_implemented");
  }
}
