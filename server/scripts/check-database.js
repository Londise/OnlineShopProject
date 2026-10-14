import { prisma } from "../src/db/prisma.js";

try {
  const [info] = await prisma.$queryRaw`
    SELECT current_database() AS database, current_user AS role,
      EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'app') AS "schemaExists"
  `;
  if (!info.schemaExists) throw new Error("SCHEMA_NOT_DEPLOYED");
  // Verify Prisma model access, not merely network connectivity. No PII is logged.
  const [users, products, orders, inventory] = await Promise.all([
    prisma.user.count(), prisma.product.count(), prisma.order.count(),
    prisma.inventoryLevel.count(),
  ]);
  console.log(JSON.stringify({ database: info.database, role: info.role,
    counts: { users, products, orders, inventory } }, null, 2));
} catch (error) {
  // Prisma initialization errors can contain server/connection information.
  console.error("Falha na verificação PostgreSQL.", error.code ?? "CHECK_FAILED");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
