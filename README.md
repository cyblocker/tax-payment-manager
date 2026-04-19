# Tax Payment Manager

A blazing-fast, serverless application for automating the tracking and data-extraction of tax documents. Built entirely on the Cloudflare ecosystem (Pages + Workers + D1 + R2) and powered by the Google Gemini AI Model.

## Architecture Highlights
- **Premium Frontend:** Modern React + Vite SPA using TailwindCSS and client-side PDF splitting.
- **Serverless Backend:** TypeScript API built on Hono, capable of near-instant boot times globally on Cloudflare Workers.
- **AI Engine:** Integrated `gemini-3.1-flash-lite-preview` natively streams extracted receipts and JSON schema structures into Cloudflare D1.
- **Telegram Native:** Plugs perfectly into the Telegram Ecosystem via a `/internal/bot-handler` webhook endpoint for conversational scheduling and uploads.

## How to Deploy to Cloudflare

Because this is a serverless application utilizing Cloudflare's specific database/storage abstractions, initial setup requires utilizing the `wrangler` CLI to build your resources.

### 1. Initialize Resources locally
Even if deploying via GitHub, you need to create the D1 Database and R2 bucket in your personal Cloudflare account:
```bash
# Create the D1 Database
npx wrangler d1 create tax-payment-manager-db

# Create the R2 Storage Bucket
npx wrangler r2 bucket create tax-manager-storage
```
*Note down the `database_id` given by the D1 creation command and place it into `backend/wrangler.toml`.*

### 2. GitHub Integration (Frontend & Backend)
1. Fork this repository to GitHub.
2. In the **Cloudflare Dashboard**, navigate to **Workers & Pages**.
3. **For the Frontend:** Click `Create Application` -> `Pages` -> `Connect to Git`. Select your repository, configure the build directory to `/frontend/`, the build command to `npm run build`. Deploy.
4. **For the Backend API:** Navigate to `Create Application` -> `Workers` -> Connect to GitHub. Select `/backend/` as the root. Cloudflare will automatically read your `wrangler.toml`.
5. Apply the database schemas from your computer using (Please note, build will fail if the db is not initialized.):
   ```bash
   npm run db:migrate:remote
   ``` 

### 3. Environment Secrets configuration
To keep your API keys perfectly safe, they are NOT checked into `wrangler.toml`. Set them securely using Cloudflare Secrets.

**For Production:** Set the secret using the CLI or Cloudflare Dashboard:
```bash
cd backend
npx wrangler secret put GEMINI_API_KEY
```

**For Local Development:** Create a `.dev.vars` file inside the `backend/` directory:
```env
GEMINI_API_KEY="your-gemini-key"
```

*(Note: Telegram Secrets are strictly handled by the independent Bot Router Service, NOT the master backend!)*

### 4. Environment Variables configuration
You must supply the frontend with its required secrets via the Cloudflare Dashboard (Workers & Pages -> Your Frontend -> Settings -> Environment Variables):
- `VITE_API_BASE`: The URL of your backend API.

---

## Creating Your Own Telegram Assistant

Because Cloudflare Worker URLs are generally unauthenticated, this platform separates the *actual bot webhook router* from the core Tax Backend Logic.

If you are a developer looking to fork this setup, you have two options for your Telegram Bot:

**Option A: Route directly to this Application (Insecure)**
You can point Telegram's setWebhook directly to the backend:
`https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-backend.workers.dev/internal/bot-handler`
*(Not recommended, as anyone can spoof Telegram requests if they discover your worker URL, although the codebase natively drops any chat IDs that do not match `TELEGRAM_ALLOWED_USER_ID` as a final precaution).*

**Option B: Build a Private Router Cloudflare Worker (Recommended)**
To keep your secrets safe and your architecture strictly isolated, this repository includes a `bot` workspace. This tiny Worker natively intercepts requests from Telegram, verifies your `TELEGRAM_ALLOWED_USER_ID`, and securely invokes your backend over Service Bindings! It acts as an outbound gateway to keep `TELEGRAM_BOT_TOKEN` completely decoupled from your core Tax backend API.

#### Deploying the Bot Router:
1. Ensure you have installed the monorepo dependencies:
   ```bash
   npm install
   ```
2. Navigate into the bot workspace and deploy it:
   ```bash
   cd bot
   npx wrangler deploy
   ```
3. Set your `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_USER_ID` explicitly as a Secret for this new router:
   **For Production:**
   ```bash
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_ALLOWED_USER_ID
   ```
   **For Local Development:** Create `bot/.dev.vars`:
   ```env
   TELEGRAM_BOT_TOKEN="your-telegram-token"
   TELEGRAM_ALLOWED_USER_ID="your-telegram-user-id"
   ```
4. Register your webhook via Telegram API pointing to the bot router's domain: `https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=https://<YOUR_BOT_WORKER_DOMAIN>/webhook`
