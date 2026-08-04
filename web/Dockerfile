FROM nginx:1.27-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY web/index.html web/styles.css web/app.js web/sw.js web/manifest.json /usr/share/nginx/html/
COPY web/js /usr/share/nginx/html/js
COPY web/vendor /usr/share/nginx/html/vendor
EXPOSE 80
