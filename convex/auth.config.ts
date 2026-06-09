/*
 * Convex auth — verifies Clerk-issued JWTs.
 *
 * The `domain` is your Clerk Frontend API (different per Clerk env).
 * Get it from the Clerk dashboard → Configure → API Keys → "Frontend API".
 * For Marina Stee dev it'll look like `https://moving-falcon-12.clerk.accounts.dev`.
 *
 * `applicationID` must match the JWT template name in Clerk dashboard.
 * Convex's setup docs walk through creating this template — name it "convex".
 *
 * In production, swap CLERK_JWT_ISSUER_DOMAIN to the production Clerk Frontend
 * API URL via env var on Convex (`npx convex env set CLERK_JWT_ISSUER_DOMAIN ...`).
 */

export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
};
