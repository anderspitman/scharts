import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createSeriesState, generateSeriesBatch } from "./data.js";
import { getDemoDataset } from "./demo-datasets.js";
import { decodeSubscribe, encodeDataMessage, frameMessage } from "./protocol.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const STREAM_INTERVAL_MS = 100;
const DEFAULT_SAMPLE_COUNT = 96;
const STATIC_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/chart-base.js", "chart-base.js"],
  ["/demo-datasets.js", "demo-datasets.js"],
  ["/schart-line.js", "schart-line.js"],
  ["/schart-scatter.js", "schart-scatter.js"],
  ["/browser-client.js", "browser-client.js"],
  ["/client-core.js", "client-core.js"],
  ["/protocol.js", "protocol.js"]
]);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

function serveStatic(pathname, res) {
  const file = STATIC_FILES.get(pathname);
  if (!file) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  readFile(join(__dirname, file))
    .then((body) => {
      res.writeHead(200, {
        "content-type": CONTENT_TYPES[extname(file)] || "application/octet-stream",
        "cache-control": "no-store"
      });
      res.end(body);
    })
    .catch(() => {
      res.writeHead(500);
      res.end("Failed to load file");
    });
}

function validateSubscription(item) {
  if (!/^[A-Za-z0-9_-]+$/.test(item.key)) {
    throw new Error(`Invalid key: ${item.key}`);
  }
  if (!Number.isFinite(item.yMin) || !Number.isFinite(item.yMax) || item.yMin >= item.yMax) {
    throw new Error(`Invalid y range for ${item.key}`);
  }
  if (item.yBits < 1 || item.yBits > 32) {
    throw new Error(`Invalid bit width for ${item.key}`);
  }
  if (item.includeX === true) {
    if (!Number.isFinite(item.xMin) || !Number.isFinite(item.xMax) || item.xMin >= item.xMax) {
      throw new Error(`Invalid x range for ${item.key}`);
    }
    if (item.xBits < 1 || item.xBits > 32) {
      throw new Error(`Invalid x bit width for ${item.key}`);
    }
  }
}

function collectRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const sourceStates = new Map();
const clients = new Set();
let globalTick = 0;

function getSourceState(subscription) {
  const existing = sourceStates.get(subscription.key);
  if (existing) {
    return existing;
  }

  const dataset = getDemoDataset(subscription.key);
  if (!dataset) {
    throw new Error(`Unknown demo dataset: ${subscription.key}`);
  }

  const state = createSeriesState(dataset);
  sourceStates.set(subscription.key, state);
  return state;
}

function sendSeries(res, subscription, index, batch) {
  const message = encodeDataMessage(subscription, index, batch.points, {
    xOffset: batch.xOffset
  });
  res.write(Buffer.from(frameMessage(message)));
}

function broadcastTick(nextTick) {
  clients.forEach((client) => {
    client.subscriptions.forEach((subscription, index) => {
      const state = getSourceState(subscription);
      const dataset = getDemoDataset(subscription.key);
      const sampleCount = DEFAULT_SAMPLE_COUNT;
      const batch = generateSeriesBatch(dataset, state, nextTick, sampleCount);
      sendSeries(client.res, subscription, index, batch);
    });
  });
  globalTick = nextTick;
}

setInterval(() => {
  broadcastTick(globalTick + 1);
}, STREAM_INTERVAL_MS);

function streamData(req, res) {
  collectRequestBody(req)
    .then((body) => {
      const subscriptions = decodeSubscribe(new Uint8Array(body));
      subscriptions.forEach(validateSubscription);

      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "cache-control": "no-store",
        "transfer-encoding": "chunked"
      });

      const client = {
        req,
        res,
        subscriptions
      };
      clients.add(client);

      subscriptions.forEach((subscription, index) => {
        const state = getSourceState(subscription);
        const dataset = getDemoDataset(subscription.key);
        const batch = generateSeriesBatch(dataset, state, globalTick, DEFAULT_SAMPLE_COUNT);
        sendSeries(res, subscription, index, batch);
      });

      const close = () => {
        clients.delete(client);
      };
      req.on("close", close);
      res.on("close", close);
    })
    .catch((error) => {
      res.writeHead(400, {
        "content-type": "text/plain; charset=utf-8"
      });
      res.end(error.message);
    });
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;

  if (req.method === "POST" && pathname === "/stream") {
    streamData(req, res);
    return;
  }

  if (req.method === "GET") {
    serveStatic(pathname, res);
    return;
  }

  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
