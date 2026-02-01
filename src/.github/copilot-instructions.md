# Copilot Instructions for AI Agents

## Project Overview
This project is a Node.js-based control and monitoring system for a fermentor, with a clear separation between server-side device management and a browser-based client UI.

### Architecture
- **Server (`server/`)**: Handles device communication, process control, and data storage.
  - **Devices**: Each device type (illumination, pH, pumps, stirring, temperature, thermostat) has its own subdirectory and `device.js` implementation.
  - **Database**: Uses JSON and SQLite for process and batch data (`db/`).
  - **Config**: Hardware configuration in `config/hardware.json`.
- **Client (`client/`)**: Browser UI for control, visualization, and configuration.
  - **Pages**: Main entry points (`pages/`) for dashboard, control, and visualization.
  - **Components**: Modular UI panels for each device type (`components/`).
  - **Dialogs**: Configuration dialogs for device settings (`dialogs/`).
  - **Services**: `deviceStream.js` manages real-time device data.

## Key Patterns & Conventions
- **Device Abstraction**: Each device type is encapsulated in its own module. Device logic is not mixed between types.
- **Data Flow**: Server exposes device/process state to the client, likely via WebSockets or HTTP endpoints (see `deviceStream.js`).
- **UI Modularity**: Each device has a corresponding UI panel and config dialog.
- **Configuration**: Hardware and process settings are JSON-driven for easy modification.
- **No Monolithic Files**: Logic is split by device and concern.

## Developer Workflows
- **Start Server**: Run `node server/main.js` from the project root.
- **Client**: Open `client/index.html` or `client/control.html` in a browser.
- **Database**: Inspect/edit `db/active_batch.json` for current process state. Use `db/process_store.js` for process logic.
- **Hardware**: Update `config/hardware.json` to add or modify devices.

## Integration Points
- **Device Drivers**: Hardware-specific logic in `server/devices/*/device.js`.
- **I2C/Hardware**: Shared hardware logic in `server/hardware/` (e.g., `ezo_i2c.js`).
- **Client-Server Communication**: Real-time updates via `client/services/deviceStream.js`.

## Examples
- To add a new pump: Implement in `server/devices/pumps/`, add UI in `client/components/PumpPanel.js`, and update config.
- To change process logic: Edit `server/db/process_store.js`.

## Project-Specific Advice
- Follow the device-per-directory pattern for all new hardware.
- Keep UI and device logic decoupled.
- Use JSON for all configuration and state where possible.

---
For questions, review the structure above and check for similar patterns before introducing new ones. Reference device and UI modules for examples.
