export async function writeAudit(
  tx,
  {
    actorId = null,
    orderId = null,
    entityType,
    entityId,
    action,
    beforeJson = null,
    afterJson = null,
  },
) {
  await tx.auditLog.create({
    data: {
      actorId,
      orderId,
      entityType,
      entityId,
      action,
      beforeJson,
      afterJson,
    },
  });
}
