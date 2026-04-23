import "./schart-line.js";
import "./schart-scatter.js";
import { streamCharts } from "./client-core.js";

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

const charts = new Map([
  ["alpha", document.querySelector("schart-line")],
  ["clusters", document.querySelector("schart-scatter")]
]);
const status = document.querySelector("[data-status]");
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
    const chart = charts.get(message.key);
    if (!chart) {
      return;
    }

    chart.data = [{
      ...base,
      points: message.points
    }];
  }
}).catch((error) => {
  status.textContent = error.message;
});
