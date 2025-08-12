export class GetAllItemsQuery {
  constructor(
    public readonly userId: string,
    public readonly instanceId: string,
    public readonly prefix?: string,
  ) {}
}
