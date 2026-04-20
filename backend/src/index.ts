import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { drizzle } from 'drizzle-orm/d1';
import { eq, desc, and, lt } from 'drizzle-orm';
import { taxBills } from './db/schema';
import { extractTaxBillInfo } from './gemini';

export type Env = {
  DB: D1Database;
  BUCKET: R2Bucket;
  GEMINI_API_KEY: string;
  BOT?: Fetcher;
};

const app = new Hono<{ Bindings: Env }>();

app.use('/*', cors());

// GET /api/taxbills -> Fetch all bills sorted by created desc
app.get('/api/taxbills', async (c) => {
  const db = drizzle(c.env.DB);

  const bills = await db.select().from(taxBills).orderBy(desc(taxBills.createdAt)).all();
  return c.json(bills);
});

// Fallback for older database entries
app.get('/taxbills/:file{.+}', async (c) => {
  const file = c.req.param('file');
  const object = await c.env.BUCKET.get(`taxbills/${file}`);
  if (!object) return c.text('Object not found', 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  return new Response(object.body, { headers });
});

// GET /assets/* -> Serve images directly from R2
app.get('/assets/:folder/:file{.+}', async (c) => {
  const folder = c.req.param('folder');
  const file = c.req.param('file');
  if (folder !== 'taxbills' && folder !== 'receipts') {
    return c.text('Forbidden', 403);
  }

  const key = `${folder}/${file}`;
  const object = await c.env.BUCKET.get(key);

  if (!object) return c.text('Object not found', 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);

  return new Response(object.body, { headers });
});

// POST /api/upload -> Upload an image, save to R2, extract data, save to D1
app.post('/api/upload', async (c) => {
  try {
    const formData = await c.req.parseBody();
    const file = formData['file'];

    if (!file || typeof file === 'string') {
      return c.json({ error: 'No valid file uploaded' }, 400);
    }

    const arrayBuffer = await file.arrayBuffer();

    // Save image to R2
    const fileExtension = file.name ? file.name.split('.').pop() : 'png';
    const objectKey = `taxbills/${crypto.randomUUID()}.${fileExtension}`;
    await c.env.BUCKET.put(objectKey, arrayBuffer, {
      httpMetadata: { contentType: file.type || 'image/png' }
    });
    const publicUrl = `/assets/${objectKey}`; // Expose via generic asset route

    // Pass to Gemini 2.0 Flash
    const extractedData = await extractTaxBillInfo(arrayBuffer, file.type || 'image/png', c.env.GEMINI_API_KEY);

    if (!extractedData) {
      return c.json({ error: 'Failed to extract data' }, 500);
    }

    const db = drizzle(c.env.DB);
    // Insert into DB
    const [inserted] = await db.insert(taxBills).values({
      originalImage: publicUrl,
      taxType: extractedData.tax_type,
      taxYear: extractedData.tax_year,
      payIndex: String(extractedData.pay_index || ''),
      amount: extractedData.amount,
      agencyCode: extractedData.agency_code,
      paymentNumber: extractedData.payment_number,
      confirmationNumber: extractedData.confirmation_number,
      paymentCategory: extractedData.payment_category,
      dueDate: extractedData.due_date,
      status: 'PENDING'
    }).returning();

    return c.json(inserted);
  } catch (error: any) {
    console.error('Upload Error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// PUT /api/taxbills/:id -> Update bill metadata
app.put('/api/taxbills/:id', async (c) => {
  const idStr = c.req.param('id');
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

  const body = await c.req.json();
  const db = drizzle(c.env.DB);

  const [updated] = await db.update(taxBills)
    .set({ ...body })
    .where(eq(taxBills.id, id))
    .returning();

  if (!updated) return c.json({ error: 'Not found' }, 404);
  return c.json(updated);
});

// POST /api/taxbills/:id/receipt -> Upload a receipt image
app.post('/api/taxbills/:id/receipt', async (c) => {
  const idStr = c.req.param('id');
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

  try {
    const formData = await c.req.parseBody();
    const file = formData['file'];
    if (!file || typeof file === 'string') return c.json({ error: 'No valid file uploaded' }, 400);

    const arrayBuffer = await file.arrayBuffer();
    const ext = file.name ? file.name.split('.').pop() : 'jpg';
    const objectKey = `receipts/${crypto.randomUUID()}.${ext}`;

    await c.env.BUCKET.put(objectKey, arrayBuffer, {
      httpMetadata: { contentType: file.type || 'image/jpeg' }
    });

    const db = drizzle(c.env.DB);
    await db.update(taxBills).set({ paymentScreenshot: `/${objectKey}` }).where(eq(taxBills.id, id));

    return c.json({ success: true, url: `/assets/${objectKey}` });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// DELETE /api/taxbills/:id -> Delete bill record and associated R2 images
app.delete('/api/taxbills/:id', async (c) => {
  const idStr = c.req.param('id');
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

  const db = drizzle(c.env.DB);

  // Fetch the record first so we can clean up R2 objects
  const [bill] = await db.select().from(taxBills).where(eq(taxBills.id, id)).limit(1);
  if (!bill) return c.json({ error: 'Not found' }, 404);

  // Helper: extract R2 key from stored path (e.g. "/assets/taxbills/xxx.png" -> "taxbills/xxx.png")
  const extractR2Key = (path: string | null): string | null => {
    if (!path) return null;
    // Handle both "/assets/taxbills/..." and "/taxbills/..." formats
    const match = path.match(/\/?(?:assets\/)?((?:taxbills|receipts)\/.+)/);
    return match ? match[1] : null;
  };

  // Delete R2 objects (fire-and-forget, don't fail the whole request)
  const keysToDelete = [
    extractR2Key(bill.originalImage),
    extractR2Key(bill.paymentScreenshot),
  ].filter(Boolean) as string[];

  await Promise.allSettled(keysToDelete.map(key => c.env.BUCKET.delete(key)));

  // Delete the DB record
  await db.delete(taxBills).where(eq(taxBills.id, id));

  return c.json({ success: true });
});

// Internal bot handler for the private telegram router
import { TelegramBot } from './bot';

app.post('/internal/bot-handler', async (c) => {
  const body = await c.req.json();
  console.log("DEBUG: Received bot payload for user:", body.message?.from?.id || body.callback_query?.from?.id);

  if (!c.env.BOT) {
    return c.json({ status: 'ok', msg: 'Bot request skipped: No BOT binding found' });
  }

  const bot = new TelegramBot(c.env.BOT, c.env.DB, c.env.BUCKET, c.env.GEMINI_API_KEY);

  c.executionCtx.waitUntil(
    bot.handleUpdate(body).catch(err => {
      console.error("CRITICAL: Bot Handle Error:", err);
    })
  );

  return c.json({ status: 'ok', msg: 'Bot request acknowledged in Main Worker' });
});

export default {
  fetch: app.fetch,
  async scheduled(event: any, env: Env, ctx: ExecutionContext) {
    const db = drizzle(env.DB);
    const today = new Date();
    
    const bills = await db.select().from(taxBills).all();
    
    for (const b of bills) {
      if (b.status === 'PENDING' && b.dueDate) {
        const due = new Date(b.dueDate);
        const diffDays = Math.round((due.getTime() - today.getTime()) / (1000 * 3600 * 24));
        
        if (diffDays === 7 || diffDays === 3 || diffDays === 1) {
          const msg = `⚠️ *Action Required: Upcoming Tax Deadline*\n\nTax: ${b.taxType || 'Unknown'}\nAmount: ¥${b.amount}\nDue in: ${diffDays} day(s)`;
          if (env.BOT) {
            await env.BOT.fetch(new Request("http://bot/api/notify-admin", {
              method: 'POST',
              body: JSON.stringify({ text: msg }),
            }));
          }
        }
      }
      
      if (b.status === 'SCHEDULED' && b.scheduledDate) {
        const sched = new Date(b.scheduledDate);
        const diffDays = Math.round((sched.getTime() - today.getTime()) / (1000 * 3600 * 24));
        
        if (diffDays === 1) {
          const msg = `🔔 *Reminder: Scheduled Payment Tomorrow*\n\nTax: ${b.taxType || 'Unknown'}\nAmount: ¥${b.amount}`;
          if (env.BOT) {
            await env.BOT.fetch(new Request("http://bot/api/notify-admin", {
              method: 'POST',
              body: JSON.stringify({ text: msg }),
            }));
          }
        } else if (diffDays < 0) {
          // Past the scheduled date
          await db.update(taxBills).set({ status: 'PAID' }).where(eq(taxBills.id, b.id));
          const msg = `✅ *Payment Marked as Paid*\n\nTax: ${b.taxType || 'Unknown'}\nThe scheduled date has passed and the bill was automatically moved to Paid status.`;
          if (env.BOT) {
            await env.BOT.fetch(new Request("http://bot/api/notify-admin", {
              method: 'POST',
              body: JSON.stringify({ text: msg }),
            }));
          }
        }
      }
    }
  }
};
