# Protocol

It is a serialization protocol for sending visualization data. Normally
remotely but it could also work locally and even in-process.

It's designed to minimize bandwidth by taking advantage of the fact that
screens have a limited number of pixels, so in theory we don't need to send
more data than can be displayed by the current charts.

The format is binary.

Everything is communicated via message passing over a transport.

A transport is assumed to provide framing between messages, such as
WebSockets, length-prefixed TCP, length-prefixed HTTP, etc.

All values are little endian.


## Messages

There are data producers and data consumers. When a consumer connects to a
producer, it sends a message indicating what data it wants to subscribe to:

```
Message type (8 bits) - 0 (SUBSCRIBE)
nDataItems (32 bits) - uint32
```

The subscribe message consists of a list of data items the consumer is
interested in.

Data items are identified by ASCII strings, alphanumeric plus dashes and
underscores.

Each member of the list has this info:

```
Data key length (8 bits) - N (max 255 characters in a key)
Data key value (N*8 bits) - ASCII string of data key
includeX (8 bits) - boolean. indicates if X values are included
if includeX:
  xMin (64 bits) - float64
  xMax (64 bits) - float64
  xBits (8 bits) - uint8 number of bits per data value
yMin (64 bits) - float64
yMax (64 bits) - float64
yBits (8 bits) - uint8 number of bits per data value
```

When producers send data to consumers, data keys are not returned directly.
Instead, indices are used, in the same order as the data items are requested
in the SUBSCRIBE message.

Producer data messages have the following format:

```
Message type (8 bits) - uint8 1 (DATA)
Data index (32 bits) - uint32 corresponding to ordinal data key
Sample count (32 bits) - uint32 number of packed samples
includeX (8 bits) - boolean. indicates if X values are included
Packed data array (N bits)
```

Data arrays are packed such that each value is quantized into yBits, where
yMin is mapped to 0, and yMax is mapped to (2^yBits) - 1. Values outside the
range should be clamped. -Inf/Inf should be clamped. NaN should be mapped to
-Inf. In practice, it's expected that charts will not display the min and max
values, so things still look good even with spurious values. Round to nearest.

Same for xBits, but that's only used if includeX is true.

Pack sub-bytes MSB first.

Zero pad any extra bytes.

When includeX, packed values are ordered x0, y0, x1, y1, ...


## Transport

When running on HTTP, assume a single long-lived request per consumer. Messages
are framed by uint32 size. The request will be a single POST, where the body
consists of the SUBSCRIBE message. We'll assume just the single message for now
because current browsers/servers don't play nice with streaming requests.


# Instructions

Build a simple reference implementation of this in javascript. There should be
a nodejs HTTP server that generates some dummy line chart data. There should
be a client that works in node or the browser.

The browser client should use a vanilla js web component chart.

The node client should render a simple TUI chart.

Don't use any dependencies.

Tell me what your plan is and ask for approval before you proceed.
