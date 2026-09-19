# KNX2HOME Parser

This project is a **Next.js application** that converts KNX configuration files into **Home Assistant compatible YAML configuration**. It automatically detects entities (lights, switches, covers, sensors, …) and annotates them for direct use in Home Assistant.

## Key Features

- 🔍 **KNX Group Address Parsing**<br>
  Converts KNX addresses and DPTs into Home Assistant entities.
- 🔒 **Password-Protected Projects**<br>
  Opens ETS6 password-protected `.knxproj` files via Web Crypto (PBKDF2 + AES-256-CTR).
- ⚡ **Smart Heuristics**<br>
  Automatically guesses the correct entity type (light, switch, cover, sensor, …).
- 📝 **YAML Generator**<br>
  Produces valid Home Assistant configurations (`configuration.yaml` or packages).
- 🗂 **Aggregate View**<br>
  Combines related entities into logical sets (e.g., covers with state and position).
- 🎨 **Customizable Entities**<br>
  Allows manual adjustments and overrides for entity types and names.
- 🌍 **Next.js Frontend**<br>
  Web interface for uploading, previewing, and exporting configurations.
- 🔁 **Export/Import Configuration**<br>
   Save your parsed catalog plus manual overrides to a JSON file and load it later or share with colleagues; the snapshot button sits next to the reset/export controls in the workflow header and opens a modal/drawer so the workflow can be paused or shared from every step.
- 📦 **Home Assistant YAML Export**<br>
   Download a single combined YAML file or a ZIP with one YAML per domain plus a root `knx.yaml` that `!include`s them.

## Home Assistant YAML export

After parsing a KNX project, open the Export wizard to generate Home Assistant YAML. Select the entity types you want (switch, light, sensor, cover, scene, …) and choose a format.

Single file
- One YAML with a `knx:` section containing only the selected types.
- Filename uses your project/prefix, e.g. `My_Project_knx.yaml`.

ZIP per domain
- Root `knx.yaml` with `!include` lines for each selected domain.
- Per-domain files in `knx/`, e.g. `knx/knx_light.yaml`, `knx/knx_switch.yaml`.

Use in Home Assistant
- Copy files into your HA config folder. With ZIP, keep `knx.yaml` next to the `knx/` folder and reference it from `configuration.yaml`; or merge the generated `knx:` section into your existing config.
- Addresses and names are auto-quoted; What you export matches the UI preview, including overrides.

## Export/Import configuration

After you upload and parse a KNX project, you can:

- Export config: downloads a JSON snapshot containing the parsed catalog, your current options (like dropping Reserve), and all entity overrides. Use this to continue later or share your work.
- Import config: load a previously saved JSON to restore the catalog, options, and overrides. The Home Assistant YAML view will update immediately.

Use the header snapshot button (next to Reset) to open the modal or drawer that hosts the import/export controls—this keeps the snapshot workflow available on steps 1‑3 without extra page chrome.

## Development

For local development, follow these steps:

### 1. Requirements

At least the following software should be installed:

- Node.js 24 (LTS)+
- npm

### 2. Install dependencies

```bash
npm install
```

### 3. Start development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Build for production

```bash
npm run build
npm start
```

## Deployment

### Docker

The included `Dockerfile` builds the app and serves the static export with a tiny Node HTTP server. Run it locally with:

```bash
docker compose up --build
```

Then open [http://localhost:3000](http://localhost:3000).

To build and run the image manually:

```bash
docker build -t knx2home .
docker run -p 3000:3000 knx2home
```

### GitHub Pages

The CI workflow builds a static export (`./out`) and publishes it to GitHub Pages.

## Resources

## Resources

- [KNX Association](https://www.knx.org/)
- [Home Assistant KNX Integration](https://www.home-assistant.io/integrations/knx/)
- [Next.js Documentation](https://nextjs.org/docs)
