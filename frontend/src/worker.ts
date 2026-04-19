export interface Env {
  BACKEND: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 1. Intercept API and Asset requests and proxy them to the BACKEND service binding
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/assets/')) {
      const backendUrl = `http://backend${url.pathname}${url.search}`;

      // We reconstruct the request to ensure the Host header doesn't cause issues
      const newRequest = new Request(backendUrl, request);
      return env.BACKEND.fetch(newRequest);
    }

    // 2. Otherwise, return 404 to let Cloudflare's Assets feature handle the static files
    // Note: In the unified Worker+Assets mode, Cloudflare serves the assets automatically 
    // for any request that returns a 404 from the script if [assets] is configured without a binding.
    // However, the most reliable way to serve assets from a script is usually to return 404 
    // or use the ASSETS binding if provided.
    return new Response("Not Found", { status: 404 });
  }
};
