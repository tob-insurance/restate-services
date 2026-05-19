# Deployment: SOA Finance Lambda

## Prerequisites

| Resource | Description | Creation |
|---|---|---|
| Lambda function | `soa-finance` (Node.js 20, x86_64, 1024MB, 900s timeout) | First time via CLI, updated by CI/CD |
| Oracle Instant Client Layer | `oracle-instantclient` Lambda layer | CI/CD pipeline |
| VPC | Private subnet with S3 Gateway Endpoint | Once manually |
| S3 bucket | Pipeline Parquet + SOA document storage | Once manually |
| Squid proxy | t4g.nano EC2 in public subnet for HTTPS egress | Once manually |
| Restate server | Self-hosted on EC2 (Docker), admin on port 9070 | Once manually |

## CI/CD Pipeline

The GitHub Actions workflow `.github/workflows/deploy-soa-finance-lambda.yml` handles automated deployment:

1. **Triggers**: Manual dispatch (`dev`/`staging`/`prod`) or push to `main` affecting `apps/soa-finance/**`
2. **Secrets**: Fetched from Infisical (OIDC auth) into `.env` file
3. **Build**: `bun run build` + `bun run --filter @restate-tob/soa-finance bundle:lambda`
4. **Deploy**: Uploads zip to Lambda, updates env vars via Node.js JSON builder, adds `ManagedBy=github-actions` tag
5. **Register**: Publishes new Lambda version and registers with Restate admin API

## Required GitHub Secrets

| Secret | Description |
|---|---|
| `INFISICAL_MACHINE_IDENTITY_ID` | Infisical OIDC identity for secret retrieval |
| `AWS_DEPLOY_ROLE_ARN` | IAM role for Lambda deployment (must have Lambda + tag permissions) |
| `AWS_INVOKE_ROLE_ARN` | `GitHubActions-RestateDeploy` role for Restate Lambda invocation |
| `RESTATE_ADMIN_URL` | Restate admin API URL (e.g. `http://host:9070`) |
| `RESTATE_BASIC_AUTH` | Basic auth for Restate admin API (`user:pass`) |

## Required GitHub Variables

| Variable | Description |
|---|---|
| `INFISICAL_PROJECT_SLUG` | Infisical project slug for secrets |

## Manual First-Time Setup

```bash
# 1. Create S3 bucket
aws s3api create-bucket --bucket soa-finance-$(date +%s) --region ap-southeast-3 \
  --create-bucket-configuration LocationConstraint=ap-southeast-3

# 2. Create S3 Gateway Endpoint (associates with private subnet's route table)
aws ec2 create-vpc-endpoint --vpc-id vpc-xxx --service-name com.amazonaws.ap-southeast-3.s3 \
  --route-table-ids rtb-xxx --vpc-endpoint-type Gateway

# 3. Set up Squid proxy (t4g.nano in public subnet)
# Launch t4g.nano with Amazon Linux 2023, install squid, configure as forward proxy
# Allow port 3128 from VPC CIDR in security group
# Disable source/dest check on the ENI

# 4. Create Lambda function (first time only)
aws lambda create-function --function-name soa-finance --runtime nodejs20.x \
  --role arn:aws:iam::xxx:role/Restate-LambdaInvoke \
  --handler app.handler --zip-file fileb://dist-lambda/lambda.zip \
  --memory-size 1024 --timeout 900 \
  --vpc-config '{"SubnetIds":["subnet-xxx"],"SecurityGroupIds":["sg-xxx"]}' \
  --layers arn:aws:lambda:ap-southeast-3:xxx:layer:oracle-instantclient:8

# 5. Tag function (required for Restate invoke permission via IAM condition)
aws lambda tag-resource \
  --resource arn:aws:lambda:ap-southeast-3:xxx:function:soa-finance \
  --tags "ManagedBy=github-actions"

# 6. Add invoke permission for Restate
aws lambda add-permission --function-name soa-finance \
  --statement-id restate-invoke \
  --action lambda:InvokeFunction \
  --principal arn:aws:iam::xxx:role/GitHubActions-RestateDeploy
```

## Networking Architecture

```
Lambda (VPC private subnet, no internet route)
├── Oracle DB ── 172.31.0.188:1521 (VPC local route)
├── S3 ── Gateway Endpoint vpce-xxx (free)
├── Gotenberg PDF ── https-proxy-agent → Squid t4g.nano (HTTPS)
└── Microsoft Graph API ── https-proxy-agent → Squid t4g.nano (HTTPS)
```

**Key points:**
- Lambda has NO `0.0.0.0/0` route — only VPC local and S3 Gateway Endpoint
- External HTTPS traffic (Gotenberg, Graph API) routes through Squid proxy via `https-proxy-agent`
- Oracle is accessed by VPC private IP (172.31.0.188)
- S3 is accessed via Gateway Endpoint (free, no NAT needed)
- All external HTTPS calls use `https-proxy-agent` package, not `fetch()` proxy

## Restate Registration

```bash
# Via CLI
export RESTATE_ADMIN_URL=http://admin-restate.tob-insurance.com:9070
restate deployments register arn:aws:lambda:ap-southeast-3:xxx:function:soa-finance:VERSION \
  --assume-role-arn arn:aws:iam::xxx:role/GitHubActions-RestateDeploy

# Via API
curl -X POST http://admin-restate.tob-insurance.com:9070/deployments \
  -H "Content-Type: application/json" \
  -d '{
    "arn": "arn:aws:lambda:ap-southeast-3:xxx:function:soa-finance:VERSION",
    "assume_role_arn": "arn:aws:iam::xxx:role/GitHubActions-RestateDeploy",
    "force": true
  }'
```

## Cleanup Old Deployments

```bash
export RESTATE_ADMIN_URL=http://admin-restate.tob-insurance.com:9070
export CI=true

restate deployments list -q | grep "soa-finance" | grep -v ":VERSION " | awk '{print $3}' | while read id; do
  restate deployments remove "$id" < /dev/null
done
```

## Environment Variables

| Variable | Source | Description |
|---|---|---|
| `ORACLE_URL` | Infisical | Oracle connection string (VPC private IP) |
| `GOTENBERG_URL` | Infisical | Gotenberg Lambda function URL |
| `S3_BUCKET` | Infisical | S3 bucket name for pipeline + SOA docs |
| `HTTPS_PROXY` | Infisical | Squid proxy URL for external HTTPS |
| `AZURE_TENANT_ID` | Infisical | Microsoft Graph tenant |
| `AZURE_CLIENT_ID` | Infisical | Microsoft Graph client ID |
| `AZURE_CLIENT_SECRET` | Infisical | Microsoft Graph client secret |
| `APP_ENV` | Infisical | `development` or `production` |
