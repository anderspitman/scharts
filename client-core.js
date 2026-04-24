import {
  decodeDataMessage,
  encodeSubscribe,
  extractFrames,
  frameMessage
} from "./protocol.js";

function concatBytes(a, b) {
  const joined = new Uint8Array(a.length + b.length);
  joined.set(a, 0);
  joined.set(b, a.length);
  return joined;
}

function concatByteChunks(chunks) {
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

function encodeSubscribeMessages(subscriptions) {
  return concatByteChunks(subscriptions.map((subscription) => frameMessage(encodeSubscribe(subscription))));
}

export async function streamCharts({ url, subscriptions, onMessage, signal }) {
  const bitrateWindowMs = 1000;
  let bytesReceived = 0;
  let messageCount = 0;
  const bitrateSamples = [];
  const subscriptionsById = new Map(subscriptions.map((subscription) => [subscription.subscriptionId, subscription]));
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream"
    },
    body: encodeSubscribeMessages(subscriptions),
    signal
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  if (!response.body) {
    throw new Error("Response body is not a stream");
  }

  const reader = response.body.getReader();
  let remainder = new Uint8Array(0);

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    bytesReceived += value.length;
    remainder = concatBytes(remainder, value);
    const extracted = extractFrames(remainder);
    remainder = extracted.remainder;
    const now = Date.now();
    bitrateSamples.push({
      timeMs: now,
      bytesReceived
    });
    while (bitrateSamples.length > 1 && (now - bitrateSamples[0].timeMs) > bitrateWindowMs) {
      bitrateSamples.shift();
    }

    const oldestSample = bitrateSamples[0];
    const windowMs = Math.max(now - oldestSample.timeMs, 1);
    const windowBytes = bytesReceived - oldestSample.bytesReceived;
    const stats = {
      bytesReceived,
      bitrateBps: (windowBytes * 8000) / windowMs,
      messageCount
    };

    for (const frame of extracted.frames) {
      messageCount += 1;
      stats.messageCount = messageCount;
      onMessage(decodeDataMessage(frame, subscriptionsById));
    }

    if (typeof onMessage === "function") {
      onMessage(null, stats);
    }
  }
}
