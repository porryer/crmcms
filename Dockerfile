# 基础镜像固定到补丁版本，保证同一份代码在不同时间构建结果一致；升级 Node 时修改此行
FROM node:22.23.5-bookworm-slim
ARG VERSION=dev
LABEL org.opencontainers.image.title="NovaCRM" \
      org.opencontainers.image.source="https://github.com/porryer/crmcms" \
      org.opencontainers.image.version="${VERSION}"
ENV NODE_ENV=production PORT=3100 DATA_DIR=/app/data TZ=Asia/Shanghai ACCESS_LOG=1
WORKDIR /app
COPY package.json server.js ./
COPY src/ ./src/
COPY lib/ ./lib/
COPY public/ ./public/
COPY scripts/ ./scripts/
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server.js"]
