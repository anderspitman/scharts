import "./chart-element.js";
import { streamCharts } from "./client-core.js";

const subscriptions = [
  {
    key: "clusters",
    includeX: true,
    xMin: 0,
    xMax: 60000,
    xBits: 16,
    yMin: -0.1,
    yMax: 1.1,
    yBits: 12,
    renderMode: "scatter",
    persistent: true
  }
];

const chart = document.querySelector("s-chart");
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

function redraw() {
  chart.data = subscriptions.map((item) => latest.get(item.key));
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
    const previous = latest.get(message.key) || { ...base, points: [] };
    latest.set(message.key, {
      ...base,
      points: previous.points.concat(message.points)
    });
    redraw();
  }
}).catch((error) => {
  status.textContent = error.message;
});
