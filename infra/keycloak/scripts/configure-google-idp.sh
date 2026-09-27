#!/usr/bin/env bash
# Registers Google as an identity provider on the einvoice realm via Keycloak's Admin REST API.
#
# Not run automatically, and deliberately not part of infra/keycloak/realm-export/ — Keycloak's
# realm-import JSON has no environment-variable substitution, so a real Google client secret would
# either have to be committed to the repo in plain text or the realm would import broken IdP config
# on every fresh boot. This script is the one-time, idempotent alternative: run it whenever you
# have real Google OAuth credentials, against a realm that's already up.
#
# Prerequisites (see docs/google-identity-provider-setup.md for the full walkthrough):
#   1. A Google Cloud project with an OAuth consent screen configured.
#   2. An OAuth 2.0 Client ID (type "Web application") with this authorized redirect URI:
#        <KEYCLOAK_PUBLIC_BASE_URL>/realms/<realm>/broker/google/endpoint
#      which for local dev is:
#        http://localhost:8080/realms/einvoice/broker/google/endpoint
#
# Usage:
#   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... ./infra/keycloak/scripts/configure-google-idp.sh

set -euo pipefail

: "${GOOGLE_CLIENT_ID:?Set GOOGLE_CLIENT_ID (from Google Cloud Console) before running this script.}"
: "${GOOGLE_CLIENT_SECRET:?Set GOOGLE_CLIENT_SECRET (from Google Cloud Console) before running this script.}"

KEYCLOAK_URL="${KEYCLOAK_BASE_URL:-http://localhost:8080}"
REALM="${KEYCLOAK_REALM:-einvoice}"
ADMIN_USER="${KEYCLOAK_ADMIN_USER:-admin}"
ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-dev-keycloak-admin-password}"
ALIAS="google"

echo "Fetching an admin token from ${KEYCLOAK_URL}..."
ADMIN_TOKEN=$(curl -sf -X POST "${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token" \
  -d client_id=admin-cli \
  -d grant_type=password \
  -d username="${ADMIN_USER}" \
  -d password="${ADMIN_PASSWORD}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

PAYLOAD=$(cat <<EOF
{
  "alias": "${ALIAS}",
  "providerId": "google",
  "enabled": true,
  "trustEmail": true,
  "storeToken": false,
  "config": {
    "clientId": "${GOOGLE_CLIENT_ID}",
    "clientSecret": "${GOOGLE_CLIENT_SECRET}",
    "defaultScope": "openid email profile",
    "syncMode": "IMPORT"
  }
}
EOF
)

EXISTING_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  "${KEYCLOAK_URL}/admin/realms/${REALM}/identity-provider/instances/${ALIAS}")

if [ "${EXISTING_STATUS}" = "200" ]; then
  echo "Identity provider \"${ALIAS}\" already exists on realm \"${REALM}\" — updating it."
  curl -sf -X PUT "${KEYCLOAK_URL}/admin/realms/${REALM}/identity-provider/instances/${ALIAS}" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "${PAYLOAD}"
else
  echo "Registering Google as a new identity provider on realm \"${REALM}\"..."
  curl -sf -X POST "${KEYCLOAK_URL}/admin/realms/${REALM}/identity-provider/instances" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "${PAYLOAD}"
fi

echo "Done. \"Login with Google\" now appears on the realm's hosted login page (GET /api/v1/auth/login/redirect on bff)."
echo "Redirect URI Google's OAuth client must have whitelisted: ${KEYCLOAK_URL}/realms/${REALM}/broker/google/endpoint"
