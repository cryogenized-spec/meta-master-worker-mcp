/** Operator sign-in and informed per-client consent must exist before grants. */
export function consentUnavailable(): Response {
  return new Response(JSON.stringify({
    error: "authorization_not_enabled",
    message: "Operator sign-in and client consent have not been configured.",
  }), {
    status: 403,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    },
  });
}

/** M1.2 auth Worker cannot be used until storage and issuer are configured. */
export function authServiceUnavailable(): Response {
  return new Response(JSON.stringify({ error: "auth_not_configured" }), {
    status: 503,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
