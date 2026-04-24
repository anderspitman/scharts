import "./schart-line.js";
import "./schart-scatter.js";
import { streamCharts } from "./client-core.js";
import { createDemoSubscription } from "./demo-datasets.js";

const subscriptions = [
  createDemoSubscription("alpha", {
    subscriptionId: 1,
    yBits: 16,
    persistent: true,
    viewXMin: 0,
    viewXMax: 60000,
    viewYMin: -2,
    viewYMax: 2
  }),
  createDemoSubscription("clusters", {
    subscriptionId: 2,
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

const subscriptionsById = new Map(subscriptions.map((subscription) => [subscription.subscriptionId, subscription]));
const chartsById = new Map([
  [subscriptions[0].subscriptionId, document.querySelector("schart-line")],
  [subscriptions[1].subscriptionId, document.querySelector("schart-scatter")]
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
  subscriptions,
  onMessage(message, stats) {
    if (stats) {
      lastStats = stats;
      updateStatus();
    }
    if (!message) {
      return;
    }

    const base = subscriptionsById.get(message.subscriptionId);
    const chart = chartsById.get(message.subscriptionId);
    if (!base || !chart) {
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
