# scharts-server-c

C89/POSIX port of `../server.js`.

## Build

```bash
make -C scharts-server-c
```

## Run

From the repository root:

```bash
./scharts-server-c/scharts-server
```

Use a custom port:

```bash
PORT=9000 ./scharts-server-c/scharts-server
```

If you run the binary from another directory, set `SCHARTS_ROOT` to the
directory containing `index.html` and the JavaScript client files.
