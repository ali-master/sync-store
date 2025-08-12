export class ClearStorageCommand {
  constructor(
    public readonly userId: string,
    public readonly instanceId: string,
  ) {}
}
