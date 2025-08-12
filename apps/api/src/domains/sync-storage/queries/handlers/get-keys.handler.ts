import { IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { GetKeysQuery } from "../impl/get-keys.query";
import { SyncStorageRepository } from "../../repositories/sync-storage.repository";

@QueryHandler(GetKeysQuery)
export class GetKeysHandler implements IQueryHandler<GetKeysQuery> {
  constructor(private readonly repository: SyncStorageRepository) {}

  async execute(query: GetKeysQuery): Promise<string[]> {
    const { userId, prefix } = query;
    return await this.repository.findKeys(userId, prefix);
  }
}
