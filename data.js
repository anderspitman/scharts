export function generateSeriesPoints(subscription, tick, sampleCount) {
  const points = [];
  const span = subscription.xMax - subscription.xMin || 1;
  const phase = tick / 6;
  const center = (subscription.yMin + subscription.yMax) / 2;
  const amplitude = (subscription.yMax - subscription.yMin) * 0.42;
  const nameFactor = subscription.key
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const frequency = 1 + (nameFactor % 5);

  for (let i = 0; i < sampleCount; i += 1) {
    const t = sampleCount <= 1 ? 0 : i / (sampleCount - 1);
    const x = subscription.xMin + (span * t);
    const wave = Math.sin((t * Math.PI * 2 * frequency) + phase);
    const wobble = Math.cos((t * Math.PI * 8) - (phase * 0.7)) * amplitude * 0.16;
    points.push({
      x,
      y: center + (wave * amplitude) + wobble
    });
  }

  return points;
}
