#!/bin/bash
set -e

# =============================================================================
# Oracle Instant Client Lambda Layer Build Script
# =============================================================================
# This script builds an AWS Lambda Layer containing Oracle Instant Client
# libraries required for node-oracledb thick mode.
#
# Prerequisites:
# - Docker (to build for Amazon Linux 2)
# - Downloaded Oracle Instant Client Basic Lite (Linux x86-64)
#
# Usage:
#   1. Download Oracle Instant Client Basic Lite from:
#      https://www.oracle.com/database/technologies/instant-client/linux-x86-64-downloads.html
#   2. Place the zip file in this directory (lambda-layer/)
#   3. Run: bash build-layer.sh
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/build"
OUTPUT_DIR="${SCRIPT_DIR}/output"

# Oracle Instant Client version - update as needed
INSTANT_CLIENT_ZIP=$(ls "${SCRIPT_DIR}"/instantclient-basiclite-linux*.zip 2>/dev/null | head -1)

echo "🏗️  Building Oracle Instant Client Lambda Layer..."
echo ""

# Check if Instant Client zip exists
if [ -z "$INSTANT_CLIENT_ZIP" ]; then
    echo "❌ Error: Oracle Instant Client zip not found!"
    echo ""
    echo "Please download Oracle Instant Client Basic Lite from:"
    echo "  https://www.oracle.com/database/technologies/instant-client/linux-x86-64-downloads.html"
    echo ""
    echo "Download 'Basic Light Package (ZIP)' for Linux x86-64"
    echo "Place the zip file in: ${SCRIPT_DIR}/"
    echo ""
    echo "Example filename: instantclient-basiclite-linux.x64-19.23.0.0.0dbru.zip"
    exit 1
fi

echo "📦 Using Instant Client: $(basename "$INSTANT_CLIENT_ZIP")"
echo ""

# Clean up previous builds
rm -rf "${BUILD_DIR}" "${OUTPUT_DIR}"
mkdir -p "${BUILD_DIR}/lib" "${OUTPUT_DIR}"

# Extract Instant Client
echo "📂 Extracting Instant Client..."
unzip -q "$INSTANT_CLIENT_ZIP" -d "${BUILD_DIR}/tmp"

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
docker run --rm -v "${BUILD_DIR}/lib:/output" amazonlinux:2 \
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
echo "        --compatible-architectures x86_64"
echo ""
echo "   2. Attach the layer to your Lambda function"
echo ""

# Cleanup temp files
rm -rf "${BUILD_DIR}/tmp"
