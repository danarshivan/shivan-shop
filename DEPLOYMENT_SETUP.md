# Shivan Shop deployment notes

## Current state

The local `wrangler.toml` declares a Pages project named `shivan-store`, a D1 database binding named `DB`, the database `shivan-shop-db`, a Durable Object binding named `SYNC_HUB`, and `FIB_ENV = "stage"`. It also still declares the legacy `MEDIA` R2 binding so old image URLs can remain readable. These local entries are not proof that the corresponding production settings are currently correct; production could not be inspected because Wrangler has no usable local Cloudflare credential in this workspace.

Do not run the legacy `scripts/deploy-cloudflare.ps1` for this image change. It can create Cloudflare resources, apply migrations, change owner setup, and provision R2. None of those actions is needed for D1-backed image storage.

## Shared data and image storage

Signed-in devices save owner and customer changes to D1. The Durable Object sends data-free realtime notifications; each device then downloads the latest state with its own session. A 15-second refresh is the recovery path if a device temporarily misses a notification.

New product and banner images are cropped and compressed on the device, then saved as individual `media:` rows in the existing D1 `shop_state` table. Product and banner records contain only `/api/media/...` URLs. Image bytes are not kept only in browser storage and are filtered out of bootstrap and sync payloads. No table/schema migration is required.

The API caps each product/banner image at 1,300,000 bytes before base64 encoding, leaving room below D1's documented 2,000,000-byte row limit. The D1 free plan currently documents a 500 MB database cap and 5 GB total storage per account; the current production database usage was not available to verify. Old R2 image URLs remain readable only if the existing `MEDIA` binding and bucket still work. New image uploads do not write to R2 or require creating a bucket. No automatic image cleanup is enabled, so deleting a product does not risk deleting an image still used elsewhere; unused images may consume the D1 quota over time.

Existing FIB receipt image URLs remain private to the owner. New receipt image records also use D1. The `MEDIA` fallback exists only to preserve access to older R2-backed media.

## Deploy the image-storage fix without migrations

Deployment has not been run. Before publishing, verify the Cloudflare Pages production configuration and compare it with the local `wrangler.toml`:

1. Confirm the account and `shivan-store` Pages project.
2. Confirm the production D1 database ID and `DB` binding match `wrangler.toml` and the production database contains the existing `shop_state` table from the prior application. Do not apply migrations for this change.
3. Confirm the `SYNC_HUB` binding and `FIB_ENV` production value. Preserve any existing production settings.
4. If existing catalog images use R2, confirm whether the current production `MEDIA` binding must remain to keep those old URLs working. Do not create a new bucket or enable a paid service. The new D1 image route does not require `MEDIA`.
5. Once those values are confirmed, build and deploy the Pages site and its `functions` directory from this project folder:

   ```powershell
   $wrangler = ".\.wrangler-bootstrap\install\node_modules\.bin\wrangler.cmd"
   $productionBranch = Read-Host "Enter the production branch you verified in Cloudflare"
   & "C:\Users\LORD TECHNOLOGY\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\build.mjs
   & $wrangler pages deploy .\dist --project-name shivan-store --branch $productionBranch --config .\wrangler.toml
   ```

   `$wrangler` should point to the Wrangler executable already configured for your account. Do not paste API tokens or passwords into chat. If the deployment tool reports any binding difference, stop and compare with the saved production configuration before retrying.
6. After deployment, sign in with the same owner account on the iPhone and laptop. Add one small product/banner image, save it, open the other device, and refresh. Check that its image URL starts with `/api/media/shop/` and loads after signing out and back in.

This deployment only publishes the local code and Pages Function. It does not create resources, change owner setup, or run a migration. The Cloudflare account and production bindings still need to be verified before this is safe to run.

## Real FIB payments

Checkout uses FIB Online Payments: the server computes the cart total in IQD, creates a payment, opens the HTTPS link returned by FIB, and verifies the payment status and exact amount before accepting an order. New FIB orders require a confirmed `PAID` result.

FIB must issue merchant credentials for the chosen environment. Use `stage` only for FIB's sandbox; use `prod` only after FIB issues production credentials and approves the merchant for live payments. Keep credentials in Cloudflare's encrypted Pages secrets, never in the browser or repository. FIB checkout remains unavailable until valid credentials are configured.

## Official references

- [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [Cloudflare Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/)
- [Cloudflare Pages Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/pages/)
- [Cloudflare Durable Object WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [FIB Web Payments](https://fib.iq/integrations/web-payments/)
