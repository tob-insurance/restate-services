FROM node:22-bookworm-slim

# Install system dependencies for Oracle Instant Client and general usage
RUN apt-get update && apt-get install -y \
    libaio1 \
    unzip \
    curl \
    dumb-init \
    && rm -rf /var/lib/apt/lists/*

# Download and install Oracle Instant Client based on architecture
WORKDIR /opt/oracle

ARG TARGETARCH
RUN if [ "$TARGETARCH" = "amd64" ]; then \
    ORACLE_CLIENT_URL="https://download.oracle.com/otn_software/linux/instantclient/1928000/instantclient-basic-linux.x64-19.28.0.0.0dbru.zip"; \
    elif [ "$TARGETARCH" = "arm64" ]; then \
    ORACLE_CLIENT_URL="https://download.oracle.com/otn_software/linux/instantclient/1928000/instantclient-basic-linux.arm64-19.28.0.0.0dbru.zip"; \
    else \
    echo "Unsupported architecture: $TARGETARCH" && exit 1; \
    fi && \
    echo "Downloading Oracle Instant Client 19c for $TARGETARCH" && \
    curl -o instantclient.zip $ORACLE_CLIENT_URL && \
    unzip instantclient.zip && \
    rm instantclient.zip && \
    cd instantclient* && \
    echo /opt/oracle/instantclient_19_28 > /etc/ld.so.conf.d/oracle-instantclient.conf && \
    ldconfig

# Set Oracle environment variables
ENV LD_LIBRARY_PATH=/opt/oracle/instantclient_19_28
ENV ORACLE_HOME=/opt/oracle/instantclient_19_28
ENV DPI_DEBUG_LEVEL=64

WORKDIR /usr/src/app

# copy package.json and package-lock.json separately to cache dependencies
COPY package*.json .
RUN npm install

COPY --chown=node:node . .

RUN npm run build

RUN npm prune --production
ENV NODE_ENV=production

EXPOSE 9080
USER node
CMD ["dumb-init", "node", "./dist/app.local.js"]
