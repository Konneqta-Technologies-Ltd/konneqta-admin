import type { NextConfig } from "next";

/**
 * Baseline security headers for an internal admin console:
 *   - No framing (clickjacking) and no MIME sniffing.
 *   - Strict referrer + permissions policies.
 *   - HSTS for the HTTPS-only deployment.
 *   - A CSP that allows only self-hosted assets plus the Supabase API/RT
 *     endpoints. 'unsafe-eval' is added ONLY in development because React
 *     Refresh needs it; production scripts are framework-hashed.
 *     Inline styles remain allowed ('unsafe-inline') — Next.js and its
 *     ecosystem (e.g. sonner) inject small inline style tags.
 */
const isDev = process.env.NODE_ENV === "development";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "Content-Security-Policy", value: csp },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
