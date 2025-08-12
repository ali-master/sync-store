export class StorageClearedEvent {
  constructor(
    public readonly userId: string,
    public readonly instanceId: string,
    public readonly timestamp: number = Date.now(),
  ) {}
}
