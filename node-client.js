import { streamCharts } from "./client-core.js";

const port = Number(process.env.PORT || process.env.SCHARTS_PORT || 8080);
const ANSI_RESET = "\x1b[0m";
const SERIES_COLORS = {
  alpha: "\x1b[38;5;220m",
  clusters: "\x1b[38;5;45m"
};
const subscriptions = [
  {
    key: "alpha",
    xMin: 0,
    xMax: 60000,
    yMin: -2,
    yMax: 2,
    yBits: 16,
    persistent: true
  },
  {
    key: "clusters",
    includeX: true,
    xMin: 0,
    xMax: 60000,
    xBits: 16,
    yMin: -0.1,
    yMax: 1.1,
    yBits: 12,
    persistent: true
  }
];

let lastStats = {
  bytesReceived: 0,
  bitrateBps: 0,
  messageCount: 0
};
let repaintScheduled = false;
let terminalInitialized = false;

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

function clearBrailleCanvas(canvas) {
  canvas.pixels.forEach((row) => row.fill(-1));
}

function drawPixel(canvas, x, y, color) {
  if (y >= 0 && y < canvas.pixelHeight && x >= 0 && x < canvas.pixelWidth) {
    canvas.pixels[y][x] = color;
  }
}

function drawSegment(canvas, x0, y0, x1, y1, color) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);

  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(x0 + (dx * step) / steps);
    const y = Math.round(y0 + (dy * step) / steps);
    drawPixel(canvas, x, y, color);
  }
}

function projectPoint(subscription, canvas, point) {
  const x = clamp(
    Math.round(((point.x - subscription.xMin) / (subscription.xMax - subscription.xMin || 1)) * (canvas.pixelWidth - 1)),
    0,
    canvas.pixelWidth - 1
  );
  const normalized = (point.y - subscription.yMin) / (subscription.yMax - subscription.yMin || 1);
  const y = clamp(
    canvas.pixelHeight - 1 - Math.round(normalized * (canvas.pixelHeight - 1)),
    0,
    canvas.pixelHeight - 1
  );

  return { x, y };
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
  let color = null;
  for (const [offsetX, offsetY, bit] of dotMap) {
    const value = pixels[baseY + offsetY]?.[baseX + offsetX] ?? -1;
    if (value !== -1) {
      mask |= bit;
      color = value;
    }
  }

  return { mask, color };
}

function renderBrailleCanvas(canvas) {
  const lines = [];
  for (let cellY = 0; cellY < canvas.cellHeight; cellY += 1) {
    let line = "";
    let activeColor = null;

    for (let cellX = 0; cellX < canvas.cellWidth; cellX += 1) {
      const { mask, color } = brailleMaskForCell(canvas.pixels, cellX, cellY);
      if (mask === 0) {
        if (activeColor !== null) {
          line += ANSI_RESET;
          activeColor = null;
        }
        line += " ";
        continue;
      }

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

  return lines;
}

function createRenderer(subscription, mode) {
  return {
    subscription,
    mode,
    canvas: createBrailleCanvas(72, 9),
    maxSeenX: Number.NEGATIVE_INFINITY,
    previousPoint: null
  };
}

const renderers = new Map([
  ["alpha", createRenderer(subscriptions[0], "line")],
  ["clusters", createRenderer(subscriptions[1], "scatter")]
]);

function resetRenderer(renderer) {
  clearBrailleCanvas(renderer.canvas);
  renderer.maxSeenX = Number.NEGATIVE_INFINITY;
  renderer.previousPoint = null;
}

function maybeWrapRenderer(renderer, points) {
  if (!renderer.subscription.persistent || !points.length) {
    return false;
  }

  if (renderer.maxSeenX === Number.NEGATIVE_INFINITY) {
    return false;
  }

  if (points[0].x < renderer.maxSeenX) {
    resetRenderer(renderer);
    return true;
  }

  return false;
}

function drawLineBatch(renderer, points) {
  points.forEach((point, index) => {
    const projected = projectPoint(renderer.subscription, renderer.canvas, point);
    if (index === 0) {
      if (renderer.previousPoint) {
        const previous = projectPoint(renderer.subscription, renderer.canvas, renderer.previousPoint);
        drawSegment(renderer.canvas, previous.x, previous.y, projected.x, projected.y, SERIES_COLORS.alpha);
      } else {
        drawPixel(renderer.canvas, projected.x, projected.y, SERIES_COLORS.alpha);
      }
    } else {
      const previous = projectPoint(renderer.subscription, renderer.canvas, points[index - 1]);
      drawSegment(renderer.canvas, previous.x, previous.y, projected.x, projected.y, SERIES_COLORS.alpha);
    }
  });

  renderer.previousPoint = points.at(-1) || renderer.previousPoint;
}

function drawScatterBatch(renderer, points) {
  points.forEach((point) => {
    const projected = projectPoint(renderer.subscription, renderer.canvas, point);
    drawPixel(renderer.canvas, projected.x, projected.y, SERIES_COLORS.clusters);
  });
}

function applyBatch(key, points) {
  const renderer = renderers.get(key);
  if (!renderer) {
    return;
  }

  maybeWrapRenderer(renderer, points);
  if (!renderer.subscription.persistent) {
    resetRenderer(renderer);
  }

  if (renderer.mode === "line") {
    drawLineBatch(renderer, points);
  } else {
    drawScatterBatch(renderer, points);
  }

  if (points.length) {
    const batchMaxX = points.reduce((maxX, point) => Math.max(maxX, point.x), Number.NEGATIVE_INFINITY);
    renderer.maxSeenX = Math.max(renderer.maxSeenX, batchMaxX);
  }
}

function renderSection(title, key) {
  const color = SERIES_COLORS[key];
  const renderer = renderers.get(key);
  const lines = renderBrailleCanvas(renderer.canvas);
  return [
    `${color}${title}${ANSI_RESET}`,
    ...lines
  ].join("\n");
}

function repaint() {
  repaintScheduled = false;
  const frame = [
    "\x1b[H",
    "scharts node client",
    `/stream ${formatBitrate(lastStats.bitrateBps)} • ${lastStats.bytesReceived} B • ${lastStats.messageCount} messages`,
    "",
    renderSection("Line", "alpha"),
    "",
    renderSection("Scatter", "clusters"),
    "\x1b[J"
  ].join("\n");
  process.stdout.write(frame);
}

function scheduleRepaint() {
  if (repaintScheduled) {
    return;
  }

  repaintScheduled = true;
  setTimeout(repaint, 0);
}

function restoreTerminal() {
  if (!terminalInitialized) {
    return;
  }

  terminalInitialized = false;
  process.stdout.write(`\x1b[?25h${ANSI_RESET}\x1b[?1049l`);
}

function initTerminal() {
  if (terminalInitialized || !process.stdout.isTTY) {
    return;
  }

  terminalInitialized = true;
  process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[H\x1b[J");
  process.on("exit", restoreTerminal);
  process.on("SIGINT", () => {
    restoreTerminal();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    restoreTerminal();
    process.exit(143);
  });
}

initTerminal();

streamCharts({
  url: process.env.SCHARTS_URL || `http://localhost:${port}/stream`,
  items: subscriptions,
  onMessage(message, stats) {
    if (stats) {
      lastStats = stats;
      scheduleRepaint();
    }
    if (!message) {
      return;
    }

    applyBatch(message.key, message.points);
    scheduleRepaint();
  }
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
