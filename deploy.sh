#!/bin/bash
echo "Pulling latest changes..."
git pull

echo "Installing dependencies..."
npm install --omit=dev

echo "Generating data types from prisma..."
npx prisma generate

# echo "Building project..."
# npm run build

echo "Restarting service..."
pm2 restart marketplaceservice || pm2 start node --name "marketplaceservice" -- -r tsconfig-paths/register dist/index.js

