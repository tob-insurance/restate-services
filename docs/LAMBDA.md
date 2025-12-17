# AWS Lambda Deployment Guide

This guide explains how to deploy the `@finance/closing` Restate service to AWS Lambda with Oracle Instant Client support.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     AWS Cloud                                │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                Lambda Function                       │    │
│  │  ┌─────────────────┐  ┌───────────────────────────┐ │    │
│  │  │  Lambda Layer   │  │    Function Code          │ │    │
│  │  │  (Oracle        │  │    (app.js + deps)        │ │    │
│  │  │   Instant       │  │                           │ │    │
│  │  │   Client)       │  │    @finance/closing       │ │    │
│  │  └─────────────────┘  └───────────────────────────┘ │    │
│  └─────────────────────────────────────────────────────┘    │
│                              │                               │
│                              ▼                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Restate Cloud/Server                    │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                               │
                               ▼
              ┌────────────────────────────────┐
              │         Oracle Database        │
              │       (Low version, needs      │
              │         thick mode)            │
              └────────────────────────────────┘
```

## Prerequisites

1. **AWS CLI** configured with appropriate credentials
2. **Docker** (for building the Lambda Layer)

## CI/CD with GitHub Actions

The workflow at `.github/workflows/deploy-finance-lambda.yml` automates deployment.

### Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `AWS_DEPLOY_ROLE_ARN` | IAM role ARN for deploying Lambda (with OIDC trust) |
| `AWS_INVOKE_ROLE_ARN` | IAM role ARN for Restate to invoke Lambda |
| `RESTATE_ADMIN_URL` | Restate admin URL (from Dashboard) |
| `RESTATE_AUTH_TOKEN` | Restate API key with Admin role |

### Setup AWS OIDC for GitHub Actions

```bash
# Create OIDC provider (one-time)
aws iam create-open-id-connect-provider \
    --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com
```

### Deploy Role Trust Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:tob-insurance/restate-services:*"
        }
      }
    }
  ]
}
```

### Workflow Triggers

- **Auto deploy**: Push to `main` with changes in `apps/finance/`
- **Manual deploy**: Use "Run workflow" button in GitHub Actions
- **Build layer**: Manual trigger only (workflow_dispatch)

## Manual Deployment

### Step 1: Build the Oracle Instant Client Lambda Layer

### 1.1 Download Oracle Instant Client

Download **Oracle Instant Client Basic Lite** for Linux x86-64 from:
https://www.oracle.com/database/technologies/instant-client/linux-x86-64-downloads.html

Choose version 19.x for best compatibility. Download the **Basic Light Package (ZIP)**.

### 1.2 Build the Layer

```bash
# From repository root
bun run --filter @restate-tob/lambda-layers build:oracle

# Or directly
cd packages/lambda-layers
bun run build:oracle
```

### 1.3 Publish the Layer to AWS

```bash
aws lambda publish-layer-version \
  --layer-name oracle-instantclient \
  --zip-file fileb://packages/lambda-layers/oracle/output/oracle-instantclient-layer.zip \
  --compatible-runtimes nodejs18.x nodejs20.x nodejs22.x \
  --compatible-architectures x86_64
```

Save the `LayerVersionArn` from the output.

## Step 2: Build the Lambda Function

```bash
cd apps/finance

# Install dependencies
bun install

# Bundle for Lambda
bun run bundle:lambda
```

This creates `dist-lambda/lambda.zip` containing the bundled function code.

## Step 3: Create the Lambda Function

### 3.1 Create IAM Role

```bash
# Create trust policy
cat > trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Create role
aws iam create-role \
  --role-name finance-closing-lambda-role \
  --assume-role-policy-document file://trust-policy.json

# Attach basic execution policy
aws iam attach-role-policy \
  --role-name finance-closing-lambda-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# If using VPC (for RDS/Oracle access)
aws iam attach-role-policy \
  --role-name finance-closing-lambda-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole
```

### 3.2 Create Lambda Function

```bash
aws lambda create-function \
  --function-name finance-closing \
  --runtime nodejs20.x \
  --handler app.handler \
  --role arn:aws:iam::<ACCOUNT_ID>:role/finance-closing-lambda-role \
  --zip-file fileb://dist-lambda/lambda.zip \
  --layers <ORACLE_LAYER_ARN> \
  --timeout 900 \
  --memory-size 1024 \
  --environment "Variables={PG_HOST=xxx,PG_PORT=5432,PG_DATABASE=xxx,PG_USER=xxx,PG_PASSWORD=xxx,PG_SCHEMA=xxx,ORACLE_USER=xxx,ORACLE_PASSWORD=xxx,ORACLE_CONNECT_STRING=xxx}"
```

**Important settings:**
- `timeout`: 900 seconds (15 minutes max for Lambda)
- `memory-size`: 1024 MB minimum recommended for Oracle connections
- `layers`: Attach the Oracle Instant Client layer ARN

### 3.3 Configure Function URL (Optional)

If not using API Gateway:

```bash
aws lambda create-function-url-config \
  --function-name finance-closing \
  --auth-type NONE
```

## Step 4: Register with Restate

### Option A: Self-hosted Restate Server

```bash
restate deployments register <LAMBDA_FUNCTION_URL>
```

### Option B: Restate Cloud

```bash
# Set environment variables
export RESTATE_ADMIN_URL=<your-restate-admin-url>
export RESTATE_AUTH_TOKEN=<your-auth-token>

# Create IAM role for Restate to invoke Lambda
# Get the role ARN from Restate Dashboard → Developers → Security → AWS Lambda

# Register the deployment
npx @restatedev/restate deployment register \
  <LAMBDA_ARN> \
  --assume-role-arn <RESTATE_INVOKE_ROLE_ARN>
```

## Step 5: Update Deployments

For subsequent deployments:

```bash
# Bundle new code
bun run bundle:lambda

# Update function
aws lambda update-function-code \
  --function-name finance-closing \
  --zip-file fileb://dist-lambda/lambda.zip
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PG_HOST` | PostgreSQL host |
| `PG_PORT` | PostgreSQL port |
| `PG_DATABASE` | PostgreSQL database name |
| `PG_USER` | PostgreSQL username |
| `PG_PASSWORD` | PostgreSQL password |
| `PG_SCHEMA` | PostgreSQL schema |
| `ORACLE_USER` | Oracle username |
| `ORACLE_PASSWORD` | Oracle password |
| `ORACLE_CONNECT_STRING` | Oracle connection string (e.g., `host:port/service`) |

## Important Considerations

### Lambda Timeout Limitation

AWS Lambda has a **maximum timeout of 15 minutes**. Your Genius Oracle closing procedure can take up to 6 hours.

**Solution**: Restate handles this through durable execution. The workflow will:
1. Start the Oracle procedure
2. Lambda times out (Restate marks it as suspended)
3. Restate retries, and the procedure continues from checkpoint
4. Eventually completes across multiple Lambda invocations

This works because Restate's `ctx.run()` is idempotent and checkpoints progress.

### Cold Start Performance

First invocation may be slow (5-10 seconds) due to:
- Loading Oracle Instant Client libraries
- Establishing database connections

**Mitigations:**
- Increase memory to 1024MB+ (faster CPU allocation)
- Use provisioned concurrency for predictable latency
- Keep functions warm with scheduled pings

### VPC Configuration

If your Oracle database is in a private VPC:

1. Configure Lambda VPC settings
2. Add security group allowing outbound to Oracle (port 1521)
3. Ensure NAT Gateway for external access (if needed)

## File Structure

```
apps/finance/
├── src/
│   ├── app.lambda.ts      # Lambda handler entry point
│   ├── app.local.ts       # Local development entry point
│   ├── infrastructure/    # Database clients
│   ├── modules/           # Business logic modules
│   └── workflows/
│       └── daily-closing.ts
├── dist-lambda/           # Lambda bundle output
│   └── lambda.zip
└── package.json

packages/lambda-layers/
├── oracle/
│   ├── build-layer.sh     # Layer build script
│   └── output/            # Built layer zip
└── package.json
```

## Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Local development with hot reload |
| `bun run bundle:lambda` | Bundle for Lambda deployment |
| `bun run build:layer` | Build Oracle Instant Client layer |

## Troubleshooting

### DPI-1047: Cannot locate Oracle Client library

The Lambda Layer is not attached or libraries are missing.

1. Verify layer is attached to function
2. Check layer contains `lib/*.so*` files
3. Ensure `libaio.so.1` is in the layer

### Connection timeout to Oracle

1. Check VPC configuration
2. Verify security groups allow outbound port 1521
3. Confirm Oracle connection string is correct

### Out of memory

Increase Lambda memory allocation. Oracle connections require significant memory.

```bash
aws lambda update-function-configuration \
  --function-name finance-closing \
  --memory-size 2048
```
