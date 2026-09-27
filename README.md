# Digital Kids Foundation — Coolify + Resend

## Coolify
Build strategy: Dockerfile
Exposed port: 3000

Environment variables (set in Coolify; do not commit secrets):
```
RESEND_API_KEY=re_xxxxxxxxx
MAIL_FROM=website@digitalkidsfoundation.org
MAIL_TO=help@digitalkidsfoundation.org
```

The sending domain must be verified in Resend.

Endpoints: `POST /api/submit`, `GET /health`.
