import { Prisma } from "@prisma/client";

function isTransactionConflict(error) {
  return error?.code === "P2034" || (
    error?.code === "P2010" && ["40001", "40P01"].includes(error.meta?.code)
  );
}

// Callbacks must contain only database operations; external side effects cannot
// be rolled back and must not be repeated when PostgreSQL aborts a transaction.
export async function serializableTransaction(client, work, maxAttempts = 3) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error("O número de tentativas precisa ser um inteiro positivo.");
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await client.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isTransactionConflict(error) || attempt === maxAttempts) throw error;
    }
  }
}
