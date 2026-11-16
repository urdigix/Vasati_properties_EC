FROM nginx:stable-alpine
COPY deploy/frontend/default.conf /etc/nginx/conf.d/default.conf
COPY public/index.html /usr/share/nginx/html/index.html
COPY public/responsive.css /usr/share/nginx/html/responsive.css
COPY public/images /usr/share/nginx/html/images
COPY public/logo.png /usr/share/nginx/html/logo.png
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -q --spider http://127.0.0.1/healthz || exit 1
