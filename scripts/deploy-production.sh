#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if [[ ! -f .env ]]; then
  echo "Missing .env. Copy .env.example and set deployment secrets first." >&2
  exit 1
fi

set -a
source ./.env
set +a

for required in KEY URL ADMIN_API_KEY UPSTREAM_KEY_ENCRYPTION_SECRET; do
  if [[ -z "${!required:-}" ]]; then
    echo "Missing required .env value: $required" >&2
    exit 1
  fi
done

run_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

if ! command -v htpasswd >/dev/null 2>&1; then
  echo "htpasswd is required to protect the admin console. Install apache2-utils first." >&2
  exit 1
fi

docker compose up -d --build
run_root install -d -m 0755 /var/www/certbot
run_root install -m 0644 deploy/nginx/adaptive-chat.http.conf /etc/nginx/conf.d/adaptive-chat.conf
run_root htpasswd -Bbc /etc/nginx/.adaptive-chat-admin.htpasswd admin "$ADMIN_API_KEY"
run_root nginx -t
run_root systemctl reload nginx

certbot_contact_args=(--agree-tos --non-interactive --keep-until-expiring)
if [[ -n "${CERTBOT_EMAIL:-}" ]]; then
  certbot_contact_args+=(--email "$CERTBOT_EMAIL")
else
  certbot_contact_args+=(--register-unsafely-without-email)
fi

run_root certbot certonly --webroot --webroot-path /var/www/certbot \
  "${certbot_contact_args[@]}" -d console.zengjunjie.com
run_root certbot certonly --webroot --webroot-path /var/www/certbot \
  "${certbot_contact_args[@]}" -d chatapi.zengjunjie.com

run_root install -m 0644 deploy/nginx/adaptive-chat.conf /etc/nginx/conf.d/adaptive-chat.conf
run_root nginx -t
run_root systemctl reload nginx

echo "Deployment complete."
