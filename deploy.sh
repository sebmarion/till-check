#!/usr/bin/env bash
# Deploy Till Check to Zeus: systemd service + nginx/Tailscale routing + homepage card.
# Run: sudo -n bash /home/seb/projects/bistrot/till-check/deploy.sh
#
# Idempotent: safe to re-run. Backs up nginx config before editing.
set -euo pipefail

PROJ=/home/seb/projects/bistrot/till-check
NGINX_CONF=/etc/nginx/conf.d/zeus-home.conf
NGINX_BACKUP=/etc/nginx/conf.d/zeus-home.conf.bak-till-$(date +%Y%m%dT%H%M%SZ)
TS_DOMAIN=zeus.tailfad2e3.ts.net

echo "== [1/6] install/update systemd service =="
if cmp -s "$PROJ/till-check.service" /etc/systemd/system/till-check.service; then
  echo "   service already current"
else
  install -m 0644 "$PROJ/till-check.service" /etc/systemd/system/till-check.service
  echo "   installed current till-check.service"
fi
systemctl daemon-reload
systemctl enable till-check.service
echo "   enabled; is-enabled: $(systemctl is-enabled till-check.service)"

echo "== [2/6] add nginx /till/ routing =="
if grep -q '/till/' "$NGINX_CONF"; then
  echo "   /till/ routing already present"
else
  cp "$NGINX_CONF" "$NGINX_BACKUP"
  echo "   backed up to $(basename "$NGINX_BACKUP")"
  # Insert after the /accounting/ location (the dynamic-app pattern) in the
  # homepage server block (the one that lists /accounting/).
  awk '
    { print }
    /location \/accounting\/ \{ proxy_pass http:\/\/127\.0\.0\.1:8790\/; \}/ {
      print "    location /till/ { proxy_pass http://127.0.0.1:3401/; }"
      print "    location = /health/till { proxy_pass http://127.0.0.1:3401/health; }"
    }
  ' "$NGINX_CONF" > "${NGINX_CONF}.new"
  mv "${NGINX_CONF}.new" "$NGINX_CONF"
  echo "   added /till/ location + /health/till"
fi

echo "== [3/6] validate + reload nginx =="
nginx -t
systemctl reload nginx
echo "   nginx reloaded"

echo "== [4/6] add homepage card =="
HOME_INDEX=/var/www/zeus-home/index.html
if grep -q '/till' "$HOME_INDEX" 2>/dev/null; then
  echo "   homepage card already present"
else
  cp "$HOME_INDEX" "$HOME_INDEX.bak-till-$(date +%Y%m%dT%H%M%SZ)"
  echo "   backed up homepage index"
  # The homepage uses a cards section; we append a minimal card block.
  # (Exact anchor matched to the existing card structure below.)
  python3 - "$HOME_INDEX" <<'PY'
import sys, re
path = sys.argv[1]
html = open(path).read()
# Find the last existing </a> card anchor or the cards container and append.
# Fallback: append a card right before the closing </main> or </body>.
card = '''
    <a class="card" href="/till/" style="display:block;padding:14px;border:1px solid var(--border);border-radius:12px;text-decoration:none;color:inherit">
      <div style="font-weight:600">Till Check</div>
      <div style="opacity:.75;font-size:13px">Daily bistro cash reconciliation</div>
    </a>
'''
if '<!-- till-card -->' in html:
    print("   card anchor already present; skipping")
else:
    # Insert before </main> if present, else before </body>
    marker = '</main>' if '</main>' in html else '</body>'
    html = html.replace(marker, card + '  <!-- till-card -->\n' + marker, 1)
    open(path, 'w').write(html)
    print("   homepage card added")
PY
fi

echo "== [5/6] restart service + verify locally =="
systemctl restart till-check.service
for _ in $(seq 1 20); do
  if curl -fsS -m 2 http://127.0.0.1:3401/health >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
systemctl is-active --quiet till-check.service
curl -fsS -m 5 http://127.0.0.1:3401/health
echo ""
echo "   service active and healthy"

echo "== [6/6] expose /till through Tailscale Serve + verify publicly =="
# --set-path is additive: it preserves the existing root handler (Comandero)
# while sending only /till and its subpaths to Till Check.
tailscale serve --yes --bg --set-path /till http://127.0.0.1:3401 >/dev/null
curl -fsS -m 10 "https://${TS_DOMAIN}/till/health"
echo ""
echo "   public route active and healthy"

echo ""
echo "Deployment complete."
echo "  Live: https://${TS_DOMAIN}/till/"
