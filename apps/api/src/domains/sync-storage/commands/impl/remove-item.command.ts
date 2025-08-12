export class RemoveItemCommand {
  constructor(
    public readonly userId: string,
    public readonly instanceId: string,
    public readonly key: string,
  ) {}
}
