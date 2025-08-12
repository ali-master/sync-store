export class GetItemQuery {
  constructor(
    public readonly userId: string,
    public readonly instanceId: string,
    public readonly key: string,
  ) {}
}
