FROM nginx:stable-alpine
COPY deploy/frontend/default.conf /etc/nginx/conf.d/default.conf
COPY public/*.css public/*.js /usr/share/nginx/html/
COPY public/images /usr/share/nginx/html/images
RUN nginx -t
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -q --spider http://127.0.0.1/healthz || exit 1
