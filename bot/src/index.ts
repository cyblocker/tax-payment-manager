import { Hono } from 'hono';

export type Env = {
  TELEGRAM_ALLOWED_USER_ID: string;
  TELEGRAM_BOT_TOKEN: string;
  BACKEND: Fetcher;
};

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) => {
  return c.text('Telegram Private Router Worker is running');
});

// Incoming webhook from Telegram
app.post('/webhook', async (c) => {
  try {
    const payload = await c.req.json();
    const message = payload.message || payload.callback_query?.message;
    const userId = payload.message?.from?.id?.toString() || payload.callback_query?.from?.id?.toString();

    // Verification check for allowed user ID
    console.log(`[BOT] Incoming webhook from user: ${userId}`);
    if (userId !== c.env.TELEGRAM_ALLOWED_USER_ID) {
      console.warn(`[BOT] Unauthorized access attempt from user: ${userId}. Expected: ${c.env.TELEGRAM_ALLOWED_USER_ID}`);
      return new Response('Unauthorized', { status: 403 });
    }

    console.log("[BOT] Forwarding payload to backend...");
    // Forward the verified payload internally to the Tax Manager Worker via Service Binding
    if (c.env.BACKEND) {
      c.executionCtx.waitUntil(
        c.env.BACKEND.fetch(new Request("http://backend/internal/bot-handler", {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })).then(r => r.text()).then(t => console.log(`[BOT] Backend responded: ${t}`))
           .catch(err => console.error("[BOT] Error forwarding payload: ", err))
      );
    }

    // Always return 200 OK to Telegram quickly
    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error("Webhook processing error: ", error);
    return new Response('Internal Router Error', { status: 500 });
  }
});

// Forward backend API calls explicitly destined for Telegram
app.post('/api/:method', async (c) => {
  const method = c.req.param('method');
  const tgUrl = `https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/${method}`;
  console.log(`[BOT] Proxying API call: ${method}`);
  
  const body = await c.req.arrayBuffer();
  const headers = new Headers(c.req.raw.headers);
  headers.delete('host'); // Critical: Remove internal host header
  
  const res = await fetch(tgUrl, {
    method: 'POST',
    headers: headers,
    body: body
  });
  
  const resText = await res.clone().text();
  console.log(`[BOT] Telegram response for ${method}: ${resText.substring(0, 100)}...`);
  return res;
});

// Proxy file downloads via CDN explicitly bypassing BOT URL limits
app.get('/file/:path{.*}', async (c) => {
  const path = c.req.param('path');
  const tgUrl = `https://api.telegram.org/file/bot${c.env.TELEGRAM_BOT_TOKEN}/${path}`;
  
  return fetch(new Request(tgUrl, c.req.raw));
});

// Internal endpoint to notify the admin reliably
app.post('/api/notify-admin', async (c) => {
  try {
    const { text } = await c.req.json();
    const tgUrl = `https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    
    return fetch(new Request(tgUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: c.env.TELEGRAM_ALLOWED_USER_ID,
        text: text,
        parse_mode: 'Markdown'
      })
    }));
  } catch (error) {
    return new Response('Error rendering notification', { status: 500 });
  }
});

export default app;
