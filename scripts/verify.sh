#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

npm install
npm run typecheck
npm test
npm run build
npm run test:e2e
