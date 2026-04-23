import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createSeriesState, generateSeriesBatch } from "./data.js";
import { decodeSubscribe, encodeDataMessage, frameMessage } from "./protocol.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const STATIC_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/chart-base.js", "chart-base.js"],
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

function streamData(req, res) {
  collectRequestBody(req)
    .then((body) => {
      const subscriptions = decodeSubscribe(new Uint8Array(body));
      subscriptions.forEach(validateSubscription);
      const states = subscriptions.map((subscription) => createSeriesState(subscription));

      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "cache-control": "no-store",
        "transfer-encoding": "chunked"
      });

      let tick = 0;
      const sendBatch = () => {
        subscriptions.forEach((subscription, index) => {
          const points = generateSeriesBatch(subscription, states[index], tick + index * 3, 96);
          const message = encodeDataMessage(subscription, index, points);
          res.write(Buffer.from(frameMessage(message)));
        });
        tick += 1;

        if (tick >= 600) {
          clearInterval(timer);
          res.end();
        }
      };

      sendBatch();
      const timer = setInterval(sendBatch, 100);

      const close = () => clearInterval(timer);
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
