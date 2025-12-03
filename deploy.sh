#!/bin/bash
echo "Pulling latest changes..."
git pull

echo "Installing dependencies..."
npm install --omit=dev

# echo "Building project..."
# npm run build

echo "Restarting service..."
pm2 restart marketplaceservice || pm2 start dist/server.js --name marketplaceservice
