import "./chart-element.js";
import { streamCharts } from "./client-core.js";

const subscriptions = [
  {
    key: "alpha",
    xMin: 0,
    xMax: 100,
    xBits: 16,
    yMin: -2,
    yMax: 2,
    yBits: 16
  },
  {
    key: "beta",
    xMin: 0,
    xMax: 100,
    xBits: 16,
    yMin: -2,
    yMax: 2,
    yBits: 16
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
    latest.set(message.key, { ...base, points: message.points });
    redraw();
  }
}).catch((error) => {
  status.textContent = error.message;
});
