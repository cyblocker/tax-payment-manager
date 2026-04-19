# Tax Payment Manager

A blazing-fast, serverless application for automating the tracking and data-extraction of tax documents. Built entirely on the Cloudflare ecosystem (Pages + Workers + D1 + R2) and powered by the Google Gemini AI Model.

## Architecture Highlights
- **Premium Frontend:** Modern React + Vite SPA using TailwindCSS and client-side PDF splitting.
- **Serverless Backend:** TypeScript API built on Hono, capable of near-instant boot times globally on Cloudflare Workers.
- **AI Engine:** Integrated `gemini-2.5-flash` natively streams extracted receipts and JSON schema structures into Cloudflare D1.
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
1. Commit and push this repository to GitHub.
2. In the **Cloudflare Dashboard**, navigate to **Workers & Pages**.
3. **For the Frontend:** Click `Create Application` -> `Pages` -> `Connect to Git`. Select your repository, configure the build directory to `/frontend/`, the build command to `npm run build`, and the output directory to `dist`. Deploy.
4. **For the Backend API:** Navigate to `Create Application` -> `Workers` -> Connect to GitHub. Select `/backend/` as the root. Cloudflare will automatically read your `wrangler.toml`.
5. Apply the database schemas from your computer using:
   ```bash
   npm run db:migrate --remote
   ``` 

### 3. Environment Secrets configuration
You must supply the backend with its required secrets via the Cloudflare Dashboard (Workers -> Your Backend API -> Settings -> Environment Variables):
- `GEMINI_API_KEY`: Your Google GenAI Token.
- `TELEGRAM_BOT_TOKEN`: Your API token generated from @BotFather.
- `TELEGRAM_ALLOWED_USER_ID`: The numeric Chat ID of the authorized admin user.

---

## Creating Your Own Telegram Assistant

Because Cloudflare Worker URLs are generally unauthenticated, this platform separates the *actual bot webhook router* from the core Tax Backend Logic.

If you are a developer looking to fork this setup, you have two options for your Telegram Bot:

**Option A: Route directly to this Application (Insecure)**
You can point Telegram's setWebhook directly to the backend:
`https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-backend.workers.dev/internal/bot-handler`
*(Not recommended, as anyone can spoof Telegram requests if they discover your worker URL, although the codebase natively drops any chat IDs that do not match `TELEGRAM_ALLOWED_USER_ID` as a final precaution).*

**Option B: Build a Private Router Cloudflare Worker (Recommended)**
Build a tiny 20-line Cloudflare worker that natively intercepts requests from Telegram, verifies the payload comes from Telegram natively, and `POST`s the `req.json()` securely underneath the hood to your Tax Backend. This allows you to expand your Bot Router to handle entirely different services simultaneously!
