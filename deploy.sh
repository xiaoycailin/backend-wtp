#!/bin/bash
set -e

cd /home/www/backend-wtp

echo "Syncing with GitHub..."
git fetch origin
git reset --hard origin/main

echo "Installing dependencies..."
npm install --include=dev

echo "Generating prisma client..."
npx prisma generate

echo "Building project..."
npm run build

echo "Restarting service..."
pm2 restart backendwtp || pm2 start node --name "backendwtp" -- -r tsconfig-paths/register dist/index.js