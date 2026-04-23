# scharts

Reference implementation of the binary chart streaming protocol from `plan.md`.

## Run

Start the server:

```bash
npm start
```

Open the browser demo:

```text
http://localhost:8080/
```

Run the Node TUI client:

```bash
npm run client:node
```

Use a custom port:

```bash
PORT=9000 npm run client:node
```

## Files

- `protocol.js`: wire format encoding, decoding, bit packing, framing
- `server.js`: Node HTTP producer and static file server
- `client-core.js`: shared streaming client for Node and browser
- `browser-client.js`: browser entrypoint
- `chart-base.js`: shared canvas/layout logic for web components
- `schart-line.js`: line chart web component
- `schart-scatter.js`: scatter chart web component
- `node-client.js`: dependency-free terminal renderer with a colored braille canvas

## Notes

- Each subscribe item includes `includeX` as a client-controlled boolean.
- When `includeX` is omitted or `false`, the subscribe item only needs `key`, `yMin`, `yMax`, and `yBits`.
- When `includeX` is `true`, the subscribe item must also provide `xMin`, `xMax`, and `xBits`, and the producer includes explicit X samples in each data message.
