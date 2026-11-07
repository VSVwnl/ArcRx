// GET /api/me — session probe. 401 from the platform means signed out (public
// pages show the sign-in screen); otherwise the viewer's identity and app roles.
export async function GET({ request, platform }) {
  const u = request.user || null;
  return {
    user: u ? {
      id: u.id ?? null,
      issuer: u.issuer ?? 'informer',
      name: u.displayName || u.name || u.username || u.email || 'Signed in',
      username: u.username ?? null,
      email: u.email ?? null,
    } : null,
    roles: Array.isArray(request.roles) ? request.roles : [],
    platform: { version: platform?.version ?? null, originMode: platform?.originMode ?? null },
  };
}
