# AWS Lambda Deployment Guide

This guide explains how to deploy the `@restate-tob/finance` Restate service to AWS Lambda with PostgreSQL connectivity.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     AWS Cloud                                │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                Lambda Function                       │    │
│  │  ┌───────────────────────────────────────────────┐  │    │
│  │  │              Function Code                    │  │    │
│  │  │              (app.js + deps)                  │  │    │
│  │  │              @restate-tob/finance             │  │    │
│  │  └───────────────────────────────────────────────┘  │    │
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
              │       PostgreSQL Database      │
              └────────────────────────────────┘
```

## Prerequisites

1. **AWS CLI** configured with appropriate credentials
2. **PostgreSQL database** reachable from the Lambda function

## CI/CD with GitHub Actions

The workflow at `.github/workflows/deploy-finance-lambda.yml` automates deployment.

### Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `AWS_DEPLOY_ROLE_ARN` | IAM role ARN for deploying Lambda (with OIDC trust) |
| `AWS_INVOKE_ROLE_ARN` | IAM role ARN for Restate to invoke Lambda |
| `RESTATE_ADMIN_URL` | Restate admin URL (from Dashboard) |
| `RESTATE_BASIC_AUTH` | Restate HTTP Basic Auth credentials (format: `user:password`) |

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

## Manual Deployment

### Step 1: Build the Lambda Function

```bash
cd apps/finance

# Install dependencies
bun install

# Bundle for Lambda
bun run bundle:lambda
```

This creates `dist-lambda/lambda.zip` containing the bundled function code.

### Step 2: Create the Lambda Function

#### 2.1 Create IAM Role

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

# If using VPC for PostgreSQL access
aws iam attach-role-policy \
  --role-name finance-closing-lambda-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole
```

#### 2.2 Create Lambda Function

```bash
aws lambda create-function \
  --function-name finance-closing \
  --runtime nodejs20.x \
  --handler app.handler \
  --role arn:aws:iam::<ACCOUNT_ID>:role/finance-closing-lambda-role \
  --zip-file fileb://dist-lambda/lambda.zip \
  --timeout 900 \
  --memory-size 1024 \
  --environment "Variables={POSTGRES_URL=postgresql://user:password@host:5432/database?schema=financial_report}"
```

**Important settings:**
- `timeout`: 900 seconds (15 minutes max for Lambda)
- `memory-size`: 1024 MB recommended for database-backed workflows
- No database client Lambda layer is required; the service is PostgreSQL-only.

#### 2.3 Configure Function URL (Optional)

If not using API Gateway:

```bash
aws lambda create-function-url-config \
  --function-name finance-closing \
  --auth-type NONE
```

### Step 3: Register with Restate

#### Option A: Self-hosted Restate Server

```bash
restate deployments register <LAMBDA_FUNCTION_URL>
```

#### Option B: Restate Cloud

```bash
# Set environment variables
export RESTATE_ADMIN_URL=<your-restate-admin-url>
export RESTATE_BASIC_AUTH=<user:password>

# Create IAM role for Restate to invoke Lambda
# Get the role ARN from Restate Dashboard → Developers → Security → AWS Lambda

# Register the deployment
npx @restatedev/restate deployment register \
  <LAMBDA_ARN> \
  --assume-role-arn <RESTATE_INVOKE_ROLE_ARN>
```

### Step 4: Update Deployments

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

The Lambda function uses PostgreSQL only. Configure the database with the application connection string:

| Variable | Description |
|----------|-------------|
| `POSTGRES_URL` | PostgreSQL connection string, including schema when required |

Example:

```env
POSTGRES_URL=postgresql://postgres:your_password@localhost:5432/finance?schema=financial_report
```

## Important Considerations

### Lambda Timeout Limitation

AWS Lambda has a **maximum timeout of 15 minutes**. Some finance closing operations may take longer than a single Lambda invocation.

**Solution**: Restate handles this through durable execution. The workflow will:
1. Start PostgreSQL-backed work inside `ctx.run()` steps
2. Lambda times out if the invocation exceeds the configured limit
3. Restate retries from the latest checkpoint
4. Eventually completes across multiple Lambda invocations

This works because Restate's `ctx.run()` checkpoints durable progress.

### Cold Start Performance

First invocation may be slow due to loading the function bundle and establishing database connections.

**Mitigations:**
- Increase memory to 1024MB+ for faster CPU allocation
- Use provisioned concurrency for predictable latency
- Keep functions warm with scheduled pings

### VPC Configuration

If your PostgreSQL database is in a private VPC:

1. Configure Lambda VPC settings
2. Add security group rules allowing outbound access to PostgreSQL
3. Ensure NAT Gateway for external access if needed

## File Structure

```
apps/finance/
├── src/
│   ├── app.lambda.ts      # Lambda handler entry point
│   ├── app.local.ts       # Local development entry point
│   ├── infrastructure/    # PostgreSQL database client
│   ├── modules/           # Business logic modules
│   └── workflows/
│       └── daily-closing.ts
├── dist-lambda/           # Lambda bundle output
│   └── lambda.zip
└── package.json
```

## Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Local development with hot reload |
| `bun run bundle:lambda` | Bundle for Lambda deployment |

## Troubleshooting

### PostgreSQL connection timeout

1. Check VPC configuration
2. Verify security groups allow outbound access to PostgreSQL
3. Confirm `POSTGRES_URL` points to a reachable database endpoint

### Out of memory

Increase Lambda memory allocation if the bundled service needs more runtime memory.

```bash
aws lambda update-function-configuration \
  --function-name finance-closing \
  --memory-size 2048
```
