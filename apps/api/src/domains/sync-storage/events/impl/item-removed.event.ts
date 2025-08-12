export class ItemRemovedEvent {
  constructor(
    public readonly userId: string,
    public readonly instanceId: string,
    public readonly key: string,
    public readonly timestamp: number = Date.now(),
  ) {}
}
