# node-red-contrib-meross-mst100-200

Node-RED plugin for Meross MST100 and MST200 sprinkler control via Meross Cloud API.

## Features

- **Meross Cloud Login**: Secure login with MFA support, session caching (24h)
- **Device Discovery**: List all devices via cloud API
- **Hub Integration**: Control MST100 and MST200 sprinklers through Smart Hub
- **Working MST200 CLI path**: Uses `Appliance.Hub.ToggleX` for device-wide on/off and status
- **Auto-Discovery**: Hub IP is automatically detected from device list
- **CLI**: Test commands without Node-RED

## Installation

### From npm (recommended)

```bash
cd ~/.node-red
npm install node-red-contrib-meross-mst100-200
```

### From GitHub

```bash
cd ~/.node-red
npm install github:Chrischi/node-red-contrib-meross-mst100-200
```

### Local development

```bash
cd ~/.node-red
npm install /path/to/node-red-contrib-meross-mst100-200
```

Restart Node-RED after installation.

## Nodes

### Meross Cloud Config

Config node that stores credentials and manages login sessions.

| Property | Description |
|----------|-------------|
| Email | Your Meross account email |
| Password | Your Meross account password |
| MFA Code | 6-digit code (if 2FA enabled) |
| Base URL | Cloud endpoint (default: `https://iotx-eu.meross.com`) |

### Meross MST100 / MST200

Device node for sending commands.

| Property | Description |
|----------|-------------|
| Cloud | Reference to Meross Cloud Config |
| Command | Command to execute |
| Hub UUID | Smart Hub device UUID |
| Hub Host | Hub IP address (auto-detected if not set) |
| Sub Device ID | MST100 or MST200 sub-device ID |
| Channel | Valve channel for MST100, and for MST200 zone `1` or `2` |
| On/Off | Toggle sprinkler on/off |
| Duration | Watering duration in minutes |

## Commands

| Command | Description |
|---------|-------------|
| `listDevices` | List all cloud devices |
| `listSubDevices` | List hub sub-devices |
| `subStatus` | Get MST100 status, MST200 overall status, or MST200 zone query output |
| `subSwitch` | Turn sprinkler on/off |
| `status` | Get device status |
| `switch` | Toggle device on/off |
| `rawRequest` | Custom API request |

## CLI Usage

```bash
# Login and list all devices
node bin/meross-mst100.js \
  --email you@example.com \
  --password secret \
  --command listDevices

# Get hub sub-devices (find hub UUID from listDevices)
node bin/meross-mst100.js \
  --email you@example.com \
  --password secret \
  --command listSubDevices \
  --hub-id YOUR_HUB_UUID

# Get MST100 status
node bin/meross-mst100.js \
  --email you@example.com \
  --password secret \
  --command subStatus \
  --hub-host YOUR_HUB_IP \
  --hub-id YOUR_HUB_UUID \
  --sub-device-id SUB_DEVICE_ID

# Get MST200 overall status
node bin/meross-mst100.js \
  --email you@example.com \
  --password secret \
  --command subStatus \
  --hub-host YOUR_HUB_IP \
  --hub-id YOUR_HUB_UUID \
  --sub-device-id SUB_DEVICE_ID \
  --mst200

# Turn on sprinkler
node bin/meross-mst100.js \
  --email you@example.com \
  --password secret \
  --command subSwitch \
  --hub-host YOUR_HUB_IP \
  --hub-id YOUR_HUB_UUID \
  --sub-device-id SUB_DEVICE_ID \
  --onoff true

# Turn on MST100 with duration (minutes)
node bin/meross-mst100.js \
  --email you@example.com \
  --password secret \
  --command subSwitch \
  --hub-host YOUR_HUB_IP \
  --hub-id YOUR_HUB_UUID \
  --sub-device-id SUB_DEVICE_ID \
  --onoff true \
  --duration 30

# Turn MST200 on/off (device-wide)
node bin/meross-mst100.js \
  --email you@example.com \
  --password secret \
  --command subSwitch \
  --hub-host YOUR_HUB_IP \
  --hub-id YOUR_HUB_UUID \
  --sub-device-id SUB_DEVICE_ID \
  --onoff true \
  --mst200

# Turn MST200 zone 1 on for 5 seconds
node bin/meross-mst100.js \
  --email you@example.com \
  --password secret \
  --command subSwitch \
  --hub-host YOUR_HUB_IP \
  --hub-id YOUR_HUB_UUID \
  --sub-device-id SUB_DEVICE_ID \
  --channel 1 \
  --onoff true \
  --duration 5 \
  --mst200
```

If MFA is enabled, you'll be prompted for the 6-digit code on first run. The session is cached for 24 hours.

## Session Persistence

Login sessions are cached to avoid repeated logins:
- Location: `~/.node-red/meross-sessions.json` (or fallback to `~/.meross-sessions.json`)
- Duration: 24 hours
- Sessions are auto-loaded on startup

## How It Works

```
┌─────────────┐     ┌──────────────┐     ┌────────────┐
│  Node-RED   │────▶│  Meross api  │────▶│  Smart Hub │
│    Flow     │     │   (Login)    │     │  (local)   │
└─────────────┘     └──────────────┘     └────────────┘
                           │                    │
                     Get token & IP    Control MST100/MST200
```

1. **Cloud Login**: Authenticate with Meross cloud, get token/key
2. **Device List**: Request `/v1/Device/devList` to find Hub UUID and IP
3. **Sub-Devices**: Get MST100/MST200 IDs via `/v1/Hub/getSubDevices`
4. **Local Control**: Send commands directly to Hub via HTTP

## MST200 Notes

- `MST200` overall status and device-wide switching use `Appliance.Hub.ToggleX`
- `MST200` zone `1` and `2` switching use `Appliance.Control.Water` with `channels: [1|2]`
- Zone status responses are still more limited than MST100 status responses

## Example Flow

```json
[
  {
    "id": "cloud",
    "type": "meross cloud config",
    "name": "My Meross",
    "email": "you@example.com",
    "password": "secret"
  },
  {
    "id": "sprinkler",
    "type": "meross mst100",
    "cloud": "cloud",
    "command": "subSwitch",
    "hubId": "YOUR_HUB_UUID",
    "subDeviceId": "SUB_DEVICE_ID",
    "onoff": true
  }
]
```

## License

Apache License 2.0
