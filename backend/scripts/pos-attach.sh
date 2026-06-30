#!/usr/bin/env bash
# Run once to attach Iron Booking to ATLAS POS and import the table directory.
# Fill in the two TODO values before running.

RESTAURANT_ID="f0d59744-e974-46d8-a445-064906eb2417"
POS_API_BASE="https://atlas-api-zglv.onrender.com"
HOSPITALITY_API_BASE="https://iron-booking.onrender.com"
POS_SECRET="atlas-dev-secret-2026"
HOSPITALITY_SECRET="Zp74zxi6wNWVuaf01L9PYTko3hyQJjUDRmnsqerE5MG8S2ab"

npx tsx scripts/setup-pos-attach.ts \
  --restaurant-id       "$RESTAURANT_ID" \
  --pos-api-base        "$POS_API_BASE" \
  --hospitality-api-base "$HOSPITALITY_API_BASE" \
  --hospitality-secret  "$HOSPITALITY_SECRET" \
  --pos-secret          "$POS_SECRET"
