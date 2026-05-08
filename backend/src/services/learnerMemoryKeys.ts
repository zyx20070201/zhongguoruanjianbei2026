export const buildLearnerMemoryKey = (dimension: string, value: string) =>
  `${dimension}:${String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fa5:_-]/gi, '')
    .slice(0, 80)}`;

export const learnerMemoryKeyMatchesValue = (memoryKey: string, dimension: string, value: string) =>
  memoryKey === buildLearnerMemoryKey(dimension, value);
