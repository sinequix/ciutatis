export function keepPreviousDataForSameQueryTail<T>(_tail: unknown) {
  return (previousData: T | undefined) => previousData;
}
