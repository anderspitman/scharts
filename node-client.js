import { streamCharts } from "./client-core.js";

const port = Number(process.env.PORT || process.env.SCHARTS_PORT || 8080);
const ANSI_RESET = "\x1b[0m";
const SERIES_COLORS = [
  "\x1b[38;5;220m",
  "\x1b[38;5;45m",
  "\x1b[38;5;204m",
  "\x1b[38;5;120m"
];
const subscriptions = [
  {
    key: "alpha",
    yMin: -2,
    yMax: 2,
    yBits: 16
  },
  {
    key: "beta",
    yMin: -2,
    yMax: 2,
    yBits: 16
  }
];

const latest = new Map();
let lastStats = {
  bytesReceived: 0,
  bitrateBps: 0,
  messageCount: 0
};

function formatBitrate(bitrateBps) {
  if (bitrateBps >= 1_000_000) {
    return `${(bitrateBps / 1_000_000).toFixed(2)} Mb/s`;
  }
  if (bitrateBps >= 1_000) {
    return `${(bitrateBps / 1_000).toFixed(1)} kb/s`;
  }
  return `${bitrateBps.toFixed(0)} b/s`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function drawSegment(canvas, x0, y0, x1, y1, colorIndex) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);

  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(x0 + (dx * step) / steps);
    const y = Math.round(y0 + (dy * step) / steps);
    if (y >= 0 && y < canvas.length && x >= 0 && x < canvas[0].length) {
      canvas[y][x] = colorIndex;
    }
  }
}

function createBrailleCanvas(cellWidth, cellHeight) {
  const pixelWidth = cellWidth * 2;
  const pixelHeight = cellHeight * 4;
  const pixels = Array.from({ length: pixelHeight }, () => Array(pixelWidth).fill(-1));

  return {
    cellWidth,
    cellHeight,
    pixelWidth,
    pixelHeight,
    pixels
  };
}

function plotSeries(canvas, series, colorIndex) {
  let previous = null;
  for (let i = 0; i < series.points.length; i += 1) {
    const point = series.points[i];
    const x = clamp(
      Math.round((i / Math.max(1, series.points.length - 1)) * (canvas.pixelWidth - 1)),
      0,
      canvas.pixelWidth - 1
    );
    const normalized = (point.y - series.yMin) / (series.yMax - series.yMin || 1);
    const y = clamp(
      canvas.pixelHeight - 1 - Math.round(normalized * (canvas.pixelHeight - 1)),
      0,
      canvas.pixelHeight - 1
    );

    if (previous) {
      drawSegment(canvas.pixels, previous.x, previous.y, x, y, colorIndex);
    } else {
      canvas.pixels[y][x] = colorIndex;
    }
    previous = { x, y };
  }
}

function brailleMaskForCell(pixels, cellX, cellY) {
  const baseX = cellX * 2;
  const baseY = cellY * 4;
  const dotMap = [
    [0, 0, 0x01],
    [0, 1, 0x02],
    [0, 2, 0x04],
    [1, 0, 0x08],
    [1, 1, 0x10],
    [1, 2, 0x20],
    [0, 3, 0x40],
    [1, 3, 0x80]
  ];

  let mask = 0;
  let colorIndex = -1;
  for (const [offsetX, offsetY, bit] of dotMap) {
    const value = pixels[baseY + offsetY]?.[baseX + offsetX] ?? -1;
    if (value !== -1) {
      mask |= bit;
      colorIndex = value;
    }
  }

  return { mask, colorIndex };
}

function renderBrailleCanvas(series) {
  const canvas = createBrailleCanvas(72, 9);
  series.forEach((entry, index) => plotSeries(canvas, entry, index % SERIES_COLORS.length));

  const lines = [];
  for (let cellY = 0; cellY < canvas.cellHeight; cellY += 1) {
    let line = "";
    let activeColor = null;

    for (let cellX = 0; cellX < canvas.cellWidth; cellX += 1) {
      const { mask, colorIndex } = brailleMaskForCell(canvas.pixels, cellX, cellY);
      if (mask === 0) {
        if (activeColor !== null) {
          line += ANSI_RESET;
          activeColor = null;
        }
        line += " ";
        continue;
      }

      const color = SERIES_COLORS[colorIndex];
      if (activeColor !== color) {
        line += color;
        activeColor = color;
      }
      line += String.fromCodePoint(0x2800 + mask);
    }

    if (activeColor !== null) {
      line += ANSI_RESET;
    }
    lines.push(line);
  }

  return lines.join("\n");
}

function renderLegend(series) {
  return series
    .map((entry, index) => `${SERIES_COLORS[index % SERIES_COLORS.length]}${entry.key}${ANSI_RESET}`)
    .join("  ");
}

function repaint() {
  const series = subscriptions.map((item) => latest.get(item.key)).filter(Boolean);
  if (!series.length) {
    return;
  }

  process.stdout.write("\x1b[2J\x1b[H");
  process.stdout.write("scharts node client\n");
  process.stdout.write(`${renderLegend(series)}\n\n`);
  process.stdout.write(`/stream ${formatBitrate(lastStats.bitrateBps)} • ${lastStats.bytesReceived} B • ${lastStats.messageCount} messages\n\n`);
  process.stdout.write(`${renderBrailleCanvas(series)}\n`);
}

streamCharts({
  url: process.env.SCHARTS_URL || `http://localhost:${port}/stream`,
  items: subscriptions,
  onMessage(message, stats) {
    if (stats) {
      lastStats = stats;
    }
    if (!message) {
      repaint();
      return;
    }

    const base = subscriptions[message.index];
    latest.set(message.key, { ...base, points: message.points });
    repaint();
  }
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
