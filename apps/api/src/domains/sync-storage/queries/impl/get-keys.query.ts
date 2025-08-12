export class GetKeysQuery {
  constructor(
    public readonly userId: string,
    public readonly instanceId: string,
    public readonly prefix?: string,
  ) {}
}
