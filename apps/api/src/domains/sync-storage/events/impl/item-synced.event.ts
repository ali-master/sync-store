export class ItemSyncedEvent {
  constructor(
    public readonly userId: string,
    public readonly instanceId: string,
    public readonly key: string,
    public readonly value: any,
    public readonly metadata?: Record<string, any>,
    public readonly timestamp: number = Date.now(),
  ) {}
}
