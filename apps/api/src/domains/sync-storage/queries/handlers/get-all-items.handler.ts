import { IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { GetAllItemsQuery } from "../impl/get-all-items.query";
import { SyncStorageRepository } from "../../repositories/sync-storage.repository";
import { StorageItem } from "../../entities/storage-item.entity";

@QueryHandler(GetAllItemsQuery)
export class GetAllItemsHandler implements IQueryHandler<GetAllItemsQuery> {
  constructor(private readonly repository: SyncStorageRepository) {}

  async execute(query: GetAllItemsQuery): Promise<StorageItem[]> {
    const { userId, prefix } = query;
    return await this.repository.findAll(userId, prefix);
  }
}
