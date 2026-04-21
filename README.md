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
- `chart-element.js`: vanilla web component canvas chart
- `node-client.js`: dependency-free terminal renderer with a colored braille canvas

## Notes

- The reference line-chart stream sends only quantized `y` values with `interleaved = 0`.
- Clients reconstruct evenly spaced `x` positions from the subscribed `xMin` and `xMax` range.
