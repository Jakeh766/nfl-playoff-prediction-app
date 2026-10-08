async function apiRequest(path, options = {}) {
  const protectedRequest =
    ["/api/prediction", "/api/profile"].includes(path) ||
    path.startsWith("/api/groups");
  const accessToken = protectedRequest ? await getValidAccessToken() : null;
  if (protectedRequest && !accessToken) {
    renderAuthentication(false);
    const error = new Error("Your session expired. Please sign in again.");
    error.status = 401;
    throw error;
  }

  const { sport: requestSport, ...requestOptions } = options;
  const url = new URL(sportUrl(path), window.location.origin);
  if (requestSport) url.searchParams.set("sport", requestSport);
  const response = await fetch(url.pathname + url.search + url.hash, {
    cache: "no-store",
    ...requestOptions,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      payload.message || "The prediction service is unavailable.",
    );
    error.status = response.status;
    if (response.status === 401 && protectedRequest) {
      clearAuthSession();
      renderAuthentication(false);
    }
    throw error;
  }
  return payload;
}
