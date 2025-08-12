/**
 * The `CaseInsensitiveFilterPlugin` function returns an object with a `fn` property that contains an
 * `opsFilter` method, which filters an array of tagged operations based on a case-insensitive phrase.
 * @returns An object with a `fn` property that contains an `opsFilter` method.
 */
export function SwaggerCaseInsensitiveFilterPlugin() {
  return {
    fn: {
      opsFilter: (
        taggedOps: { filter: (argument: (_tagObject: unknown, tag: string) => boolean) => any },
        phrase: string,
      ) => {
        return taggedOps.filter((_tagObject: unknown, tag: string): boolean =>
          tag.toLowerCase().includes(phrase.toLowerCase()),
        ) as unknown as {
          filter: (argument: (_tagObject: unknown, tag: string) => boolean) => any;
        };
      },
    },
  };
}
