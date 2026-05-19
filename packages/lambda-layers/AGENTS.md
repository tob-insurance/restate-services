# Lambda Layers

AWS Lambda Layer build scripts for native dependencies.

## Build

```bash
bun run build:oracle        # Build for x86_64 (default)
bun run build:oracle:arm64  # Build for ARM64
```

**Prerequisites:** Docker (for extracting libaio from Amazon Linux)

**Output:** `oracle/output/oracle-instantclient-layer.zip`

## Deploy

```bash
aws lambda publish-layer-version \
  --layer-name oracle-instantclient \
  --zip-file fileb://oracle/output/oracle-instantclient-layer.zip \
  --compatible-runtimes nodejs18.x nodejs20.x nodejs22.x \
  --compatible-architectures x86_64
```
