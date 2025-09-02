
************************************************************
 * Shelly Advanced Motion Lighting with WLED Integration
 * Version: 1.35.0
 *
 * This script transforms a Shelly Dimmer into a sophisticated,
 * multi-device lighting controller. It is feature-complete,
 * stable, and highly customizable.
 ************************************************************/

var SCRIPT_VERSION = "V1.35.0";

/*** CONFIG ***/
var CONFIG = {
    // Set to 0 if your device's time is already local.
    // Set to your local offset from UTC if needed (e.g., London=0, Berlin=1, Malta=2).
    TIMEZONE_OFFSET_HOURS: 0,

    WLED_CONFIG: {
        ENABLED: true,
        IP: "192.168.0.WLED",
        PSU_IP: "192.168.0.PSU",
        PSU_SWITCH_ID: 0,
        WLED_PLAYLIST_ON_MOTION: 0,
        WLED_PRESET_ON_MOTION: 0,
        WLED_EFFECT_ON_MOTION: 0,
        DEFAULT_WLED_COLOR_ON_MOTION: { cct: 127 }
    },

    DEVICES: {
        LIGHT_ID: 0, // The ID of the light output on this Shelly device
        INPUT_ID: 0  // The ID of the physical switch input on this Shelly device
    },
    HYBRID_ADAPTIVE: {
        ENABLED: true,
        WINDOW_S: 600,
        NIGHT_ADAPTIVE_DISABLED: false,
        AM_PERIOD: {
            startHour: 6, endHour: 17,
            DEFAULT_BRI_DIMMER: 20,
            DEFAULT_BRI_WLED: 20,
            DEFAULT_TRANSITION_DIMMER_MS: 5000,
            DEFAULT_TRANSITION_WLED_MS: 2500,
            STEPS: [
                { triggers: 1, brightness: 20, transitionDimmerMs: 8000, transitionWledMs: 1000 },
                { triggers: 3, brightness: 40 },
                { triggers: 6, brightness: 60, transitionDimmerMs: 500, transitionWledMs: 500 }
            ]
        },
        PM_PERIOD: {
            startHour: 17, endHour: 22,
            DEFAULT_BRI_DIMMER: 15,
            DEFAULT_BRI_WLED: 15,
            DEFAULT_TRANSITION_DIMMER_MS: 6000,
            DEFAULT_TRANSITION_WLED_MS: 3000,
            STEPS: [
                { triggers: 1, brightness: 15 },
                { triggers: 5, brightnessDimmer: 30, brightnessWled: 20 },
                { triggers: 10, brightness: 40 }
            ]
        },
        NIGHT_PERIOD: {
            startHour: 22, endHour: 6,
            DEFAULT_BRI_DIMMER: 2,
            DEFAULT_BRI_WLED: 2,
            DEFAULT_TRANSITION_DIMMER_MS: 12000,
            DEFAULT_TRANSITION_WLED_MS: 6000,
            STEPS: [
                { triggers: 1, brightness: 2 },
                { triggers: 3, brightnessDimmer: 20, brightnessWled: 3 },
                { triggers: 6, brightness: 10 }
            ]
        }
    },
    TIMERS: {
        END_HOLD_S: 12,
        MANUAL_HOLD_S: 1800,
        PSU_KEEPALIVE_S: 600,
        PSU_STABILIZATION_DELAY_MS: 100
    },
    MANUAL_TRANSITIONS_MS: {
        ON: 300,
        OFF: 1500
    },
    SENSORS: [
        { id: "1", status_url: "http://192.168.0.SENSOR1/status" },
        { id: "2", status_url: "http://192.168.0.SENSOR2/status" }
    ],
    VBOOL_MOTION: 200,
    LOG: { DEBUG: true },
    SYNC: {
        POLL_MS: 2000
    }
};

/*** STATE ***/
var STATE = {
    triggers: [],
    manualHold: false,
    isDimming: false,
    sensors: {},
    timers: { endHold: null, manualHold: null, syncLoop: null },
    scriptIsControlling: false,
    syncBusy: false,
    lastWledPct: -1,
    lastMotionBri: -1
};

/*** UTILS ***/
function log() { if (!CONFIG.LOG.DEBUG) return; var o = ""; for (var i = 0; i < arguments.length; i++) o += (i ? " " : "") + String(arguments[i]); print(o); }
function toMinSec(s) { var m = Math.floor(s / 60); var sec = s % 60; return String(m) + "m " + String(sec) + "s"; }
function nowMs() { return Date.now(); }
function httpGET(url, timeout, cb) { var params = { url: url }; if (timeout) { params.timeout = timeout; }; Shelly.call("HTTP.GET", params, function (r) { if (cb) cb(r); }); }
function httpPOST(url, bodyObj, cb) { Shelly.call("HTTP.POST", { url: url, body: JSON.stringify(bodyObj) }, function (r) { if (cb) cb(r); }); }
function lightSet(on, bri, trans, extra, cb) { var p = { id: CONFIG.DEVICES.LIGHT_ID, on: !!on }; if (typeof bri === "number" && bri !== null) p.brightness = bri; if (typeof trans === "number" && trans !== null) p.transition = trans; if (extra && typeof extra.toggle_after === "number") p.toggle_after = extra.toggle_after; STATE.scriptIsControlling = true; Shelly.call("Light.Set", p, function (r) { Timer.set(500, false, function () { STATE.scriptIsControlling = false; }); if (cb) cb(r); }); }
function lightGet(cb) { Shelly.call("Light.GetStatus", { id: CONFIG.DEVICES.LIGHT_ID }, function (st) { if (cb) cb(st); }); }
function psuOn(opts, cb) {
    if (!CONFIG.WLED_CONFIG.ENABLED) { if (cb) { cb(); } return; }
    var rpcUrl = "http://" + CONFIG.WLED_CONFIG.PSU_IP + "/rpc";
    var rpcBody = { id: 1, method: "Switch.Set", params: { id: CONFIG.WLED_CONFIG.PSU_SWITCH_ID, on: true } };
    if (opts && typeof opts.toggle_after_s === "number") { rpcBody.params.toggle_after = opts.toggle_after_s; }
    httpPOST(rpcUrl, rpcBody, cb);
}
function wledOnForPct(pct, transitionMs, isMotion, cb) {
    if (!CONFIG.WLED_CONFIG.ENABLED) { if (cb) { cb(); } return; }
    var bri = Math.round(pct * 255 / 100);
    if (bri < 1 && pct > 0) bri = 1;
    var trans = Math.round((transitionMs || 0) / 100);
    STATE.lastWledPct = pct;
    var payload = { on: true, bri: bri, transition: trans };

    var wc = CONFIG.WLED_CONFIG;
    if (isMotion) {
        if (wc.WLED_PLAYLIST_ON_MOTION > 0) { payload.pl = wc.WLED_PLAYLIST_ON_MOTION; }
        else if (wc.WLED_PRESET_ON_MOTION > 0) { payload.ps = wc.WLED_PRESET_ON_MOTION; }
        else if (wc.WLED_EFFECT_ON_MOTION > 0) { payload.fx = wc.WLED_EFFECT_ON_MOTION; }
        else { for (var key in wc.DEFAULT_WLED_COLOR_ON_MOTION) { payload[key] = wc.DEFAULT_WLED_COLOR_ON_MOTION[key]; } }
    } else {
        for (var key in wc.DEFAULT_WLED_COLOR_ON_MOTION) { payload[key] = wc.DEFAULT_WLED_COLOR_ON_MOTION[key]; }
    }

    httpPOST("http://" + wc.IP + "/json/state", payload, cb);
}
function wledOff(transitionMs, cb) {
    if (!CONFIG.WLED_CONFIG.ENABLED) { if (cb) { cb(); } return; }
    STATE.lastWledPct = 0;
    var trans = Math.round((transitionMs || 0) / 100);
    httpPOST("http://" + CONFIG.WLED_CONFIG.IP + "/json/state", { on: false, transition: trans }, cb);
}
function vboolGet(cb) { Shelly.call("Boolean.GetStatus", { id: CONFIG.VBOOL_MOTION }, function (r) { if (r && typeof r.value === "boolean") cb && cb(r.value); else vboolSet(true, null, function () { cb && cb(true); }); }); }
function vboolSet(val, cb) { var p = { id: CONFIG.VBOOL_MOTION, value: !!val }; Shelly.call("Boolean.Set", p, function (r) { if (cb) cb(r); }); }
function clearTimer(n) { if (STATE.timers[n]) { Timer.clear(STATE.timers[n]); STATE.timers[n] = null; } }
function setOnce(n, ms, fn) { clearTimer(n); STATE.timers[n] = Timer.set(ms, false, function () { STATE.timers[n] = null; if (fn) fn(); }); }
function parseQuery(q_str) { var r = {}; if (q_str) { var a = q_str.split('&'); for (var i = 0; i < a.length; i++) { var b = a[i].split('='); r[b[0]] = (b[1] || ''); } } return r; }
function isAnySensorActive() { for (var id in STATE.sensors) { if (STATE.sensors[id]) return true; } return false; }

/*** ADAPTIVE BRIGHTNESS ***/
function pushTrigger() { var t = nowMs(); var win = CONFIG.HYBRID_ADAPTIVE.WINDOW_S * 1000; STATE.triggers.push(t); var cutoff = t - win, kept = []; for (var i = 0; i < STATE.triggers.length; i++) { if (STATE.triggers[i] >= cutoff) { kept.push(STATE.triggers[i]); } } STATE.triggers = kept; return STATE.triggers.length; }
function computeAdaptiveScene() {
    var C = CONFIG.HYBRID_ADAPTIVE;
    var hour = new Date().getHours();
    var localHour = (hour + CONFIG.TIMEZONE_OFFSET_HOURS + 24) % 24;
    var period;
    if (localHour >= C.PM_PERIOD.startHour && localHour < C.PM_PERIOD.endHour) { period = C.PM_PERIOD; }
    else if (localHour >= C.AM_PERIOD.startHour && localHour < C.AM_PERIOD.endHour) { period = C.AM_PERIOD; }
    else { period = C.NIGHT_PERIOD; }
    var scene = {
        brightnessDimmer: period.DEFAULT_BRI_DIMMER,
        brightnessWled: period.DEFAULT_BRI_WLED,
        dimmerTransMs: period.DEFAULT_TRANSITION_DIMMER_MS,
        wledTransMs: period.DEFAULT_TRANSITION_WLED_MS
    };
    var isNight = (period === C.NIGHT_PERIOD);
    if (isNight && C.NIGHT_ADAPTIVE_DISABLED) { return scene; }
    var n = STATE.triggers.length;
    for (var i = period.STEPS.length - 1; i >= 0; i--) {
        var s = period.STEPS[i];
        if (n >= s.triggers) {
            if (typeof s.brightnessDimmer !== 'undefined') {
                scene.brightnessDimmer = s.brightnessDimmer;
                scene.brightnessWled = s.brightnessWled;
            } else {
                scene.brightnessDimmer = s.brightness;
                scene.brightnessWled = s.brightness;
            }
            if (typeof s.transitionDimmerMs !== 'undefined') { scene.dimmerTransMs = s.transitionDimmerMs; }
            if (typeof s.transitionWledMs !== 'undefined') { scene.wledTransMs = s.transitionWledMs; }
            return scene;
        }
    }
    return scene;
}

/*** WLED SYNC LOOP ***/
function startSyncLoop() {
    if (!CONFIG.WLED_CONFIG.ENABLED) return;
    clearTimer("syncLoop");
    STATE.timers.syncLoop = Timer.set(CONFIG.SYNC.POLL_MS, true, function () {
        if (STATE.syncBusy || STATE.isDimming) return;
        STATE.syncBusy = true;
        lightGet(function (st) {
            STATE.syncBusy = false;
            if (!st) return;
            var on = !!st.output;
            var bri = (typeof st.brightness === "number") ? st.brightness : (on ? 100 : 0);
            if (!on) {
                if (STATE.lastWledPct !== 0) wledOff(CONFIG.MANUAL_TRANSITIONS_MS.OFF);
                clearTimer("syncLoop");
                return;
            }
            if (bri !== STATE.lastWledPct) {
                wledOnForPct(bri, CONFIG.MANUAL_TRANSITIONS_MS.ON, false, function () { });
            }
        });
    });
}

/*** CORE LOGIC ***/
function onMotion(sensorId) {
    clearTimer("endHold");
    STATE.sensors[sensorId] = true;
    vboolGet(function (motionEnabled) {
        if (!motionEnabled || STATE.manualHold) { log("Motion ignored (disabled/manual) from:", sensorId); return; }
        var cnt = pushTrigger();
        var scene = computeAdaptiveScene();
        STATE.lastMotionBri = scene.brightnessDimmer;
        log("Motion from:", sensorId, "| Triggers:", cnt, "| Dimmer Bri:", scene.brightnessDimmer, "% | WLED Bri:", scene.brightnessWled, "%");
        psuOn(null, function () {
            Timer.set(CONFIG.TIMERS.PSU_STABILIZATION_DELAY_MS, false, function () {
                lightSet(true, scene.brightnessDimmer, scene.dimmerTransMs, null, function () {
                    wledOnForPct(scene.brightnessWled, scene.wledTransMs, true, function () {
                        startSyncLoop();
                    });
                });
            });
        });
    });
}

function onMotionEnd(sensorId) {
    if (typeof STATE.sensors[sensorId] !== 'undefined') { STATE.sensors[sensorId] = false; log("MotionEnd from sensor:", sensorId); }
    Timer.set(250, false, function () {
        if (isAnySensorActive()) { log("Holding OFF, other sensors still active."); return; }
        lightGet(function (st) {
            if (!st || !st.output) return;
            vboolGet(function (motionEnabled) {
                if (!motionEnabled || STATE.manualHold) { return; }
                var duration = toMinSec(CONFIG.TIMERS.END_HOLD_S);
                log("ALL sensors clear. Starting end-hold timer:", duration);
                setOnce("endHold", CONFIG.TIMERS.END_HOLD_S * 1000, function () {
                    log("End-hold timer expired. Turning light off.");
                    lightSet(false, null, CONFIG.MANUAL_TRANSITIONS_MS.OFF);
                });
            });
        });
    });
}

/*** EVENT HANDLERS ***/
Shelly.addEventHandler(function (e) {
    if (!e || !e.info || e.component !== "input:" + CONFIG.DEVICES.INPUT_ID) return;
    if (e.info.event === "double_push") {
        log("EVENT: Double press detected. Activating manual hold.");
        clearTimer("endHold");
        STATE.manualHold = true;
        var duration = toMinSec(CONFIG.TIMERS.MANUAL_HOLD_S);
        log("Manual hold will be active for", duration);
        vboolSet(false);
        setOnce("manualHold", CONFIG.TIMERS.MANUAL_HOLD_S * 1000, function () {
            log("Manual hold software timer expired.");
            STATE.manualHold = false;
            vboolSet(true);
            lightGet(function (st) { if (st && st.output) lightSet(false, null, CONFIG.MANUAL_TRANSITIONS_MS.OFF); });
        });
    } else if (e.info.event === "long_push") {
        log("EVENT: Long press detected. Pausing sync loop.");
        STATE.isDimming = true;
        clearTimer("syncLoop");
    } else if (e.info.event === "btn_up") {
        if (STATE.isDimming) {
            log("EVENT: Long press ended (btn_up). Finalizing sync.");
            STATE.isDimming = false;
            Timer.set(250, false, function () {
                startSyncLoop();
            });
        }
    }
});

Shelly.addStatusHandler(function (e) {
    if (e.component !== "light:" + CONFIG.DEVICES.LIGHT_ID) return;
    if (STATE.scriptIsControlling) { return; }

    if (typeof e.delta.output === "boolean") {
        if (e.delta.output === true) {
            var brightness = (e.status && typeof e.status.brightness !== 'undefined') ? e.status.brightness : 0;
            log("STATUS: Light is ON (source:", e.delta.source, "). Syncing secondary devices.");

            if (e.delta.source === "button" || e.delta.source === "dim" || e.delta.source === "double") {
                clearTimer("endHold");
                if (!STATE.manualHold) { vboolSet(true); }
            }
            psuOn(null, function () {
                Timer.set(CONFIG.TIMERS.PSU_STABILIZATION_DELAY_MS, false, function () {
                    wledOnForPct(brightness, CONFIG.MANUAL_TRANSITIONS_MS.ON, false, function () {
                        startSyncLoop();
                    });
                });
            });
        } else {
            log("STATUS: Light is OFF (source:", e.delta.source, "). Resetting all states.");
            clearTimer("endHold");
            clearTimer("manualHold");
            STATE.manualHold = false;
            vboolSet(true);
            wledOff(CONFIG.MANUAL_TRANSITIONS_MS.OFF, function () {
                psuOn({ toggle_after_s: CONFIG.TIMERS.PSU_KEEPALIVE_S });
            });
        }
    }
});

/*** HTTP ENDPOINT REGISTRATION ***/
HTTPServer.registerEndpoint("motion", function (req, res) { var q = parseQuery(req.query); var sid = q.sensor ? String(q.sensor) : "n/a"; if (sid !== "n/a") onMotion(sid); res.code = 200; res.body = "OK"; res.send(); });
HTTPServer.registerEndpoint("motion_end", function (req, res) { var q = parseQuery(req.query); var sid = q.sensor ? String(q.sensor) : "n/a"; if (sid !== "n/a") onMotionEnd(sid); res.code = 200; res.body = "OK"; res.send(); });

/*** INIT ***/
function init() {
    for (var i = 0; i < CONFIG.SENSORS.length; i++) { STATE.sensors[CONFIG.SENSORS[i].id] = false; }
    print("--- Corridor Lighting " + SCRIPT_VERSION + " Starting ---");

    function waitForIpAndInitialize() {
        Shelly.call("WiFi.GetStatus", {}, function (status) {
            var ip = (status && status.sta_ip) ? status.sta_ip : null;
            if (!ip) {
                log("Waiting for Wi-Fi connection and IP address...");
                Timer.set(2000, false, waitForIpAndInitialize);
                return;
            }

            var scriptId = Shelly.getCurrentScriptId();
            var banner_text = "--- Corridor Lighting " + SCRIPT_VERSION + " Initialized ---\n";
            var baseUrl = "http://" + ip + "/script/" + scriptId;
            banner_text += "--- MOTION SENSOR URLs ---\n";
            for (var i = 0; i < CONFIG.SENSORS.length; i++) {
                var sensorId = CONFIG.SENSORS[i].id;
                banner_text += "Sensor " + sensorId + " Motion URL: " + baseUrl + "/motion?sensor=" + sensorId + "\n";
                banner_text += "Sensor " + sensorId + " End URL:    " + baseUrl + "/motion_end?sensor=" + sensorId + "\n";
            }
            banner_text += "--------------------------";

            var pollsCompleted = 0;
            var totalPolls = CONFIG.SENSORS.length;
            var onInitPollFinish = function () {
                pollsCompleted++;
                if (pollsCompleted >= totalPolls) {
                    lightGet(function (st) {
                        if (st && st.output) { log("Light is ON at startup. Starting sync loop."); startSyncLoop(); }
                        print(banner_text);
                        print("--- Init Complete ---");
                    });
                }
            };

            vboolGet(function (v) {
                log("Motion virtual boolean (id", CONFIG.VBOOL_MOTION + "): ", v ? "ENABLED" : "DISABLED");
                if (totalPolls > 0) {
                    for (var j = 0; j < CONFIG.SENSORS.length; j++) {
                        (function (s) {
                            httpGET(s.status_url, 5000, function (r) {
                                if (!r || r.code !== 200) { log("Init poll sensor", s.id + ": FAILED"); onInitPollFinish(); return; }
                                var data; try { data = JSON.parse(r.body || "{}"); } catch (e) { data = {}; }
                                var motion = data && data.sensor ? data.sensor.motion : false;
                                log("Init poll sensor", s.id + ": motion=", motion);
                                if (motion) onMotion(s.id);
                                onInitPollFinish();
                            });
                        })(CONFIG.SENSORS[j]);
                    }
                } else {
                    onInitPollFinish();
                }
            });
        });
    }

    Timer.set(1500, false, waitForIpAndInitialize);
}

init();
