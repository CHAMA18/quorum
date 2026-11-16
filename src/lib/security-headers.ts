/**
 * Response hardening for every route.
 *
 * The CSP is a backstop, not a replacement for server authorization. It keeps
 * the procurement console out of frames, blocks plugin content, and names the
 * origins the product actually uses. Inline/eval script allowances are kept
 * because Next's hydration and the dev overlay need them; the remaining
 * directives still remove the broadest injection surface.
 */
export const SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com https://www.gstatic.com",
      "style-src 'self' 'unsafe-inline' https://api.fontshare.com",
      "font-src 'self' data: https://cdn.fontshare.com",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob: https:",
      "connect-src 'self' https: wss:",
      "worker-src 'self' blob:",
      "frame-src 'self' https://accounts.google.com",
    ].join("; "),
  },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()",
  },
] as const;
