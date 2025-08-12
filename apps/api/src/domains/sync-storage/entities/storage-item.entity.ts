export class StorageItem {
  id?: string;
  userId: string;
  instanceId: string;
  key: string;
  value: any;
  metadata?: Record<string, any>;
  version: number;
  timestamp: number;
  lastModified: Date;
  isDeleted?: boolean;

  constructor(data: Partial<StorageItem> = {}) {
    Object.assign(this, data);
  }

  toJSON() {
    return {
      key: this.key,
      value: this.value,
      metadata: this.metadata,
      version: this.version,
      timestamp: this.timestamp,
      lastModified: this.lastModified,
    };
  }
}
