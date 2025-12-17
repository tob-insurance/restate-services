#!/bin/bash
set -e

# =============================================================================
# Oracle Instant Client Lambda Layer Build Script
# =============================================================================
# Automatically downloads and builds an AWS Lambda Layer containing Oracle
# Instant Client libraries required for node-oracledb thick mode.
#
# Usage:
#   bash build-layer.sh [--arm64]
#
# Options:
#   --arm64    Build for ARM64 architecture (default: x86_64)
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/build"
OUTPUT_DIR="${SCRIPT_DIR}/output"

# Oracle Instant Client version 19.28
ORACLE_VERSION="19.28.0.0.0dbru"
ORACLE_VERSION_SHORT="1928000"

# Determine architecture
ARCH="x64"
LAMBDA_ARCH="x86_64"
if [ "$1" = "--arm64" ]; then
    ARCH="arm64"
    LAMBDA_ARCH="arm64"
fi

ORACLE_CLIENT_URL="https://download.oracle.com/otn_software/linux/instantclient/${ORACLE_VERSION_SHORT}/instantclient-basiclite-linux.${ARCH}-${ORACLE_VERSION}.zip"

echo "🏗️  Building Oracle Instant Client Lambda Layer..."
echo "   Architecture: ${LAMBDA_ARCH}"
echo "   URL: ${ORACLE_CLIENT_URL}"
echo ""

# Clean up previous builds
rm -rf "${BUILD_DIR}" "${OUTPUT_DIR}"
mkdir -p "${BUILD_DIR}/lib" "${OUTPUT_DIR}"

# Download Oracle Instant Client
echo "📥 Downloading Oracle Instant Client..."
curl -L -o "${BUILD_DIR}/instantclient.zip" "${ORACLE_CLIENT_URL}"

# Extract Instant Client
echo "📂 Extracting Instant Client..."
unzip -q "${BUILD_DIR}/instantclient.zip" -d "${BUILD_DIR}/tmp"

# Find extracted directory
EXTRACTED_DIR=$(find "${BUILD_DIR}/tmp" -maxdepth 1 -type d -name "instantclient_*" | head -1)

if [ -z "$EXTRACTED_DIR" ]; then
    echo "❌ Error: Could not find extracted Instant Client directory"
    exit 1
fi

# Copy required libraries
echo "📋 Copying required libraries..."
cp "${EXTRACTED_DIR}"/*.so* "${BUILD_DIR}/lib/" 2>/dev/null || true

# Get libaio from Amazon Linux container
echo "🐧 Fetching libaio.so.1 from Amazon Linux..."
docker run --rm --platform linux/${LAMBDA_ARCH} -v "${BUILD_DIR}/lib:/output" amazonlinux:2 \
    bash -c "yum install -y libaio > /dev/null 2>&1 && cp /lib64/libaio.so.1 /output/"

# Verify libaio was copied
if [ ! -f "${BUILD_DIR}/lib/libaio.so.1" ]; then
    echo "❌ Error: Failed to get libaio.so.1"
    exit 1
fi

# Remove unnecessary files to reduce size
echo "🧹 Cleaning up unnecessary files..."
cd "${BUILD_DIR}/lib"
rm -f *jdbc* *occi* *jar uidrvci genezi adrci 2>/dev/null || true

# List final libraries
echo ""
echo "📚 Libraries included in layer:"
ls -lh "${BUILD_DIR}/lib/"

# Create layer zip
echo ""
echo "📦 Creating Lambda Layer zip..."
cd "${BUILD_DIR}"
zip -r "${OUTPUT_DIR}/oracle-instantclient-layer.zip" lib/

# Get final size
LAYER_SIZE=$(du -h "${OUTPUT_DIR}/oracle-instantclient-layer.zip" | cut -f1)
echo ""
echo "✅ Lambda Layer created successfully!"
echo "   Output: ${OUTPUT_DIR}/oracle-instantclient-layer.zip"
echo "   Size: ${LAYER_SIZE}"
echo ""
echo "📤 Next steps:"
echo "   1. Upload to AWS Lambda Layers:"
echo "      aws lambda publish-layer-version \\"
echo "        --layer-name oracle-instantclient \\"
echo "        --zip-file fileb://${OUTPUT_DIR}/oracle-instantclient-layer.zip \\"
echo "        --compatible-runtimes nodejs18.x nodejs20.x nodejs22.x \\"
echo "        --compatible-architectures ${LAMBDA_ARCH}"
echo ""
echo "   2. Attach the layer to your Lambda function"
echo ""

# Cleanup temp files
rm -rf "${BUILD_DIR}/tmp" "${BUILD_DIR}/instantclient.zip"
