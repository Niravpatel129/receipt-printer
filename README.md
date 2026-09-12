# Receipt Printer

## About

Receipt Printer is a cross-platform Electron desktop application for sending receipts to local thermal printers. It includes desktop packaging, update support, printer integration, and a React-based user interface.

## Tech stack

- Electron
- React
- Vite
- electron-builder
- electron-updater
- node-thermal-printer

## Development

Install dependencies:

```bash
npm install
```

Start the app:

```bash
npm start
```

Build application assets:

```bash
npm run build
```

Create desktop distributions:

```bash
npm run dist
```

Platform-specific distribution scripts are available for macOS and Windows in `package.json`.

## Hardware notes

Full printer testing requires a supported local or network thermal printer and the appropriate operating-system permissions/drivers.

## Detailed run instructions

See [`run_instruction.md`](./run_instruction.md) for complete build and execution details.
