# KNX `0.xml` Parsing & Home Assistant Mapping Specification

This specification outlines how the ETS `0.xml` file should be parsed and translated into a valid Home Assistant YAML configuration (`knx.yaml`).

---

## 1. Core XML Structure & Address Conversion

ETS stores all KNX group addresses as integers inside the `Address` attribute. To convert this integer into Home Assistant's standard 3-level format (`X/Y/Z`), use the following bit-shifting and masking:

* **Main Group:** `(Address >> 11) & 0x1F` (Bits 11–15)
* **Middle Group:** `(Address >> 8) & 0x07` (Bits 8–10)
* **Sub Group:** `Address & 0xFF` (Bits 0–7)

*Example:* `Address="2048"` $\rightarrow$ `(2048 >> 11) & 31 = 1`, `(2048 >> 8) & 7 = 0`, `2048 & 255 = 0` $\rightarrow$ `"1/0/0"`.

---

## 2. Entity Identification & Mapping per Home Assistant Domain

Entity parsing is determined by evaluating a combination of the **Datapoint Type (DPT)** and the **Group Address Range (Main/Middle Group)**.

### 2.1 `light` (Lighting & Dimmers)
* **Identification:** DPT `DPST-1-1` within range `1/0/x` ($2048 - 2303$).
* **Channel Linking (Offsets):**
  * `address` (On/Off, 1-bit): `1/0/i`
  * `brightness_address` (Absolute Dimming, 1-byte): `1/2/i`
  * `brightness_state_address` (Brightness State, 1-byte): `1/4/i`
* **YAML Example:**
  ```yaml
  light:
    - name: "Office Ceiling Light"
      address: "1/0/0"
      brightness_address: "1/2/0"
      brightness_state_address: "1/4/0"

### 2.2 switch (Relays & Switches)
* Identification: DPT DPST-1-6 within range 0/0/x ($1 - 255$).
* Properties: Represents binary on/off loads (power sockets, switching relays).
* YAML Example:
```yaml
switch:
  - name: "Hallway Floor Socket"
    address: "0/0/4"
```

### 2.3 sensor (Measurement Values & Analog Sensors)
* Identification: DPT DPST-9-1 (2-byte float) or other numerical DPTs (e.g., DPT 7, 12, 13, 14).

* Types:
   * Temperature (DPST-9-1): type: temperature
   * Humidity (DPST-9-7): type: humidity
   * Lux/Illuminance (DPST-9-4): type: illuminance

YAML Example:
```yaml
sensor:
  - name: "Office Temperature"
    state_address: "3/0/0"
    type: temperature
```

### 2.4 binary_sensor (Digital Inputs & Alarm Zones)
* Identification: DPT DPST-1-1 / DPST-1-17 within alarm or status ranges (2/x/x).
* Usage: Motion detectors, door/window contacts, alarm zones.
* YAML Example:
```yaml
binary_sensor:
  - name: "Alarm Zone 1"
    state_address: "2/2/0"
```

### 2.5 climate (Thermostats & Underfloor Heating)
* Identification: Grouped addresses within the heating range (3/x/x).
* Channel Offsets:
   * temperature_address (Room Temp): 3/0/i (DPT 9.001)
   * target_temperature_address (Setpoint Control): 3/1/i (DPT 9.001)
   * target_temperature_state_address (Setpoint State): 3/2/i (DPT 9.001)
   * command_value_state_address (Valve Position %): 3/3/i (DPT 5.001)

YAML Example:
```yaml
climate:
  - name: "Office Heating"
    temperature_address: "3/0/0"
    target_temperature_address: "3/1/0"
    target_temperature_state_address: "3/2/0"
    command_value_state_address: "3/3/0"
```

### 2.6 cover (Blinds, Shutters & Curtains)
* Identification: DPT DPST-1-8 (Up/Down) and DPT DPST-5-1 (Position %).
* YAML Example:
```yaml
cover:
  - name: "Living Room Awning"
    move_long_address: "4/0/0"     # Up/Down
    stop_address: "4/1/0"          # Stop
    position_address: "4/2/0"      # Set position %
    position_state_address: "4/3/0"# Position feedback %
```

### 2.7 scene (Scenes)
* Identification: DPT DPST-18-1 (Scene Control, 8-bit).
* YAML Example:
```yaml
scene:
  - name: "Dinner Scene"
    address: "5/0/0"
    scene_number: 1
```

### 2.8 button (Virtual Buttons & Triggers)
* Identification: DPT DPST-1-1 (Sends a 1-bit impulse without state feedback).
* YAML Example:
```yaml
button:
  - name: "Reset Alarm"
    address: "2/0/0"
```

### 2.9 fan (Ventilation & Fans)
* Identification: DPT DPST-5-1 (Percentage/Step Speed) or DPT DPST-1-1 (On/Off).
* YAML Example:
```yaml
fan:
  - name: "Bathroom Fan"
    address: "6/0/0"
    percentage_address: "6/1/0"
    percentage_state_address: "6/2/0"
```

### 2.10 number (Adjustable Parameters)
* Identification: DPT DPST-5-1 (0–100%) or DPT DPST-7-1 (16-bit unsigned integer).
* YAML Example:
```yaml
number:
    - name: "Night Light Level"
    address: "7/0/0"
    state_address: "7/0/1"
    type: percent
    min: 0
    max: 100
```

### 2.11 select (Mode Selectors)
* Identification: DPT DPST-20-102 (HVAC Mode) or DPT DPST-5-1 (Enumerated modes).
* YAML Example:
```yaml
select:
    - name: "Ventilation Mode"
    address: "6/3/0"
    state_address: "6/3/1"
    options:
        - "Auto"
        - "Away"
        - "Party"
```

### 2.12 time, date, datetime (Time & Date Sync)
* Identification:
  * time: DPT DPST-10-1 (3-byte time)
  * date: DPT DPST-11-1 (3-byte date)
  * datetime: DPT DPST-19-1 (8-byte date & time)
* YAML Example:
```yaml
time:
    - name: "KNX System Time"
    address: "8/0/0"

date:
    - name: "KNX System Date"
    address: "8/0/1"
```

### 2.13 text (Text Displays & String Values)
* Identification: DPT DPST-16-1 (14-character ASCII string).
* YAML Example:
```yaml
text:
    - name: "Display Status Message"
    address: "8/1/0"
    state_address: "8/1/1"
```

### 2.14 weather (Weather Stations)
* Identification: Grouping of weather sensors (DPT 9.xxx).
* YAML Example:
```yaml
weather:
    - name: "Rooftop Weather Station"
    address_temperature: "9/0/0"
    address_brightness_south: "9/0/1"
    address_wind_speed: "9/0/2"
    address_rain_alarm: "9/0/3"
```

### 2.15 notify (Notifications)
* Identification: KNX text addresses intended for displays or alarm panels.
* YAML Example:
```yaml
notify:
    - name: "Hallway Display"
    address: "8/2/0"
```

### 3. Parsing Priority Rules
To prevent entities from being misclassified (e.g., creating a standalone switch out of a dimmer channel):

1. Check DPT First: If the DPT matches a specific type (e.g., DPST-9-1 for temperature, DPST-1-6 for relay), map accordingly.

2. Evaluate Group Range (Main/Middle):
  * 0/x/x: Relays, switches, power outputs
  * 1/x/x: Lighting (Switch / Dimmer / RGB)
  * 2/x/x: Alarms, zones, binary_sensors, button presses
  * 3/x/x: Climate, temperatures, setpoints
  * 4/x/x: Blinds, shutters, sun protection (cover)
  * 5/x/x: Scenes and mode controls
  * 6/x/x: Fans and ventilation (fan, select)
  * 8/x/x: Time, date, and system texts (time, date, text)
  * 9/x/x: Weather data (weather, sensor)

3 Link Related Channel Offsets: Do not create separate switch entities for addresses 1/2/x or 1/4/x if they are brightness control and state feedback for a light entity on 1/0/x.