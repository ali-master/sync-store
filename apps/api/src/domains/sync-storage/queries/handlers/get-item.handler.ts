import { IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { GetItemQuery } from "../impl/get-item.query";
import { SyncStorageRepository } from "../../repositories/sync-storage.repository";
import { StorageItem } from "../../entities/storage-item.entity";

@QueryHandler(GetItemQuery)
export class GetItemHandler implements IQueryHandler<GetItemQuery> {
  constructor(private readonly repository: SyncStorageRepository) {}

  async execute(query: GetItemQuery): Promise<StorageItem | null> {
    const { userId, key } = query;
    return await this.repository.findByKey(userId, key);
  }
}
