import "./schart-line.js";
import "./schart-scatter.js";
import { streamCharts } from "./client-core.js";

const subscriptions = [
  {
    key: "alpha",
    yMin: -2,
    yMax: 2,
    yBits: 16
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

const charts = new Map([
  ["alpha", document.querySelector("schart-line")],
  ["clusters", document.querySelector("schart-scatter")]
]);
const status = document.querySelector("[data-status]");
const latest = new Map(subscriptions.map((item) => [item.key, { ...item, points: [] }]));
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

function updateStatus() {
  status.textContent = `/stream ${formatBitrate(lastStats.bitrateBps)} • ${lastStats.bytesReceived} B • ${lastStats.messageCount} messages`;
}

function redraw(key) {
  const chart = charts.get(key);
  if (!chart) {
    return;
  }

  const entry = latest.get(key);
  chart.data = entry ? [entry] : [];
}

streamCharts({
  url: "/stream",
  items: subscriptions,
  onMessage(message, stats) {
    if (stats) {
      lastStats = stats;
      updateStatus();
    }
    if (!message) {
      return;
    }

    const base = subscriptions[message.index];
    if (base.includeX === true) {
      const previous = latest.get(message.key) || { ...base, points: [] };
      latest.set(message.key, {
        ...base,
        points: previous.points.concat(message.points)
      });
    } else {
      latest.set(message.key, {
        ...base,
        points: message.points
      });
    }
    redraw(message.key);
  }
}).catch((error) => {
  status.textContent = error.message;
});
