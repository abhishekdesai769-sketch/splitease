#!/usr/bin/env python3
"""
patch_android_signing.py

Injects a release signingConfig into the Capacitor-generated
android/app/build.gradle so that ./gradlew bundleRelease produces
a properly signed AAB.

The keystore credentials are read from environment variables at
Gradle build time (not baked into build.gradle):
  KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD

The keystore file must already exist at: android/app/release.keystore

Run this AFTER `npx cap add android` and BEFORE `./gradlew bundleRelease`.
"""

import sys

GRADLE_PATH = "android/app/build.gradle"

SIGNING_CONFIG_BLOCK = """\
    signingConfigs {
        release {
            storeFile file("release.keystore")
            storePassword System.getenv("KEYSTORE_PASSWORD")
            keyAlias System.getenv("KEY_ALIAS")
            keyPassword System.getenv("KEY_PASSWORD")
        }
    }
"""


def patch():
    try:
        with open(GRADLE_PATH, "r") as f:
            content = f.read()
    except FileNotFoundError:
        print(f"ERROR: {GRADLE_PATH} not found.")
        print("Make sure you have run 'npx cap add android' first.")
        sys.exit(1)

    # Guard: skip if already patched
    if "signingConfigs" in content:
        print("build.gradle already contains signingConfigs — no patch needed.")
        return

    # ── Step 1: Insert signingConfigs block before buildTypes ──────────────────
    if "    buildTypes {" not in content:
        print("ERROR: Could not find '    buildTypes {' in build.gradle")
        print("The Capacitor-generated build.gradle may have changed format.")
        print("\nCurrent content of build.gradle:")
        print(content)
        sys.exit(1)

    content = content.replace(
        "    buildTypes {",
        SIGNING_CONFIG_BLOCK + "    buildTypes {"
    )

    # ── Step 2: Add signingConfig inside the release buildType ─────────────────
    # Capacitor generates one of these two indentation styles:
    patched = False

    # Style A — 12 spaces (Capacitor 6 and 7)
    if "release {\n            minifyEnabled" in content:
        content = content.replace(
            "release {\n            minifyEnabled",
            "release {\n            signingConfig signingConfigs.release\n            minifyEnabled"
        )
        patched = True

    # Style B — 8 spaces (older Capacitor versions)
    elif "release {\n        minifyEnabled" in content:
        content = content.replace(
            "release {\n        minifyEnabled",
            "release {\n        signingConfig signingConfigs.release\n        minifyEnabled"
        )
        patched = True

    # Style C — regex fallback for any indentation (Capacitor 7+)
    else:
        import re
        new_content, n = re.subn(
            r'(release\s*\{)',
            r'\1\n            signingConfig signingConfigs.release',
            content,
            count=1
        )
        if n:
            content = new_content
            patched = True

    if not patched:
        print("WARNING: Could not find release buildType pattern.")
        print("Signing config block was inserted but release buildType may not")
        print("reference it. Build may produce unsigned AAB.")
        print("Check android/app/build.gradle manually.")

    with open(GRADLE_PATH, "w") as f:
        f.write(content)

    print(f"✅ {GRADLE_PATH} patched with release signing config.")


if __name__ == "__main__":
    patch()
