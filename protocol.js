export const MESSAGE_SUBSCRIBE = 0;
export const MESSAGE_DATA = 1;
const MAX_UINT32 = 0xffffffff;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

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

function validateUint32(value, name) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_UINT32) {
    throw new RangeError(`${name} must be a uint32`);
  }
}

export function encodeSubscribe(subscription) {
  validateUint32(subscription.subscriptionId, "subscriptionId");

  const includeX = subscription.includeX === true;
  const keyBytes = textEncoder.encode(subscription.key);
  if (keyBytes.length > 255) {
    throw new RangeError(`Key too long: ${subscription.key}`);
  }

  let size = 1 + 4 + 1 + keyBytes.length + 1 + 8 + 8 + 1;
  if (includeX) {
    size += 8 + 8 + 1;
  }

  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  let offset = 0;

  view.setUint8(offset, MESSAGE_SUBSCRIBE);
  offset += 1;
  view.setUint32(offset, subscription.subscriptionId, true);
  offset += 4;

  view.setUint8(offset, keyBytes.length);
  offset += 1;
  bytes.set(keyBytes, offset);
  offset += keyBytes.length;
  view.setUint8(offset, includeX ? 1 : 0);
  offset += 1;
  if (includeX) {
    view.setFloat64(offset, subscription.xMin, true);
    offset += 8;
    view.setFloat64(offset, subscription.xMax, true);
    offset += 8;
    view.setUint8(offset, subscription.xBits);
    offset += 1;
  }
  view.setFloat64(offset, subscription.yMin, true);
  offset += 8;
  view.setFloat64(offset, subscription.yMax, true);
  offset += 8;
  view.setUint8(offset, subscription.yBits);

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

  const subscriptionId = view.getUint32(offset, true);
  offset += 4;

  const keyLength = view.getUint8(offset);
  offset += 1;
  const keyBytes = bytes.slice(offset, offset + keyLength);
  offset += keyLength;
  const includeX = view.getUint8(offset) === 1;
  offset += 1;
  const subscription = {
    subscriptionId,
    key: textDecoder.decode(keyBytes),
    includeX
  };
  if (includeX) {
    subscription.xMin = view.getFloat64(offset, true);
    subscription.xMax = view.getFloat64(offset + 8, true);
    subscription.xBits = view.getUint8(offset + 16);
    offset += 17;
  }
  subscription.yMin = view.getFloat64(offset, true);
  subscription.yMax = view.getFloat64(offset + 8, true);
  subscription.yBits = view.getUint8(offset + 16);

  return subscription;
}

export function encodeDataMessage(subscription, subscriptionId, points, options = {}) {
  validateUint32(subscriptionId, "subscriptionId");

  const includeX = subscription.includeX === true;
  const xOffset = options.xOffset;
  const includeXOffset = includeX === false && Number.isFinite(xOffset);
  const bitsPerSample = includeX ? (subscription.xBits + subscription.yBits) : subscription.yBits;
  const writer = new BitWriter(points.length * bitsPerSample);

  for (const point of points) {
    if (includeX) {
      writer.write(quantize(point.x, subscription.xMin, subscription.xMax, subscription.xBits), subscription.xBits);
    }
    writer.write(quantize(point.y, subscription.yMin, subscription.yMax, subscription.yBits), subscription.yBits);
  }

  const payload = writer.bytes;
  const headerSize = 1 + 4 + 4 + 1 + 1 + (includeXOffset ? 8 : 0);
  const bytes = new Uint8Array(headerSize + payload.length);
  const view = new DataView(bytes.buffer);

  view.setUint8(0, MESSAGE_DATA);
  view.setUint32(1, subscriptionId, true);
  view.setUint32(5, points.length, true);
  view.setUint8(9, includeX ? 1 : 0);
  view.setUint8(10, includeXOffset ? 1 : 0);
  let offset = 11;
  if (includeXOffset) {
    view.setFloat64(offset, xOffset, true);
    offset += 8;
  }
  bytes.set(payload, offset);

  return bytes;
}

export function decodeDataMessage(bytes, subscriptions) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = view.getUint8(0);
  if (type !== MESSAGE_DATA) {
    throw new Error(`Unexpected data message type: ${type}`);
  }

  const subscriptionId = view.getUint32(1, true);
  const sampleCount = view.getUint32(5, true);
  const includeX = view.getUint8(9) === 1;
  const includeXOffset = view.getUint8(10) === 1;
  const subscription = subscriptions instanceof Map
    ? subscriptions.get(subscriptionId)
    : subscriptions[subscriptionId];
  if (!subscription) {
    throw new Error(`Unknown subscription id: ${subscriptionId}`);
  }

  let offset = 11;
  let xOffset = 0;
  if (includeXOffset) {
    xOffset = view.getFloat64(offset, true);
    offset += 8;
  }

  const reader = new BitReader(bytes.slice(offset));
  const points = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const x = includeX
      ? dequantize(reader.read(subscription.xBits), subscription.xMin, subscription.xMax, subscription.xBits)
      : xOffset + i;
    const y = dequantize(reader.read(subscription.yBits), subscription.yMin, subscription.yMax, subscription.yBits);
    points.push({ x, y });
  }

  return {
    subscriptionId,
    key: subscription.key,
    includeX,
    includeXOffset,
    xOffset,
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
