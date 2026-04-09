const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

prisma.systemLog.count()
  .then((count) => {
    console.log('count', count);
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
