import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";

/** Never trust client metadata to be safe HTML, even when it was validated. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => "&#" + char.charCodeAt(0) + ";");
}

/** No JavaScript, external assets, pop-ups or non-self form targets. */
export function consentPage(details: ConsentDescription, handle: string): string {
  const name = escapeHtml(details.clientName);
  const domain = details.clientDomain
    ? "<strong>" + escapeHtml(details.clientDomain) + "</strong>"
    : "An unverified app registration";
  const redirectHost = escapeHtml(details.redirectHost);
  const options = details.scope
    .filter((scope) => scope === "mcp:read")
    .map((scope) =>
      '<label><input type="checkbox" name="scope" value="' + escapeHtml(scope) +
      '" checked> Read-only MCP diagnostics</label>'
    ).join("");

  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Authorize ' + name + ' — Meta Master MCP</title></head><body>' +
    '<main><h1>Allow ' + name + ' to access Meta Master MCP?</h1>' +
    '<p>Client domain: ' + domain + '</p>' +
    '<p>The OAuth response will be sent to <strong>' + redirectHost + '</strong>.</p>' +
    (details.redirectIsLoopback
      ? '<p><strong>Local app warning:</strong> access will be sent to software running on your computer. Proceed only if you initiated this sign-in.</p>'
      : '') +
    '<p>This connection cannot access Meta, publish posts, send messages or manage advertising yet.</p>' +
    '<p>After allowing, sign in using GitHub to verify your operator identity.</p>' +
    '<form method="post" action="/authorize">' +
    '<input type="hidden" name="handle" value="' + escapeHtml(handle) + '">' +
    '<fieldset><legend>Requested permissions</legend>' + options + '</fieldset>' +
    '<p><button name="decision" value="approve" type="submit">Allow and sign in</button> ' +
    '<button name="decision" value="deny" type="submit">Deny</button></p>' +
    '</form></main></body></html>';
}
