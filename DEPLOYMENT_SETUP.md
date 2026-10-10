# Permanent Cloudflare deployment

This project is prepared for a permanent Cloudflare Pages deployment with a shared D1 database, an R2 bucket for uploaded media, and a Durable Object WebSocket hub for live cross-device sync. Cloudflare Pages uses a stable `pages.dev` address; after deployment, the intended address is `https://shivan-shop-storefront.pages.dev`.

## What sync does

Signed-in devices write their changes to D1. The server sends a data-free WebSocket notification to the other connected devices, which immediately fetch the latest data using their own signed-in session. A 15-second refresh remains as a recovery path if a device temporarily loses its WebSocket. Use the same owner account on both devices to edit the shared store.

## Real FIB payments

Checkout is wired to FIB Online Payments: the server computes the cart total in IQD, creates a payment with FIB, opens the HTTPS app/payment link returned by FIB, and checks FIB's status and exact amount before accepting the order. New FIB orders require a confirmed `PAID` gateway result; the mock simulation and receipt-upload fallback are removed.

FIB must issue merchant credentials for the chosen environment. Use `stage` only for FIB's sandbox; choose `prod` only after FIB has issued production credentials and approved the merchant for live payments. Cloudflare receives these as encrypted Pages secrets; the browser and repository never contain the secret.

## Deploy from this Windows workspace

1. For real customer payments, request FIB production access and credentials. You can still deploy the storefront and live sync before FIB issues them; choose the no-FIB option in the deployment prompt and FIB checkout will stay unavailable until production credentials are configured.
2. Authorize Wrangler with Cloudflare's official OAuth flow from this project folder. Set `$env:XDG_CONFIG_HOME = Join-Path (Get-Location) '.wrangler-bootstrap\config'`, then run `.wrangler-bootstrap\install\node_modules\.bin\wrangler.cmd login --use-keyring --device --browser=false`. Review Cloudflare's authorization screen before approving. Wrangler's OAuth grants broad account access (it does not offer granular permission scoping); `--use-keyring` stores the credential encrypted using Windows Credential Manager. The deployment helper uses the same workspace config path automatically.
3. From this project folder, run `scripts\deploy-cloudflare.ps1` in PowerShell. It verifies that Wrangler is signed into the configured account and asks whether to configure FIB now. If you choose `no`, it publishes the storefront and real-time sync while leaving FIB checkout unavailable; if you choose `yes`, it prompts securely for merchant credentials and stores them as encrypted Pages secrets. After you confirm with `DEPLOY`, it provisions Pages, D1, R2, and the WebSocket Worker, applies database migrations, and deploys the storefront. Do not enter credentials into chat.
4. The deployment prints a one-time owner setup code. Open the published site, create the owner account with that code and a new password, then sign in to that same account on the laptop and phone. Delete the `OWNER_SETUP_TOKEN` Pages secret after the owner account is created.

The deployment script is designed for the initial provisioning run. `wrangler.toml` currently contains `PLACEHOLDER_DATABASE_ID`; the script replaces it with the new D1 database ID. `wrangler whoami` currently reports that Wrangler is not authenticated, so no Cloudflare project or production URL has been created from this workspace yet. The real payment and sync code is prepared, but no payment can run until the deployment and FIB configuration are completed.

Keep FIB credentials in the local secure prompts or Cloudflare's secret settings. Do not paste them into this chat or commit them to the project. To avoid Wrangler OAuth's broad account scope, use a narrowly scoped Cloudflare API token instead; the deploy script can be adjusted to accept one if you prefer that route. Do not rerun the initial provisioning script only to add FIB credentials; configure the encrypted Pages secrets and production environment after FIB approves the merchant account.

## Official docs

- [FIB Web Payments](https://fib.iq/integrations/web-payments/)
- [Cloudflare Pages bindings and secrets](https://developers.cloudflare.com/pages/functions/bindings/)
- [Cloudflare Pages Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/pages/)
- [Wrangler OAuth login and keyring storage](https://developers.cloudflare.com/workers/wrangler/commands/general/)
- [Cloudflare Durable Object WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Cloudflare Workers authorization](https://developers.cloudflare.com/workers/authorization/)
