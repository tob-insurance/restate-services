// Test setup - set required environment variables for tests
process.env.NODE_ENV = "test";
process.env.AZURE_SHARED_MAILBOX = "test@tob-ins.com";
process.env.AZURE_INITIATOR_EMAIL = "test@tob-ins.com";
process.env.AZURE_TENANT_ID = "test-tenant-id";
process.env.AZURE_CLIENT_ID = "test-client-id";
process.env.AZURE_CLIENT_SECRET = "test-client-secret";
process.env.SOA_FALLBACK_EMAIL = "fallback@tob-ins.com";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.GOTENBERG_URL = "http://localhost:3000";
process.env.S3_BUCKET = "test-bucket";
process.env.AWS_REGION = "ap-southeast-3";
