#!/bin/sh
# Rebuild the deploy/ artifact from source, ready to publish to a static host.
#
#   Copies the neutral runtime (code + assets + empty schema-only seed) into
#   deploy/, and PRESERVES deploy/config.local.js — the private hosted config
#   (branding + Supabase keys) you create once and maintain there.
#
# Usage:   ./build-deploy.sh   then:   (cd deploy && vercel --prod)
#
# The real roster is never copied — hosted data comes from the backend after
# login, and deploy/data holds only the empty seed (guarded below).
set -e

mkdir -p deploy/assets deploy/data/hosted
cp index.html boot.js config.js app.js persistence.js styles.css deploy/
cp assets/logo.svg deploy/assets/
cp assets/*-logo.png deploy/assets/ 2>/dev/null || true   # optional branded logo(s)
cp data/hosted/seed.js deploy/data/hosted/

# Safety: deploy/data must contain ONLY the empty seed — never a real roster.
if find deploy/data -type f ! -path '*/hosted/seed.js' | grep -q .; then
  echo "❌ build-deploy: unexpected data file under deploy/data — aborting."
  find deploy/data -type f ! -path '*/hosted/seed.js'
  exit 1
fi

if [ ! -f deploy/config.local.js ]; then
  echo "⚠️  deploy/config.local.js is missing."
  echo "    Create it (hosted branding + Supabase keys) before deploying — see config.local.example.js."
fi

echo "✓ deploy/ rebuilt. Next:  (cd deploy && vercel --prod)"
