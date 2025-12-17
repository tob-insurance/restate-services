# Lambda Layers

AWS Lambda Layer build scripts for native dependencies.

## Available Layers

### Oracle Instant Client

Builds a Lambda Layer containing Oracle Instant Client libraries required for `node-oracledb` thick mode.

```bash
# Build for x86_64 (default)
bun run build:oracle

# Build for ARM64
bun run build:oracle:arm64
```

**Output:** `oracle/output/oracle-instantclient-layer.zip`

**Prerequisites:**
- Docker (for extracting libaio from Amazon Linux)

**Upload to AWS:**

```bash
aws lambda publish-layer-version \
  --layer-name oracle-instantclient \
  --zip-file fileb://oracle/output/oracle-instantclient-layer.zip \
  --compatible-runtimes nodejs18.x nodejs20.x nodejs22.x \
  --compatible-architectures x86_64
```

See [oracle/build-layer.sh](./oracle/build-layer.sh) for details.
