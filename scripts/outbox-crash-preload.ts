// Test-only preload, mounted into a disposable replica. Never loaded by the production command.
const { OutboxService } =
  await import("/app/apps/api/dist/domains/sync-storage/services/outbox.service.js");
OutboxService.prototype.publish = async function (event: { eventId: string; userId: string }) {
  console.log(
    "OUTBOX_BEFORE_PUBLISH",
    JSON.stringify({ eventId: event.eventId, userId: event.userId }),
  );
  await new Promise(() => {});
};
