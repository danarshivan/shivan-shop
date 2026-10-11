# Shivan Shop — iPhone App Store preparation

## What exists today

- The project is a responsive Shivan Shop website with shopping, search, cart, orders, profile, customer sign-up/login, and owner tools.
- The owner can manage products, images, sizes, colors, variant stock, ads/banners, appearance, and orders. Owner controls now require a server-authenticated owner session; browser-only owner records do not unlock them.
- Product/banner images are compressed on the device and can be stored in the existing D1 key/value table without a migration. Production bindings and deployment have not been verified or changed.
- This repository does **not** currently contain an iOS project, native app wrapper, App Store Connect record, signed build, store listing assets, or an Apple privacy policy URL.

## App Store blockers to resolve

1. **Create a real iOS app build.** A responsive website alone is not an iPhone App Store binary. Apple says an app should offer value beyond a repackaged website. A thin web-view wrapper risks rejection; add useful iOS integration and test the full app on iPhone before review. [Apple App Review Guideline 4.2](https://developer.apple.com/app-store/review/guidelines/)
2. **Use a Mac with a current Apple-supported Xcode.** This workspace is Windows, so it cannot archive, sign, or upload an iOS build. Apple documents Xcode as the toolchain for iOS builds and uploads. [Xcode requirements](https://developer.apple.com/xcode/system-requirements/) · [Upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)
3. **Apple Developer Program membership.** App Store distribution currently requires the paid Apple Developer Program, listed at USD $99 per year (local pricing or eligible fee waivers may differ). Apple Account, identity verification, and App Store Connect access are also required. [Apple Developer Program](https://developer.apple.com/programs/)
4. **Account deletion.** The app supports customer account creation, but there is no in-app account deletion flow. Apple requires people to be able to initiate deletion in the app, with associated personal data removed except information the business is legally required to retain. The order-retention/deletion behavior needs a deliberate policy before implementing this destructive action. [Apple account-deletion guidance](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion)
5. **Privacy and support pages.** The current sign-up terms/privacy text is not linked to public policy pages. Apple requires a privacy-policy URL and accurate App Privacy disclosures, including third-party processing. Publish a reviewed policy and support contact before submission. Relevant project data includes account names and phone/email identifiers, password hashes, sessions, carts/favorites/settings/support, order/shipping details, FIB payment references/status, and owner-uploaded catalog images. Verify the final disclosures against production Cloudflare/FIB settings. [Apple App Privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/)
6. **Account recovery and sign-in options.** Cloud password reset is not wired to a verified email/SMS provider. Keep it protected; do not let a user reset by entering only an identifier. The Apple and Google sign-in buttons shown in the website are placeholders and are not connected. Before review, either implement and verify those providers and a recovery path, or remove the inactive options and clearly present supported account methods.
7. **Production readiness for review.** Verify the production D1 ID, `DB`, `SYNC_HUB`, `FIB_ENV`, owner session, image storage, and live payment credentials. Provide App Review with a working demo account and keep the backend enabled during review. Capture genuine iPhone screenshots after the final app build; no App Store screenshots are prepared here.

## Payment note

Shivan Shop sells clothing, which is a physical product delivered outside the app. Apple's current guideline says those purchases must use a payment method other than in-app purchase, such as Apple Pay or card entry. The current FIB flow is an external payment method in concept, but its production merchant credentials and checkout must be verified before release. [Apple Guideline 3.1.3(e)](https://developer.apple.com/app-store/review/guidelines/)

## Draft store listing (review before use)

- **Name:** Shivan Shop (availability in App Store Connect must be checked)
- **Primary category:** Shopping
- **Subtitle draft:** Clothing, orders, and store management
- **Description draft:** “Shop clothing from Shivan Shop. Browse collections, search items, choose sizes and colors, review availability, place orders, and manage your account. Authorized store owners can update products, inventory, and promotions across their devices.” Use only after production sync, payment, owner authorization, and the iOS app itself have been verified.
- **Keywords draft:** clothing, fashion, apparel, style, Shivan Shop
- **Still needed:** Bundle ID chosen and registered, SKU, final icon, support URL, privacy-policy URL, reviewed terms, App Privacy answers, age rating, screenshots, review notes, and App Review demo login.

## Ready-to-resume checklist

- [ ] Decide whether order records must be retained for tax, delivery, or other legal reasons, and the account-deletion behavior that follows.
- [ ] Provide the business/support contact and approve privacy/terms wording.
- [ ] Decide which third-party sign-in methods to ship; configure recovery delivery if self-service reset is required.
- [ ] Verify Cloudflare production bindings and current D1 usage; deploy the prepared site/API code only after the existing settings are confirmed.
- [ ] On a Mac, choose a unique bundle ID, create the native iOS project, add meaningful iOS capabilities, and test on simulator and physical iPhone.
- [ ] Enroll in Apple Developer Program, set up App Store Connect, prepare assets and a demo account, then submit for Apple review.

The site changes in this workspace do not mean the Cloudflare production site or an App Store app has been deployed or approved.
