# Build and Run Instructions

## Prerequisites

- Node.js 18 or newer
- npm
- A supported desktop OS and access to a receipt/thermal printer for printer functionality
- Native build tooling may be required for optional printer integrations

## Install

```bash
git clone https://github.com/Niravpatel129/receipt-printer.git
cd receipt-printer
npm install
```

For macOS dependency installation without optional native packages, the repository also provides:

```bash
npm run install:mac
```

## Build and run locally

```bash
npm start
```

This builds the Vite renderer and launches Electron.

## Development renderer watch

```bash
npm run dev
```

## Build distributable packages

Default targets:

```bash
npm run dist
```

macOS:

```bash
npm run dist:mac
```

Windows:

```bash
npm run dist:win
```

A 32-bit Windows build is available through `npm run dist:win:ia32`. The CI publishing command may upload release artifacts, so use it only when publishing is intended.