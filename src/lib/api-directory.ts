/** Safe, public discovery metadata for Quorum's existing API surfaces. */
export const API_DIRECTORY = {
  service: "quorum-api",
  basePath: "/api",
  documentation: "/docs",
  authentication: {
    workspace: "Verified Quorum session cookie; route permissions are checked on the server.",
    sidecar: "Same-origin gateway requires a Quorum session and role. Mutations are HMAC-attested before forwarding.",
    supplier: "Separate organization session cookie for supplier portal routes.",
    remote: "External AI clients use the authenticated, read-only MCP gateway at /mcp.",
  },
  surfaces: [
    {
      id: "public",
      title: "Health and public data",
      audience: "Public",
      auth: "No session",
      description: "Service readiness and privacy-filtered activity for the public product surfaces.",
      endpoints: [
        "GET /api — this discovery document",
        "GET /api/health — web API and sidecar readiness",
        "GET /api/public/summary — redacted workspace activity",
      ],
    },
    {
      id: "workspace",
      title: "Workspace API",
      audience: "Signed-in workspace members",
      auth: "Quorum session + role permissions",
      description: "Authentication, committee, people, notifications, tender documents, and oversight routes.",
      endpoints: [
        "GET /api/auth/me · POST /api/auth/login · POST /api/auth/logout",
        "GET /api/committee · GET /api/team · GET /api/notifications",
        "GET|POST|DELETE /api/tenders/:ref/docs",
        "POST /api/pipeline/:id/requisition — session + role check; Redis limit 20 per 15 minutes",
        "GET /api/oversight · GET /api/audit-export?format=json|pdf",
      ],
    },
    {
      id: "procurement",
      title: "Procurement REST API",
      audience: "Signed-in desk members",
      auth: "Quorum session + role permissions",
      description: "The sidecar is reached through the same-origin gateway. Add XTransformPort=3031 to these paths when calling the Next.js gateway directly.",
      endpoints: [
        "GET|POST /api/runs?XTransformPort=3031",
        "GET /api/runs/:id/report?XTransformPort=3031",
        "GET /api/gates?XTransformPort=3031 · POST /api/gates/:id/decision?XTransformPort=3031",
        "GET /api/tools?XTransformPort=3031 · GET /api/log?limit=50&XTransformPort=3031",
      ],
    },
    {
      id: "supplier",
      title: "Supplier portal API",
      audience: "Signed-in supplier organizations",
      auth: "Organization session cookie",
      description: "Organization profile, published opportunities, and attested applications use the supplier account space.",
      endpoints: [
        "GET /api/org/tenders · GET|POST /api/org/applications",
        "PATCH /api/org/profile",
        "POST /api/org/auth/register · POST /api/org/auth/login · POST /api/org/auth/logout",
      ],
    },
    {
      id: "mcp",
      title: "External AI client API",
      audience: "MCP-compatible clients",
      auth: "Bearer token at the edge gateway",
      description: "Remote clients use the read-only MCP protocol so workspace REST cookies and the private origin credential stay server-side.",
      endpoints: [
        "POST /mcp — initialize · ping · tools/list · tools/call",
      ],
    },
  ],
} as const;
