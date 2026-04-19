export const onRequest: PagesFunction<{ BACKEND: Fetcher }> = async (context) => {
  const url = new URL(context.request.url);
  // Reconstruct the internal request specifically targeting the backend service
  // e.g. /assets/taxbills becomes http://backend/assets/taxbills
  const backendUrl = `http://backend${url.pathname}${url.search}`;
  
  // Proxy the request dynamically via the native Service Binding!
  return context.env.BACKEND.fetch(new Request(backendUrl, context.request));
};
