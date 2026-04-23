export const DEMO_DATASETS = {
  alpha: {
    key: "alpha",
    mode: "line",
    xMin: 0,
    xMax: 60000,
    yMin: -2,
    yMax: 2,
    cycleLength: 600,
    totalPoints: 60000
  },
  clusters: {
    key: "clusters",
    mode: "scatter",
    xMin: 0,
    xMax: 3000000000,
    yMin: -0.1,
    yMax: 1.1,
    cycleLength: 600,
  }
};

export function getDemoDataset(key) {
  return DEMO_DATASETS[key] || null;
}

export function createDemoSubscription(key, options = {}) {
  const dataset = getDemoDataset(key);
  if (!dataset) {
    throw new Error(`Unknown demo dataset: ${key}`);
  }

  const includeX = dataset.mode === "scatter";
  return {
    key: dataset.key,
    includeX,
    ...(includeX ? {
      xMin: dataset.xMin,
      xMax: dataset.xMax,
      xBits: options.xBits ?? 16
    } : {}),
    yMin: dataset.yMin,
    yMax: dataset.yMax,
    yBits: options.yBits ?? 16,
    persistent: options.persistent ?? true,
    opacity: options.opacity,
    viewXMin: options.viewXMin ?? dataset.xMin,
    viewXMax: options.viewXMax ?? dataset.xMax,
    viewYMin: options.viewYMin ?? dataset.yMin,
    viewYMax: options.viewYMax ?? dataset.yMax
  };
}
