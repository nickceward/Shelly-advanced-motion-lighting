Shelly Advanced Motion Lighting with
WLED Integration Release Version: 1.35.

Project Goal & Origin Story
While waiting for Shelly to release a new Wi-Fi based motion sensor, I wanted to see if I could
use older-generation technology (the original Shelly Motion sensors) combined with
new-generation software (Shelly Plus/Pro scripting) to iron out the bugs in our corridor lighting
that have frustrated us over the years of operation.
The primary goals were to:
● Make the original Shelly Motion sensors smarter.
● Prevent unwanted light turn-offs and state flickering.
● Implement a "cleaning mode" manual override.
● Apply custom brightness based on time of day and occupancy.
● Synchronize a WLED strip with the dimmer's state and allow for seasonal palettes and
effects.
● Allow for easy configuration to create the perfect lighting scene with smooth, adaptive
transitions.
Here is the end result: a highly customizable script that achieves all of these goals.
Key Features
● 🧠 Hybrid Adaptive Brightness: Automatically selects different brightness rules for
AM, PM, and Night periods. Within those periods, the brightness intelligently increases
with more frequent motion.
● 👀 True Multi-Sensor Hold: Supports multiple motion sensors and will only turn the
lights off after all sensors have been clear for a configurable "grace period."
● 👆 Smart Manual Overrides:
○ Single Press: Toggles the light on to its last brightness or off. A single press also
cancels any active manual hold.
○ Double Press: Instantly sets the light to 100% and activates a 30-minute
manual hold, disabling motion sensors. A second double-press will restart the
30-minute timer.
○ Long Press: Smoothly dims the light up and down.
● 💡 UI Motion Control: A Virtual Boolean switch is used to enable or disable motion
detection directly from the Shelly App UI, without ever having to stop the script or disable
the sensors themselves.
● 🎬 Synchronized & Advanced WLED Control: The WLED strip can be set to turn on
to a default solid color, or trigger a specific Effect, Preset, or Playlist on motion.
● ⚙️ Optional WLED Integration: Control of the WLED strip and its power supply can be
completely disabled with a single setting, allowing the script to be used in a dimmer-only
setup.

Hardware Compatibility
● Primary Device: A Shelly Plus/Pro device capable of running scripts (e.g., Shelly Pro
Dimmer 1/2 PM, Plus 0-10V Dimmer, Pro/Plus RGBW/DALI controllers).
● Sensors: One or more motion sensors that can call a URL. The original Shelly Motion
was used for development, but any model (e.g., Shelly Motion 2) or other brands will
work.
● (Optional) WLED: A WLED-controlled light strip and a Shelly Plug/Relay for its power
supply.
Installation & Configuration Guide
1. Shelly Device Configuration
1. Navigate to your primary Shelly device's settings.
2. Set Button type to One button dimming control. This ensures failsafe manual
control.
3. Crucially: Disable all native Schedules, Timers, and Scenes on the Shelly device to
prevent them from interfering with the script's logic.
4. Important: Ensure all button Action URLs are empty. The script handles button events
internally.
2. Script Installation & Configuration
1. Copy the entire V1.35.0 script below. https://pastebin.com/DtkVvvLL
2. In your Shelly device's web interface, go to the Scripts section.
3. Create a new script, paste the code, and save it.
4. Before starting, carefully edit the CONFIG block at the top of the script. You must fill in
the IP addresses and component IDs for your specific devices.
Start the script.
3. Motion Sensor Configuration
1. After starting the script, open the device Logs.
2. The script will print a startup banner with the exact URLs for your motion sensors.
3. Copy the Motion URL and End URL for each sensor.
4. In the settings for each motion sensor, paste these URLs into the corresponding I/O URL
Actions fields.
For Shelly BLU Motion: You must first pair the BLU sensor with your primary
Shelly device (which acts as a gateway). Then, you can create Actions within the
primary device's UI that are triggered by the BLU sensor's motion events. Use the
URLs from the script's log in these actions. For more details, see the Official Shelly
KB Article.

The CONFIG Object Explained
WLED & PSU Settings (WLED_CONFIG)
This entire section is optional. Set ENABLED: false to run the script in dimmer-only mode.
Javascript
WLED_CONFIG: {
ENABLED: true, // Set to false to disable all WLED &
PSU control
IP: "192.168.0.WLED", // IP address of your WLED controller
PSU_IP: "192.168.0.PSU", // IP address of the Shelly
controlling the PSU
PSU_SWITCH_ID: 0, // The component ID of the switch on
the PSU Shelly
// --- WLED SCENE ON MOTION ---
// The script uses the first option set to a number > 0, in this
priority:
// 1. Playlist, 2. Preset, 3. Effect, 4. Default Solid Color.
// Leave at 0 to ignore.
WLED_PLAYLIST_ON_MOTION: 0,
WLED_PRESET_ON_MOTION: 0,
WLED_EFFECT_ON_MOTION: 0,
DEFAULT_WLED_COLOR_ON_MOTION: { // The fallback solid color if
others are 0.
cct: 127 // 127 = Warm White for RGBW
strips.
}
},

Adaptive Brightness (HYBRID_ADAPTIVE)
This is where you define the core "smart" behavior.
Javascript
NIGHT_ADAPTIVE_DISABLED: false, // If true, uses a single brightness
at night.
AM_PERIOD: {
startHour:6, endHour:17, DEFAULT_BRI:20,
STEPS:[
// --- This is where you create your rules ---
{ triggers: 1, brightness: 20 },
{ triggers: 3, brightness: 40 },
{ triggers: 6, brightness: 60 }

]
