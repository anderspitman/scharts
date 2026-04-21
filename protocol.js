export const MESSAGE_SUBSCRIBE = 0;
export const MESSAGE_DATA = 1;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sanitizeNumber(value) {
  if (Number.isNaN(value)) {
    return Number.NEGATIVE_INFINITY;
  }
  return value;
}

function quantize(value, min, max, bits) {
  if (bits < 1 || bits > 32) {
    throw new RangeError(`Unsupported bit width: ${bits}`);
  }
  const maxInt = (2 ** bits) - 1;
  const safeValue = sanitizeNumber(value);
  const safeMin = sanitizeNumber(min);
  const safeMax = sanitizeNumber(max);
  const bounded = clamp(safeValue, safeMin, safeMax);

  if (safeMax === safeMin) {
    return 0;
  }

  const ratio = (bounded - safeMin) / (safeMax - safeMin);
  return clamp(Math.round(ratio * maxInt), 0, maxInt);
}

function dequantize(value, min, max, bits) {
  const maxInt = (2 ** bits) - 1;
  if (maxInt === 0 || max === min) {
    return min;
  }
  return min + ((max - min) * value) / maxInt;
}

class BitWriter {
  constructor(bitCount) {
    this.bytes = new Uint8Array(Math.ceil(bitCount / 8));
    this.bitOffset = 0;
  }

  write(value, bits) {
    const bigValue = BigInt(value >>> 0);
    for (let i = bits - 1; i >= 0; i -= 1) {
      const bit = Number((bigValue >> BigInt(i)) & 1n);
      const byteIndex = this.bitOffset >> 3;
      const bitIndex = 7 - (this.bitOffset & 7);
      this.bytes[byteIndex] |= bit << bitIndex;
      this.bitOffset += 1;
    }
  }
}

class BitReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.bitOffset = 0;
  }

  read(bits) {
    let value = 0n;
    for (let i = 0; i < bits; i += 1) {
      const byteIndex = this.bitOffset >> 3;
      const bitIndex = 7 - (this.bitOffset & 7);
      value = (value << 1n) | BigInt((this.bytes[byteIndex] >> bitIndex) & 1);
      this.bitOffset += 1;
    }
    return Number(value);
  }
}

export function encodeSubscribe(items) {
  let size = 1 + 4;
  for (const item of items) {
    const keyBytes = new TextEncoder().encode(item.key);
    if (keyBytes.length > 255) {
      throw new RangeError(`Key too long: ${item.key}`);
    }
    size += 1 + keyBytes.length + 8 + 8 + 1 + 8 + 8 + 1;
  }

  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  let offset = 0;

  view.setUint8(offset, MESSAGE_SUBSCRIBE);
  offset += 1;
  view.setUint32(offset, items.length, true);
  offset += 4;

  for (const item of items) {
    const keyBytes = new TextEncoder().encode(item.key);
    view.setUint8(offset, keyBytes.length);
    offset += 1;
    bytes.set(keyBytes, offset);
    offset += keyBytes.length;
    view.setFloat64(offset, item.xMin, true);
    offset += 8;
    view.setFloat64(offset, item.xMax, true);
    offset += 8;
    view.setUint8(offset, item.xBits);
    offset += 1;
    view.setFloat64(offset, item.yMin, true);
    offset += 8;
    view.setFloat64(offset, item.yMax, true);
    offset += 8;
    view.setUint8(offset, item.yBits);
    offset += 1;
  }

  return bytes;
}

export function decodeSubscribe(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const type = view.getUint8(offset);
  offset += 1;

  if (type !== MESSAGE_SUBSCRIBE) {
    throw new Error(`Unexpected subscribe message type: ${type}`);
  }

  const count = view.getUint32(offset, true);
  offset += 4;
  const items = [];

  for (let i = 0; i < count; i += 1) {
    const keyLength = view.getUint8(offset);
    offset += 1;
    const keyBytes = bytes.slice(offset, offset + keyLength);
    offset += keyLength;
    items.push({
      key: new TextDecoder().decode(keyBytes),
      xMin: view.getFloat64(offset, true),
      xMax: view.getFloat64(offset + 8, true),
      xBits: view.getUint8(offset + 16),
      yMin: view.getFloat64(offset + 17, true),
      yMax: view.getFloat64(offset + 25, true),
      yBits: view.getUint8(offset + 33)
    });
    offset += 34;
  }

  return items;
}

export function encodeDataMessage(subscription, index, points, interleaved = true) {
  const bitsPerSample = interleaved ? (subscription.xBits + subscription.yBits) : subscription.yBits;
  const writer = new BitWriter(points.length * bitsPerSample);

  for (const point of points) {
    if (interleaved) {
      writer.write(quantize(point.x, subscription.xMin, subscription.xMax, subscription.xBits), subscription.xBits);
    }
    writer.write(quantize(point.y, subscription.yMin, subscription.yMax, subscription.yBits), subscription.yBits);
  }

  const payload = writer.bytes;
  const bytes = new Uint8Array(1 + 4 + 4 + 1 + payload.length);
  const view = new DataView(bytes.buffer);

  view.setUint8(0, MESSAGE_DATA);
  view.setUint32(1, index, true);
  view.setUint32(5, points.length, true);
  view.setUint8(9, interleaved ? 1 : 0);
  bytes.set(payload, 10);

  return bytes;
}

export function decodeDataMessage(bytes, subscriptions) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = view.getUint8(0);
  if (type !== MESSAGE_DATA) {
    throw new Error(`Unexpected data message type: ${type}`);
  }

  const index = view.getUint32(1, true);
  const sampleCount = view.getUint32(5, true);
  const interleaved = view.getUint8(9) === 1;
  const subscription = subscriptions[index];
  if (!subscription) {
    throw new Error(`Unknown subscription index: ${index}`);
  }

  const reader = new BitReader(bytes.slice(10));
  const points = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const x = interleaved
      ? dequantize(reader.read(subscription.xBits), subscription.xMin, subscription.xMax, subscription.xBits)
      : subscription.xMin + ((subscription.xMax - subscription.xMin) * i) / Math.max(1, sampleCount - 1);
    const y = dequantize(reader.read(subscription.yBits), subscription.yMin, subscription.yMax, subscription.yBits);
    points.push({ x, y });
  }

  return {
    index,
    key: subscription.key,
    interleaved,
    points
  };
}

export function frameMessage(messageBytes) {
  const framed = new Uint8Array(4 + messageBytes.length);
  const view = new DataView(framed.buffer);
  view.setUint32(0, messageBytes.length, true);
  framed.set(messageBytes, 4);
  return framed;
}

export function extractFrames(buffer) {
  const frames = [];
  let offset = 0;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  while (offset + 4 <= buffer.length) {
    const size = view.getUint32(offset, true);
    if (offset + 4 + size > buffer.length) {
      break;
    }
    frames.push(buffer.slice(offset + 4, offset + 4 + size));
    offset += 4 + size;
  }

  return {
    frames,
    remainder: buffer.slice(offset)
  };
}
