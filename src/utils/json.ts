export function serializeData<T>(data: T): T {
  return JSON.parse(
    JSON.stringify(data, (_key, value) => {
      if (typeof value === "bigint") {
        return value.toString();
      }

      if (value instanceof Date) {
        return value.toISOString();
      }

      return value;
    }),
  );
}
