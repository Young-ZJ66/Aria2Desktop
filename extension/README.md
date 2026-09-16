# Aria2 Desktop Browser Extension

Chrome/Edge browser extension that intercepts downloads and sends them to Aria2 Desktop.

## Installation

### Development Mode
1. Open Chrome/Edge and navigate to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked" and select this `extension/` directory
4. The extension icon will appear in your toolbar

### Icons
Before publishing, replace the placeholder icons in `icons/` with proper PNG icons:
- `icon16.png` (16x16)
- `icon48.png` (48x48)
- `icon128.png` (128x128)

## Features

- **Context Menu**: Right-click any link, video, or audio and select "Download with Aria2 Desktop"
- **Download Interception**: Optionally intercept all browser downloads and send them to Aria2
- **Connection Management**: Configure Aria2 RPC host, port, and secret
- **Status Indicator**: Shows connection status to Aria2 Desktop

## Configuration

Click the extension icon to open the popup where you can:
- Set Aria2 RPC host and port (default: localhost:6800)
- Set RPC secret (if configured)
- Enable/disable the extension
- Toggle download interception
- Test the connection

## Requirements

- Aria2 Desktop must be running with RPC enabled
- Default RPC endpoint: `http://localhost:6800/jsonrpc`