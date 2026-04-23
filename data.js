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

function sampleClusteredY(subscription, random) {
  const clusters = [0, 0.5, 1];
  const center = clusters[Math.floor(random() * clusters.length)];
  const noise = (((random() + random() + random()) / 3) - 0.5) * 0.12;
  return clamp(center + noise, subscription.yMin, subscription.yMax);
}

function createGapSegments(subscription, random) {
  const span = subscription.xMax - subscription.xMin;
  const gapCount = 7;
  const gaps = [];

  while (gaps.length < gapCount) {
    const width = span * (0.015 + (random() * 0.03));
    const start = subscription.xMin + (random() * (span - width));
    const end = start + width;
    const overlaps = gaps.some((gap) => !(end <= gap.start || start >= gap.end));
    if (!overlaps) {
      gaps.push({ start, end });
    }
  }

  gaps.sort((a, b) => a.start - b.start);
  const segments = [];
  let cursor = subscription.xMin;
  for (const gap of gaps) {
    if (gap.start > cursor) {
      segments.push({ start: cursor, end: gap.start });
    }
    cursor = gap.end;
  }
  if (cursor < subscription.xMax) {
    segments.push({ start: cursor, end: subscription.xMax });
  }

  return segments;
}

function projectIntoSegments(position, segments) {
  let remaining = position;
  for (const segment of segments) {
    const width = segment.end - segment.start;
    if (remaining <= width) {
      return segment.start + remaining;
    }
    remaining -= width;
  }
  return segments[segments.length - 1].end;
}

function createScatterBatches(subscription, batchCount = 600) {
  const random = createRng(createSeed(subscription.key));
  const span = subscription.xMax - subscription.xMin;
  const targetTotal = Math.max(1, Math.round(span / 100));
  const segments = createGapSegments(subscription, random);
  const availableSpan = segments.reduce((sum, segment) => sum + (segment.end - segment.start), 0);
  const batches = Array.from({ length: batchCount }, () => []);

  for (let index = 0; index < targetTotal; index += 1) {
    const base = ((index + 0.5) / targetTotal) * availableSpan;
    const jitter = ((random() - 0.5) * availableSpan) / targetTotal * 0.7;
    const x = clamp(
      projectIntoSegments(clamp(base + jitter, 0, availableSpan), segments),
      subscription.xMin,
      subscription.xMax
    );
    const normalized = (x - subscription.xMin) / (span || 1);
    const batchIndex = clamp(Math.floor(normalized * batchCount), 0, batchCount - 1);
    batches[batchIndex].push({
      x,
      y: sampleClusteredY(subscription, random)
    });
  }

  batches.forEach((batch) => batch.sort((a, b) => a.x - b.x));

  return batches;
}

export function createSeriesState(subscription) {
  if (subscription.includeX === true) {
    return {
      mode: "scatter",
      batches: createScatterBatches(subscription)
    };
  }

  return {
    mode: "line"
  };
}

function generateLineSeriesPoints(subscription, tick, sampleCount) {
  const points = [];
  const phase = tick / 6;
  const center = (subscription.yMin + subscription.yMax) / 2;
  const amplitude = (subscription.yMax - subscription.yMin) * 0.42;
  const nameFactor = subscription.key
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const frequency = 1 + (nameFactor % 5);

  for (let i = 0; i < sampleCount; i += 1) {
    const t = sampleCount <= 1 ? 0 : i / (sampleCount - 1);
    const x = subscription.includeX === true
      ? subscription.xMin + ((subscription.xMax - subscription.xMin || 1) * t)
      : i;
    const wave = Math.sin((t * Math.PI * 2 * frequency) + phase);
    const wobble = Math.cos((t * Math.PI * 8) - (phase * 0.7)) * amplitude * 0.16;
    points.push({
      x,
      y: center + (wave * amplitude) + wobble
    });
  }

  return points;
}

export function generateSeriesBatch(subscription, state, tick, sampleCount) {
  if (state?.mode === "scatter") {
    return state.batches[tick] || [];
  }

  return generateLineSeriesPoints(subscription, tick, sampleCount);
}
