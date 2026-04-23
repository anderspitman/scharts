function createSeed(key) {
  return key
    .split("")
    .reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 0x811c9dc5);
}

function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sampleClusteredY(dataset, random) {
  const clusters = [0, 0.5, 1];
  const center = clusters[Math.floor(random() * clusters.length)];
  const noise = (((random() + random() + random()) / 3) - 0.5) * 0.12;
  return clamp(center + noise, dataset.yMin, dataset.yMax);
}

function createScatterBatches(dataset, batchCount = 600) {
  const random = createRng(createSeed(dataset.key));
  const span = dataset.xMax - dataset.xMin;
  const targetTotal = Math.max(1, Math.round(span / 100));
  const batches = Array.from({ length: batchCount }, () => []);

  for (let index = 0; index < targetTotal; index += 1) {
    const t = targetTotal <= 1 ? 0.5 : index / (targetTotal - 1);
    const step = span / Math.max(1, targetTotal - 1);
    const jitter = (random() - 0.5) * step * 0.35;
    const x = clamp(dataset.xMin + (t * span) + jitter, dataset.xMin, dataset.xMax);
    const normalized = (x - dataset.xMin) / (span || 1);
    const batchIndex = clamp(Math.floor(normalized * batchCount), 0, batchCount - 1);
    batches[batchIndex].push({
      x,
      y: sampleClusteredY(dataset, random)
    });
  }

  batches.forEach((batch) => batch.sort((a, b) => a.x - b.x));

  return batches;
}

export function createSeriesState(dataset) {
  if (dataset.mode === "line") {
    return {
      mode: "line",
      cycleLength: dataset.cycleLength,
      totalPoints: dataset.totalPoints
    };
  }

  if (dataset.mode === "scatter") {
    return {
      mode: "scatter",
      batches: createScatterBatches(dataset, dataset.cycleLength),
      cycleLength: dataset.cycleLength
    };
  }

  return {
    mode: "line",
    cycleLength: dataset.cycleLength
  };
}

function generateLineSeriesPoints(dataset, tick, sampleCount) {
  const points = [];
  const phase = tick / 6;
  const center = (dataset.yMin + dataset.yMax) / 2;
  const amplitude = (dataset.yMax - dataset.yMin) * 0.42;
  const nameFactor = dataset.key
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const frequency = 1 + (nameFactor % 5);

  for (let i = 0; i < sampleCount; i += 1) {
    const t = sampleCount <= 1 ? 0 : i / (sampleCount - 1);
    const x = dataset.xMin + ((dataset.xMax - dataset.xMin || 1) * t);
    const wave = Math.sin((t * Math.PI * 2 * frequency) + phase);
    const wobble = Math.cos((t * Math.PI * 8) - (phase * 0.7)) * amplitude * 0.16;
    points.push({
      x,
      y: center + (wave * amplitude) + wobble
    });
  }

  return points;
}

function generateLineSeriesBatch(dataset, state, tick) {
  const cycleTick = tick % state.cycleLength;
  const batchSize = Math.ceil(state.totalPoints / state.cycleLength);
  const startIndex = cycleTick * batchSize;
  const endIndex = Math.min(state.totalPoints, startIndex + batchSize);
  const phase = tick / 6;
  const center = (dataset.yMin + dataset.yMax) / 2;
  const amplitude = (dataset.yMax - dataset.yMin) * 0.42;
  const nameFactor = dataset.key
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const frequency = 1 + (nameFactor % 5);
  const points = [];

  for (let index = startIndex; index < endIndex; index += 1) {
    const x = startIndex + (index - startIndex);
    const t = dataset.xMax === dataset.xMin ? 0 : (x - dataset.xMin) / (dataset.xMax - dataset.xMin);
    const wave = Math.sin((t * Math.PI * 2 * frequency) + phase);
    const wobble = Math.cos((t * Math.PI * 8) - (phase * 0.7)) * amplitude * 0.16;
    points.push({
      y: center + (wave * amplitude) + wobble
    });
  }

  return {
    points,
    xOffset: startIndex
  };
}

export function generateSeriesBatch(dataset, state, tick, sampleCount) {
  if (state?.mode === "scatter") {
    const batchIndex = tick % state.cycleLength;
    return {
      points: state.batches[batchIndex] || []
    };
  }

  if (state?.mode === "line" && state.totalPoints) {
    return generateLineSeriesBatch(dataset, state, tick);
  }

  return {
    points: generateLineSeriesPoints(dataset, tick, sampleCount)
  };
}

export function didSeriesWrap(state, previousTick, nextTick) {
  if (!state?.cycleLength) {
    return false;
  }

  return Math.floor(previousTick / state.cycleLength) !== Math.floor(nextTick / state.cycleLength);
}
