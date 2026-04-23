import "./schart-line.js";
import "./schart-scatter.js";
import { streamCharts } from "./client-core.js";
import { createDemoSubscription } from "./demo-datasets.js";

const subscriptions = [
  createDemoSubscription("alpha", {
    yBits: 16,
    persistent: true,
    viewXMin: 0,
    viewXMax: 60000,
    viewYMin: -2,
    viewYMax: 2
  }),
  createDemoSubscription("clusters", {
    xBits: 16,
    yBits: 16,
    persistent: true,
    opacity: 0.1,
    viewXMin: 0,
    //viewXMax: 60000,
    viewYMin: -0.1,
    viewYMax: 1.1
  })
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
