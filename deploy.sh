#!/bin/bash
set -e

cd /home/www/backend-wtp

echo "Pulling latest changes..."
git pull

echo "Installing dependencies..."
npm install --omit=dev

echo "Generating data types from prisma..."
npx prisma generate

# echo "Building project..."
# npm run build

echo "Restarting service..."
pm2 restart backendwtp || pm2 start node --name "backendwtp" -- -r tsconfig-paths/register dist/index.js