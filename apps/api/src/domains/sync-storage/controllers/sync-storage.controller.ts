import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Query,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam } from "@nestjs/swagger";
import { SetItemCommand } from "../commands/impl/set-item.command";
import { RemoveItemCommand } from "../commands/impl/remove-item.command";
import { ClearStorageCommand } from "../commands/impl/clear-storage.command";
import { GetItemQuery } from "../queries/impl/get-item.query";
import { GetAllItemsQuery } from "../queries/impl/get-all-items.query";
import { GetKeysQuery } from "../queries/impl/get-keys.query";
import { StorageItemDto } from "../dto/storage-item.dto";
import { StorageResponseDto } from "../dto/storage-response.dto";
import { ApiKeyAuth } from "../decorators/api-key-auth.decorator";
import { getUserId, getInstanceId } from "@root/modules/context/context.storage";

@ApiTags("Sync Storage")
@Controller("sync-storage")
@ApiKeyAuth()
export class SyncStorageController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get("item/:key")
  @ApiOperation({ summary: "Get a stored item by key" })
  @ApiResponse({
    status: 200,
    description: "Item retrieved successfully",
    type: StorageResponseDto,
  })
  @ApiParam({
    name: "key",
    required: true,
    description: "The key of the item to retrieve",
    type: String,
  })
  @ApiResponse({ status: 404, description: "Item not found" })
  async getItem(@Param("key") key: string): Promise<StorageResponseDto> {
    const userId = getUserId();
    const instanceId = getInstanceId();
    const query = new GetItemQuery(userId, instanceId, key);
    return await this.queryBus.execute(query);
  }

  @Put("item/:key")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Set or update an item" })
  @ApiResponse({
    status: 200,
    description: "Item stored successfully",
    type: StorageResponseDto,
  })
  @ApiParam({
    name: "key",
    required: true,
    description: "The key of the item to set or update",
    type: String,
  })
  async setItem(
    @Param("key") key: string,
    @Body() body: StorageItemDto,
  ): Promise<StorageResponseDto> {
    const userId = getUserId();
    const instanceId = getInstanceId();
    const command = new SetItemCommand(userId, instanceId, key, body.value, body.metadata);
    return await this.commandBus.execute(command);
  }

  @Delete("item/:key")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Remove an item" })
  @ApiResponse({
    status: 204,
    description: "Item removed successfully",
  })
  @ApiParam({
    name: "key",
    required: true,
    description: "The key of the item to remove",
    type: String,
  })
  async removeItem(@Param("key") key: string): Promise<void> {
    const userId = getUserId();
    const instanceId = getInstanceId();
    const command = new RemoveItemCommand(userId, instanceId, key);
    await this.commandBus.execute(command);
  }

  @Get("items")
  @ApiOperation({ summary: "Get all items for a user" })
  @ApiResponse({
    status: 200,
    description: "Items retrieved successfully",
    type: [StorageResponseDto],
  })
  @ApiQuery({
    name: "prefix",
    required: false,
    description: "Optional prefix to filter items by key",
    type: String,
  })
  async getAllItems(@Query("prefix") prefix?: string): Promise<StorageResponseDto[]> {
    const userId = getUserId();
    const instanceId = getInstanceId();
    const query = new GetAllItemsQuery(userId, instanceId, prefix);
    return await this.queryBus.execute(query);
  }

  @Get("keys")
  @ApiOperation({ summary: "Get all keys for a user" })
  @ApiResponse({
    status: 200,
    description: "Keys retrieved successfully",
    type: [String],
  })
  @ApiQuery({
    name: "prefix",
    required: false,
    description: "Optional prefix to filter items by key",
    type: String,
  })
  async getKeys(@Query("prefix") prefix?: string): Promise<string[]> {
    const userId = getUserId();
    const instanceId = getInstanceId();
    const query = new GetKeysQuery(userId, instanceId, prefix);
    return await this.queryBus.execute(query);
  }

  @Delete("clear")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Clear all items for a user" })
  @ApiResponse({
    status: 204,
    description: "Storage cleared successfully",
  })
  async clear(): Promise<void> {
    const userId = getUserId();
    const instanceId = getInstanceId();
    const command = new ClearStorageCommand(userId, instanceId);
    await this.commandBus.execute(command);
  }
}
