# iOS App Store Setup Guide — Spliiit

## Prerequisites (you need these before starting)
- [x] Apple Developer Account ($99/year) — enrolled at developer.apple.com
- [x] Cloud Mac access (MacinCloud, MacStadium, etc.)
- [x] GitHub account with repo access

## Overview of what's already done (by Claude)
- ✅ Capacitor config (`capacitor.config.ts`)
- ✅ iOS Info.plist with camera/photo permissions
- ✅ Fastlane config (Fastfile, Appfile, Matchfile)
- ✅ App Store metadata (description, keywords, etc.)
- ✅ GitHub Actions workflow for automated builds
- ✅ App bundle ID: `ca.klarityit.spliiit`

## What YOU need to do (on the cloud Mac)

### Step 1: Create App ID on Apple Developer Portal (5 min)
1. Go to https://developer.apple.com/account/resources/identifiers/list
2. Click `+` → App IDs → App
3. Description: `Spliiit`
4. Bundle ID: **Explicit** → `ca.klarityit.spliiit`
5. Capabilities: leave defaults (no special entitlements needed)
6. Click Register

### Step 2: Create App on App Store Connect (5 min)
1. Go to https://appstoreconnect.apple.com
2. My Apps → `+` → New App
3. Platform: iOS
4. Name: `Spliiit - Split Expenses`
5. Primary Language: English (U.S.)
6. Bundle ID: `ca.klarityit.spliiit`
7. SKU: `spliiit-ios-1`
8. User Access: Full Access
9. Click Create

### Step 3: Create App Store Connect API Key (5 min)
1. Go to https://appstoreconnect.apple.com/access/integrations/api
2. Click `+` to generate a new key
3. Name: `Spliiit CI`
4. Access: **App Manager** (or Admin)
5. Click Generate
6. **Download the .p8 file** (you can only download it ONCE!)
7. Note the **Key ID** and **Issuer ID** shown on the page
8. Base64-encode the .p8 file:
   ```bash
   base64 -i AuthKey_XXXXXXXXXX.p8 | tr -d '\n'
   ```
9. Save all three values — you'll need them for GitHub Secrets

### Step 4: Create Certificates Repo (2 min)
1. Go to https://github.com/new
2. Create a **private** repo named `spliiit-certificates`
3. Leave it empty (no README, no .gitignore)

### Step 5: Set Up Code Signing with Match (10 min, on cloud Mac)
1. Open Terminal on the cloud Mac
2. Install Fastlane if not installed:
   ```bash
   gem install fastlane -N
   ```
3. Clone your Spliiit repo:
   ```bash
   git clone https://github.com/abhishekdesai769-sketch/splitease.git
   cd splitease
   ```
4. Run Match to generate certificates:
   ```bash
   MATCH_PASSWORD="your-encryption-password-here" \
   fastlane match appstore \
     --git_url https://github.com/abhishekdesai769-sketch/spliiit-certificates.git
   ```
5. It will ask for your Apple Developer credentials
6. Match will generate certificates and provisioning profiles and push them to the certificates repo

### Step 6: Generate App Icons (5 min)
You need these icon sizes for iOS. Use https://www.appicon.co/ or create them manually:
- 20x20, 29x29, 40x40, 58x58, 60x60, 76x76, 80x80, 87x87, 120x120, 152x152, 167x167, 180x180, 1024x1024

Upload a 1024x1024 PNG of the Spliiit logo to appicon.co → it generates all sizes.

Place the generated `AppIcon.appiconset` folder in:
```
ios/App/App/Assets.xcassets/AppIcon.appiconset/
```

### Step 7: Add GitHub Secrets (5 min)
Go to: https://github.com/abhishekdesai769-sketch/splitease/settings/secrets/actions

Add these secrets:

| Secret Name | Value |
|------------|-------|
| `ASC_KEY_ID` | Key ID from Step 3 (e.g., `ABC123DEFG`) |
| `ASC_ISSUER_ID` | Issuer ID from Step 3 (e.g., `69a6de78-...`) |
| `ASC_KEY_CONTENT` | Base64-encoded .p8 file content from Step 3 |
| `MATCH_GIT_TOKEN` | GitHub Personal Access Token with `repo` scope (create at github.com/settings/tokens) |
| `MATCH_PASSWORD` | The encryption password you used in Step 5 |

### Step 8: Test the Build (5 min)
1. Go to: Actions tab → "iOS Build & TestFlight" → "Run workflow"
2. Leave "Submit to App Store review" as `false`
3. Click "Run workflow"
4. Wait ~10-15 minutes for the build
5. If successful, the app will appear in TestFlight on App Store Connect

### Step 9: Submit to App Store (5 min)
1. Go to App Store Connect → Your App → App Store tab
2. Fill in screenshots (you'll need iPhone screenshots — take them from Safari or the TestFlight build)
3. Set the age rating, pricing (Free), and availability
4. Run the workflow again with "Submit to App Store review" = `true`
5. Or submit manually from App Store Connect

## After App Store Approval
- The app will be live on the App Store!
- Future updates: just push to master → run the iOS workflow → new TestFlight build
- When ready, trigger the release lane to submit to review

## Troubleshooting
- **Build fails on code signing**: Make sure Match ran successfully and the certificates repo has content
- **"No matching provisioning profiles"**: Re-run `fastlane match appstore` on the cloud Mac
- **App rejected by Apple**: Check the rejection reason in App Store Connect, fix, and resubmit
