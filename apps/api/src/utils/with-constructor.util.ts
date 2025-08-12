type Constructor<T> = { new (): T };

export function withConstructor<T>(Base: Constructor<T>): { new (data: Partial<T>): T } {
  return class SerializedResponseData extends (Base as { new (): any }) {
    constructor(data: Partial<T>) {
      // eslint-disable-next-line sonarjs/super-invocation
      super();

      Object.assign(this, data);
    }
  } as { new (data: Partial<T>): T };
}
