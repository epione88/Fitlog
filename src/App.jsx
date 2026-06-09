import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";

// ─── Storage (localStorage — persists across PWA sessions) ──────────────────
const local = {
  get: async (key) => {
    try { const v = localStorage.getItem('fitlog:' + key); return v ? JSON.parse(v) : null; }
    catch { return null; }
  },
  set: async (key, val) => {
    try { localStorage.setItem('fitlog:' + key, JSON.stringify(val)); } catch {}
  },
  list: async () => {
    try {
      return Object.keys(localStorage)
        .filter(k => k.startsWith('fitlog:'))
        .map(k => k.replace('fitlog:', ''));
    } catch { return []; }
  },
};

async function exportAllData() {
  const keys = await local.list();
  const payload = { _exportedAt: new Date().toISOString() };
  for (const k of keys) { payload[k] = await local.get(k); }
  return JSON.stringify(payload, null, 2);
}
async function importAllData(jsonStr) {
  const data = JSON.parse(jsonStr);
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith("_")) continue;
    await local.set(k, v);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIO ENGINE — Web Audio API with persistent unlocked context
// Once unlocked by a user gesture, the context plays from timers reliably on iOS
// ═══════════════════════════════════════════════════════════════════════════════

const _audioLog = [];
function audioDebug(msg) {
  const entry = `${new Date().toLocaleTimeString()}: ${msg}`;
  _audioLog.unshift(entry);
  if (_audioLog.length > 12) _audioLog.pop();
  try { console.log('[FitLog Audio]', msg); } catch(e) {}
}

let _ctx = null;
let _unlocked = false;

function getCtx() {
  if (!_ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    _ctx = new AC();
  }
  return _ctx;
}

// Must be called inside a user gesture (tap). Creates + resumes the context
// and plays a silent buffer to fully unlock iOS audio.
function unlockAudio() {
  audioDebug('unlockAudio called');
  try {
    const ctx = getCtx();
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => audioDebug('ctx resumed: ' + ctx.state));
    }
    // Silent buffer to satisfy iOS unlock
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    _unlocked = true;
    audioDebug('unlocked, ctx state=' + ctx.state);
  } catch(e) {
    audioDebug('unlock error: ' + e.message);
  }
}

// Sound definitions: arrays of [freq, startOffset, duration, volMult]
const SOUND_DEFS = {
  workStart:      [[880, 0, 0.10, 1], [1100, 0.12, 0.14, 1]],
  restStart:      [[550, 0, 0.10, 0.9], [440, 0.12, 0.20, 0.9]],
  countdown:      [[700, 0, 0.08, 0.7]],
  countdownFinal: [[950, 0, 0.10, 0.9]],
  countdownGo:    [[1200, 0, 0.08, 1], [1500, 0.10, 0.14, 1]],
  complete:       [[523, 0, 0.14, 0.9], [659, 0.14, 0.14, 0.9], [784, 0.28, 0.14, 0.9], [1047, 0.42, 0.22, 1]],
};

function playSound(event, volume) {
  audioDebug(`playSound("${event}") unlocked=${_unlocked}`);
  try {
    const ctx = getCtx();
    if (ctx.state === 'suspended') {
      ctx.resume();
      audioDebug('resumed in playSound, state=' + ctx.state);
    }
    const def = SOUND_DEFS[event];
    if (!def) { audioDebug('no def for ' + event); return; }
    const vol = Math.max(0.01, Math.min(1, (volume ?? 80) / 100));
    const now = ctx.currentTime;
    def.forEach(([freq, off, dur, vm]) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + off);
      gain.gain.setValueAtTime(vol * vm, now + off);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + off + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + off);
      osc.stop(now + off + dur + 0.02);
    });
    audioDebug(`"${event}" scheduled ✓ state=${ctx.state}`);
  } catch(e) {
    audioDebug(`playSound threw: ${e.message}`);
  }
}

// useSound hook
function useSound(settings) {
  const play = useCallback((event) => {
    if (!settings.soundEnabled) { audioDebug('sound disabled'); return; }
    playSound(event, settings.volume);
    // Haptics
    if (settings.hapticsEnabled && navigator.vibrate) {
      const patterns = {
        workStart:      [100, 50, 100],
        restStart:      [200],
        countdown:      [20],
        countdownFinal: [40],
        countdownGo:    [80, 30, 80],
        complete:       [100, 50, 100, 50, 200],
      };
      navigator.vibrate(patterns[event] || [50]);
    }
  }, [settings]);
  return play;
}

// Debug panel component — shown in Settings
// Debug panel component — shown in Settings
function AudioDebugPanel() {
  const [log, setLog] = useState([]);

  const refresh = () => setLog([..._audioLog]);

  const testPlay = () => {
    unlockAudio();
    setTimeout(() => { playSound("workStart", 80); refresh(); }, 150);
    setTimeout(() => { playSound("countdown", 80); refresh(); }, 700);
    setTimeout(() => { playSound("countdownGo", 80); refresh(); }, 1200);
    setTimeout(refresh, 1600);
  };

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 }}>Audio Debug</div>
      <button onClick={testPlay}
        style={{ ...btnStyle("#ef6c35"), width: "100%", marginBottom: 10, fontSize: 13 }}>
        \ud83d\udd0a Tap to Test Audio (work + countdown + go)
      </button>
      <div style={{ background: "rgba(0,0,0,0.4)", borderRadius: 8, padding: 10, fontFamily: "monospace", fontSize: 10, color: "#0f0", minHeight: 80 }}>
        {log.length === 0 ? <div style={{ color: "rgba(255,255,255,0.3)" }}>Tap test button to see log\u2026</div>
          : log.map((l, i) => <div key={i} style={{ marginBottom: 2, color: l.includes('FAIL') || l.includes('error') || l.includes('threw') ? '#f55' : '#0f0' }}>{l}</div>)
        }
      </div>
      <button onClick={refresh} style={{ ...btnStyle("rgba(255,255,255,0.06)"), width: "100%", marginTop: 6, fontSize: 11 }}>Refresh Log</button>
    </div>
  );
}

// ─── Settings context ─────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  soundEnabled:   true,
  volume:         80,
  hapticsEnabled: true,
  countdownBeeps: true,
};
const SettingsCtx = createContext(DEFAULT_SETTINGS);

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS DRAWER
// ═══════════════════════════════════════════════════════════════════════════════
function SettingsDrawer({ settings, onChange, onClose }) {
  const play = useSound(settings);

  const set = (key, val) => onChange({ ...settings, [key]: val });

  const Row = ({ label, sub, children }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{sub}</div>}
      </div>
      {children}
    </div>
  );

  const Toggle = ({ value, onToggle }) => (
    <div onClick={onToggle} style={{
      width: 44, height: 26, borderRadius: 13, cursor: "pointer", flexShrink: 0,
      background: value ? "#ef6c35" : "rgba(255,255,255,0.12)",
      position: "relative", transition: "background 0.2s"
    }}>
      <div style={{
        position: "absolute", top: 3, left: value ? 21 : 3,
        width: 20, height: 20, borderRadius: "50%", background: "#fff",
        transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.3)"
      }} />
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 100, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#1a1218", borderRadius: "20px 20px 0 0", padding: "20px 20px 48px", maxHeight: "85vh", overflowY: "auto" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontWeight: 800, fontSize: 18 }}>⚙️ Settings</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: 22, cursor: "pointer" }}>×</button>
        </div>

        {/* ── SOUND ── */}
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1.5, marginTop: 20, marginBottom: 4 }}>Sound</div>

        <Row label="Timer Sounds" sub="Play audio cues on phase changes">
          <Toggle value={settings.soundEnabled} onToggle={() => set("soundEnabled", !settings.soundEnabled)} />
        </Row>

        {settings.soundEnabled && <>
          <Row label="Volume" sub={`${settings.volume}%`}>
            <input type="range" min={10} max={100} step={5} value={settings.volume}
              onChange={e => set("volume", Number(e.target.value))}
              onMouseUp={() => { unlockAudio(); play("workStart"); }}
              onTouchEnd={() => { unlockAudio(); play("workStart"); }}
              style={{ width: 130, accentColor: "#ef6c35", cursor: "pointer" }} />
          </Row>

          <Row label="Countdown Beeps" sub="Beep at 3, 2, 1 before phase ends">
            <Toggle value={settings.countdownBeeps} onToggle={() => set("countdownBeeps", !settings.countdownBeeps)} />
          </Row>
        </>}

        {/* ── HAPTICS ── */}
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1.5, marginTop: 20, marginBottom: 4 }}>Haptics</div>

        <Row label="Vibration" sub="Haptic feedback on phase changes">
          <Toggle value={settings.hapticsEnabled} onToggle={() => {
            set("hapticsEnabled", !settings.hapticsEnabled);
            if (!settings.hapticsEnabled && navigator.vibrate) navigator.vibrate(100);
          }} />
        </Row>

        {/* ── TEST ── */}
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1.5, marginTop: 20, marginBottom: 8 }}>Test</div>
        <div style={{ display: "flex", gap: 8 }}>
          {[["workStart","Work"], ["restStart","Rest"], ["complete","Done!"]].map(([evt, label]) => (
            <button key={evt} onClick={() => { unlockAudio(); play(evt); }}
              style={{ ...btnStyle("rgba(255,255,255,0.08)"), flex: 1, fontSize: 13 }}>
              ▶ {label}
            </button>
          ))}
        </div>
        {/* ── DEBUG ── */}
        <AudioDebugPanel />

      </div>
    </div>
  );
}
const TABS = ["Workout", "Movement", "Nutrition"];

const DEFAULT_EXERCISES = [
  "Bench Press", "Squat", "Deadlift", "OHP", "Pull-Up",
  "Barbell Row", "Incline Press", "Leg Press", "Curl", "Tricep Pushdown",
];

// ─── Pre-imported routines from Interval Timer ────────────────────────────────
const IMPORTED_ROUTINES = [{"id":"elctk5","name":"Upper Strength and Power","exercises":[{"id":"npitgj","name":"Bench Press 6-8","sets":3,"workSec":60,"restSec":45,"baseWeight":"","baseReps":""},{"id":"4xgqsg","name":"Chest Supported Rows 12-15","sets":3,"workSec":60,"restSec":45,"baseWeight":"","baseReps":""},{"id":"jtmsqr","name":"DB Overhead Press 8-10","sets":3,"workSec":60,"restSec":45,"baseWeight":"","baseReps":""},{"id":"j42pt6","name":"Lat Pull Downs 10-12","sets":3,"workSec":60,"restSec":45,"baseWeight":"","baseReps":""},{"id":"911yee","name":"Tricep Push Downs 12-15","sets":3,"workSec":60,"restSec":45,"baseWeight":"","baseReps":""},{"id":"z3nwdr","name":"Hammer Curls 12-15","sets":3,"workSec":60,"restSec":45,"baseWeight":"","baseReps":""},{"id":"w5489i","name":"Chest Flys","sets":3,"workSec":60,"restSec":45,"baseWeight":"","baseReps":""}]},{"id":"y3cn8o","name":"Lower Body Volume and Time Under Pressure","exercises":[{"id":"o1gm0l","name":"Leg Extensions 12-15","sets":3,"workSec":60,"restSec":45,"baseWeight":"","baseReps":""},{"id":"m2ohk5","name":"Barbell Squats 12-15","sets":3,"workSec":60,"restSec":45,"baseWeight":"","baseReps":""},{"id":"1s9hzc","name":"Calf Raises 20","sets":3,"workSec":60,"restSec":45,"baseWeight":"","baseReps":""},{"id":"c1oqac","name":"Walking Lunges (15 per side)","sets":3,"workSec":60,"restSec":45,"baseWeight":"","baseReps":""},{"id":"vnktap","name":"Leg Curl","sets":3,"workSec":60,"restSec":45,"baseWeight":"","baseReps":""}]},{"id":"kpggoq","name":"Upper Body Volume","exercises":[{"id":"o2k08l","name":"Incline Press 12-15","sets":3,"workSec":60,"restSec":45,"baseWeight":"","baseReps":""},{"id":"dhzf22","name":"Barbell Rows (8)","sets":3,"workSec":60,"restSec":45,"baseWeight":"","baseReps":""},{"id":"r7ciky","name":"DB Lateral Raises 15-20","sets":3,"workSec":60,"restSec":45,"baseWeight":"","baseReps":""},{"id":"zdqpjk","name":"Skull Crushers (ez bar) 12-15","sets":3,"workSec":60,"restSec":45,"baseWeight":"","baseReps":""},{"id":"tw7ei8","name":"Cable Bicep Curl 15-20","sets":3,"workSec":60,"restSec":45,"baseWeight":"","baseReps":""},{"id":"7wy7qk","name":"Face Pulls Rope 15-20","sets":3,"workSec":60,"restSec":45,"baseWeight":"","baseReps":""}]},{"id":"ovm980","name":"Lower Body Strength and Hinge","exercises":[{"id":"yfqyvg","name":"Barbell Deadlifts 5-8","sets":3,"workSec":60,"restSec":45,"baseWeight":"","baseReps":""},{"id":"tsb0je","name":"Leg Extension 10-12","sets":3,"workSec":60,"restSec":45,"baseWeight":"","baseReps":""},{"id":"t6xxz3","name":"Hip Thrust 12-15","sets":3,"workSec":60,"restSec":45,"baseWeight":"","baseReps":""},{"id":"baska4","name":"Hamstring Curls 15-20","sets":3,"workSec":60,"restSec":45,"baseWeight":"","baseReps":""},{"id":"cl8xvp","name":"Kettlebell Swings","sets":3,"workSec":60,"restSec":45,"baseWeight":"","baseReps":""}]}];

const MACRO_COLORS = { protein: "#ef6c35", carbs: "#f0b429", fat: "#5cb8b2" };

// ─── Utility ──────────────────────────────────────────────────────────────────
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const today = () => new Date().toISOString().slice(0, 10);
const uid = () => Math.random().toString(36).slice(2, 8);

// ─── Ring component ───────────────────────────────────────────────────────────
function Ring({ value, max, color, size = 80, stroke = 8, label, sublabel }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(value / max, 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.6s ease" }} />
      </svg>
      <div style={{ marginTop: -size/2 - 4, textAlign: "center", position: "relative", top: -size/2 + 4 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", lineHeight: 1 }}>{label}</div>
        {sublabel && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>{sublabel}</div>}
      </div>
    </div>
  );
}

// ─── MacroBar ─────────────────────────────────────────────────────────────────
function MacroBar({ label, value, goal, color }) {
  const pct = Math.min((value / goal) * 100, 100);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: 1 }}>{label}</span>
        <span style={{ color: "#fff", fontWeight: 600 }}>{value}g <span style={{ color: "rgba(255,255,255,0.35)" }}>/ {goal}g</span></span>
      </div>
      <div style={{ height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width 0.5s ease" }} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEPPER — small +/- number input
// ═══════════════════════════════════════════════════════════════════════════════
function Stepper({ value, onChange, min = 1, max = 99, label }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      {label && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: "4px 6px" }}>
        <button onClick={() => onChange(Math.max(min, value - 1))}
          style={{ background: "none", border: "none", color: value <= min ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.6)", cursor: value <= min ? "default" : "pointer", fontSize: 18, lineHeight: 1, padding: "0 4px", fontWeight: 300 }}>−</button>
        <div style={{ fontSize: 16, fontWeight: 700, minWidth: 28, textAlign: "center", color: "#fff" }}>{value}</div>
        <button onClick={() => onChange(Math.min(max, value + 1))}
          style={{ background: "none", border: "none", color: value >= max ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.6)", cursor: value >= max ? "default" : "pointer", fontSize: 18, lineHeight: 1, padding: "0 4px", fontWeight: 300 }}>+</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTINE EDITOR
// ═══════════════════════════════════════════════════════════════════════════════
function RoutineEditor({ routine, onSave, onCancel }) {
  const [name, setName]           = useState(routine?.name || "");
  const [exercises, setExercises] = useState(
    routine?.exercises?.map(e => ({
      id: e.id || uid(), name: e.name,
      sets: e.sets ?? 3, workSec: e.workSec ?? 60, restSec: e.restSec ?? 60,
      baseWeight: e.baseWeight ?? "", baseReps: e.baseReps ?? "",
    })) || []
  );
  const [input, setInput] = useState("");

  const addEx = () => {
    const n = input.trim();
    if (!n) return;
    setExercises(e => [...e, { id: uid(), name: n, sets: 3, workSec: 60, restSec: 60, baseWeight: "", baseReps: "" }]);
    setInput("");
  };

  const updateEx = (id, field, val) =>
    setExercises(e => e.map(x => x.id === id ? { ...x, [field]: val } : x));

  const removeEx = (id) => setExercises(e => e.filter(x => x.id !== id));

  const moveEx = (idx, dir) => {
    const arr = [...exercises];
    const t = idx + dir;
    if (t < 0 || t >= arr.length) return;
    [arr[idx], arr[t]] = [arr[t], arr[idx]];
    setExercises(arr);
  };

  const save = () => {
    if (!name.trim() || exercises.length === 0) return;
    onSave({ id: routine?.id || uid(), name: name.trim(), exercises });
  };

  const TIME_OPTS = [20, 30, 45, 60, 90, 120];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={labelStyle}>{routine ? "Edit Routine" : "New Routine"}</div>
        <button onClick={onCancel} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 22, lineHeight: 1 }}>×</button>
      </div>

      <input value={name} onChange={e => setName(e.target.value)}
        placeholder="Routine name (e.g. Push Day, Chest & Tris…)"
        style={{ ...inputStyle, marginBottom: 14 }} />

      {exercises.map((ex, i) => (
        <div key={ex.id} style={{ ...cardStyle, marginBottom: 10 }}>
          {/* Exercise name row */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <button onClick={() => moveEx(i, -1)} disabled={i === 0}
                style={{ background: "none", border: "none", color: i === 0 ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.4)", cursor: i === 0 ? "default" : "pointer", fontSize: 10, padding: 0 }}>▲</button>
              <button onClick={() => moveEx(i, 1)} disabled={i === exercises.length - 1}
                style={{ background: "none", border: "none", color: i === exercises.length-1 ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.4)", cursor: i === exercises.length-1 ? "default" : "pointer", fontSize: 10, padding: 0 }}>▼</button>
            </div>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: "rgba(239,108,53,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#ef6c35", fontWeight: 700, flexShrink: 0 }}>{i+1}</div>
            <div style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{ex.name}</div>
            <button onClick={() => removeEx(ex.id)}
              style={{ background: "none", border: "none", color: "rgba(255,255,255,0.2)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
          </div>

          {/* Sets + timers row */}
          <div style={{ display: "flex", justifyContent: "space-around", gap: 8, marginBottom: 12 }}>
            <Stepper value={ex.sets} onChange={v => updateEx(ex.id, "sets", v)} min={1} max={20} label="Sets" />
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1 }}>Work</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center" }}>
                {TIME_OPTS.map(t => (
                  <button key={t} onClick={() => updateEx(ex.id, "workSec", t)}
                    style={{ ...chipStyle, padding: "3px 8px", fontSize: 11, background: ex.workSec === t ? "#ef6c35" : "rgba(255,255,255,0.08)", color: ex.workSec === t ? "#fff" : "rgba(255,255,255,0.5)" }}>
                    {t}s
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1 }}>Rest</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center" }}>
                {TIME_OPTS.map(t => (
                  <button key={t} onClick={() => updateEx(ex.id, "restSec", t)}
                    style={{ ...chipStyle, padding: "3px 8px", fontSize: 11, background: ex.restSec === t ? "#5cb8b2" : "rgba(255,255,255,0.08)", color: ex.restSec === t ? "#fff" : "rgba(255,255,255,0.5)" }}>
                    {t}s
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Base weight + reps */}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 10 }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
              Base Weight &amp; Reps <span style={{ color: "rgba(255,255,255,0.2)", textTransform: "none", letterSpacing: 0 }}>(used until history builds up)</span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginBottom: 4 }}>Weight (lbs)</div>
                <input value={ex.baseWeight} onChange={e => updateEx(ex.id, "baseWeight", e.target.value)}
                  type="number" placeholder="e.g. 135"
                  style={{ ...inputStyle, textAlign: "center", fontSize: 16, fontWeight: 700 }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginBottom: 4 }}>Reps</div>
                <input value={ex.baseReps} onChange={e => updateEx(ex.id, "baseReps", e.target.value)}
                  type="number" placeholder="e.g. 10"
                  style={{ ...inputStyle, textAlign: "center", fontSize: 16, fontWeight: 700 }} />
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* Add exercise */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addEx()}
          list="ex-list" placeholder="Add exercise…"
          style={{ ...inputStyle, flex: 1 }} />
        <datalist id="ex-list">{DEFAULT_EXERCISES.map(e => <option key={e} value={e} />)}</datalist>
        <button onClick={addEx} style={btnStyle("#ef6c35", { padding: "0 14px", flexShrink: 0 })}>Add</button>
      </div>

      <button onClick={save} disabled={!name.trim() || exercises.length === 0}
        style={{ ...btnStyle(!name.trim() || exercises.length === 0 ? "rgba(255,255,255,0.12)" : "#ef6c35"), width: "100%", opacity: !name.trim() || exercises.length === 0 ? 0.45 : 1 }}>
        Save Routine
      </button>
    </div>
  );
}

// ── Compute total routine duration in seconds ──────────────────────────────────
function routineTotalSec(exercises) {
  return exercises.reduce((sum, e) => {
    const sets    = typeof e.sets === "number" ? e.sets : (e.sets?.length ?? 3);
    const workSec = e.workSec ?? 60;
    const restSec = e.restSec ?? 60;
    // sets × work + (sets - 1) × rest between sets + restSec transition to next ex
    return sum + sets * workSec + (sets - 1) * restSec + restSec;
  }, 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TABATA SESSION — auto-starts, always-visible ring for both work + rest
// ═══════════════════════════════════════════════════════════════════════════════
function TabataSession({ session, workoutTimer, lastStats, onFinish }) {
  const settings = useContext(SettingsCtx);

  // ── All timer state lives in ONE ref — the interval reads from it directly ──
  const S = useRef({
    phase: "work", exIdx: 0, setIdx: 0, tick: 0,
    paused: false, showEnd: false,
    play: null, settings: settings,
  });

  // Mirror to React state only for rendering
  const [phase,   setPhase]   = useState("work");
  const [tick,    setTick]    = useState(0);
  const [exIdx,   setExIdx]   = useState(0);
  const [setIdx,  setSetIdx]  = useState(0);
  const [paused,  setPaused]  = useState(false);
  const [showEnd, setShowEnd] = useState(false);

  const [logData, setLogData] = useState(() =>
    session.exercises.map(ex => {
      const stat    = lastStats?.find(s => s.name === ex.name);
      const w       = stat?.rollingAvg != null ? String(stat.rollingAvg)
                    : stat?.lastAvg    != null ? String(stat.lastAvg)
                    : ex.baseWeight ? String(ex.baseWeight) : "";
      const r       = stat?.rollingAvg != null ? "" : (ex.baseReps ? String(ex.baseReps) : "");
      const nSets   = typeof ex.sets === "number" ? ex.sets : ex.sets?.length ?? 3;
      return { ...ex, sets: Array.from({ length: nSets }, () => ({ weight: w, reps: r, done: false })) };
    })
  );

  // Keep logData accessible to interval without stale closure
  const logRef = useRef(logData);
  useEffect(() => { logRef.current = logData; }, [logData]);

  const play = useSound(settings);

  // Stable refs — always current inside interval without closure staleness
  const playRef     = useRef(play);
  const settingsRef = useRef(settings);
  useEffect(() => { playRef.current     = play;     }, [play]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  // Keep S.current in sync too
  S.current.play     = play;
  S.current.settings = settings;

  const historyRef = useRef([]);
  const intervalRef = useRef(null);

  // ── Helper: sync ref → React state for rendering ────────────────────────────
  const syncState = () => {
    setPhase(S.current.phase);
    setTick(S.current.tick);
    setExIdx(S.current.exIdx);
    setSetIdx(S.current.setIdx);
    setPaused(S.current.paused);
    setShowEnd(S.current.showEnd);
  };

  // ── Advance phase — takes explicit params to avoid stale closure ────────────
  const advanceRef = (fromPhase, fromExIdx, fromSetIdx, pushHistory) => {
    const data = logRef.current;

    if (fromPhase === "work") {
      setLogData(d => d.map((e, ei) => ei !== fromExIdx ? e : {
        ...e, sets: e.sets.map((s, si) => si === fromSetIdx ? { ...s, done: true } : s)
      }));
      if (pushHistory) historyRef.current.push({ phase: fromPhase, exIdx: fromExIdx, setIdx: fromSetIdx });

      const setsLeft = (data[fromExIdx]?.sets?.length ?? 0) - fromSetIdx - 1;
      const exLeft   = data.length - fromExIdx - 1;

      if (setsLeft > 0 || exLeft > 0) {
        if (exLeft > 0 && setsLeft <= 0) {
          S.current.exIdx  = fromExIdx + 1;
          S.current.setIdx = 0;
        }
        S.current.phase = "rest";
        S.current.tick  = 0;
      } else {
        S.current.phase = "done";
        S.current.tick  = 0;
        setTimeout(() => playRef.current("complete"), 50);
      }
    } else if (fromPhase === "rest") {
      if (pushHistory) historyRef.current.push({ phase: fromPhase, exIdx: fromExIdx, setIdx: fromSetIdx });
      const nextSet = fromSetIdx + 1;
      if (nextSet < (data[S.current.exIdx]?.sets?.length ?? 0)) {
        S.current.setIdx = nextSet;
      }
      S.current.phase = "work";
      S.current.tick  = 0;
    }
    syncState();
  };

  // ── Single interval — reads/writes S.current only ───────────────────────────
  const startInterval = () => {
    clearInterval(intervalRef.current);
    if (S.current.phase === "done") return;

    intervalRef.current = setInterval(() => {
      if (S.current.paused || S.current.showEnd || S.current.phase === "done") return;

      const exDef = session.exercises[S.current.exIdx];
      const dur   = S.current.phase === "work" ? (exDef?.workSec ?? 60) : (exDef?.restSec ?? 60);
      S.current.tick += 1;
      const rem   = dur - S.current.tick;

      // Countdown sounds — use stable ref, never stale
      if (settingsRef.current.countdownBeeps) {
        if      (rem === 0)              playRef.current("countdownGo");
        else if (rem > 0 && rem <= 3)    playRef.current("countdownFinal");
        else if (rem > 0 && rem <= 10)   playRef.current("countdown");
      }

      setTick(S.current.tick);

      if (S.current.tick >= dur) {
        S.current.tick = 0;
        // Call advanceRef outside setState to avoid batching issues
        const p  = S.current.phase;
        const ei = S.current.exIdx;
        const si = S.current.setIdx;
        clearInterval(intervalRef.current);
        setTimeout(() => advanceRef(p, ei, si, true), 0);
      }
    }, 1000);
  };

  // ── Start interval on mount, play opening sound ──────────────────────────────
  useEffect(() => {
    // Small delay so audio context is ready after user gesture
    setTimeout(() => playRef.current("workStart"), 100);
    startInterval();
    return () => clearInterval(intervalRef.current);
  }, []);

  // ── Restart interval when phase/exIdx/setIdx change ─────────────────────────
  useEffect(() => {
    if (S.current.phase !== "done") {
      setTimeout(() => playRef.current(S.current.phase === "work" ? "workStart" : "restStart"), 100);
      startInterval();
    }
    return () => clearInterval(intervalRef.current);
  }, [phase, exIdx, setIdx]);

  // ── Skip ──────────────────────────────────────────────────────────────────────
  const skipPhase = () => {
    clearInterval(intervalRef.current);
    const p  = S.current.phase;
    const ei = S.current.exIdx;
    const si = S.current.setIdx;
    S.current.tick = 0;
    advanceRef(p, ei, si, true);
  };

  // ── Go back ───────────────────────────────────────────────────────────────────
  const goBack = () => {
    const prev = historyRef.current.pop();
    if (!prev) return;
    clearInterval(intervalRef.current);

    // Undo set completion
    if (prev.phase === "work") {
      setLogData(d => d.map((e, ei) => ei !== prev.exIdx ? e : {
        ...e, sets: e.sets.map((s, si) => si !== prev.setIdx ? s : { ...s, done: false })
      }));
    }

    S.current.phase  = prev.phase;
    S.current.exIdx  = prev.exIdx;
    S.current.setIdx = prev.setIdx;
    S.current.tick   = 0;
    syncState();
    // Sound + restart via useEffect on phase/exIdx/setIdx change
  };

  // ── Pause / resume ────────────────────────────────────────────────────────────
  const togglePause = () => {
    S.current.paused = !S.current.paused;
    setPaused(S.current.paused);
    if (!S.current.paused) startInterval();
    else clearInterval(intervalRef.current);
  };

  // ── End workout ───────────────────────────────────────────────────────────────
  const triggerEnd = () => {
    S.current.showEnd = true;
    S.current.paused  = true;
    clearInterval(intervalRef.current);
    syncState();
  };

  const updateLog = (ei, si, field, val) =>
    setLogData(d => d.map((e, eidx) => eidx !== ei ? e : {
      ...e, sets: e.sets.map((s, sidx) => sidx !== si ? s : { ...s, [field]: val })
    }));

  const totalVolume = (ex) =>
    ex.sets.filter(s => s.done).reduce((sum, s) => sum + (parseFloat(s.weight)||0)*(parseInt(s.reps)||0), 0);

  // ── Derived display values (from React state, safe for render) ───────────────
  const exDef      = session.exercises[exIdx];
  const ex         = logData[exIdx];
  const totalSets  = ex?.sets?.length ?? 0;
  const isWork     = phase === "work";
  const duration   = isWork ? (exDef?.workSec ?? 60) : (exDef?.restSec ?? 60);
  const remaining  = Math.max(0, duration - tick);
  const pct        = Math.min(tick / duration, 1);
  const totalRoutineSec = routineTotalSec(session.exercises);
  const isCountdown = remaining <= 10 && remaining > 0 && settings.countdownBeeps;
  const arcColor   = isWork ? "#ef6c35" : "#5cb8b2";
  const ringColor  = isCountdown && remaining <= 3 ? "#e74c3c" : arcColor;
  const R = 90, SW = 10;
  const circ = 2 * Math.PI * R;
  const exStat = lastStats?.find(s => s.name === ex?.name);

  const futureRoutineSec = (() => {
    let sec = remaining;
    const workS = exDef?.workSec ?? 60;
    const restS = exDef?.restSec ?? 60;
    if (isWork) {
      sec += restS + (totalSets - setIdx - 1) * (workS + restS);
    } else {
      sec += (totalSets - setIdx - 1) * (workS + restS);
    }
    for (let i = exIdx + 1; i < session.exercises.length; i++) {
      sec += routineTotalSec([session.exercises[i]]);
    }
    return Math.max(0, sec);
  })();

  const canGoBack = historyRef.current.length > 0;
  const nextEx = exIdx + 1 < logData.length ? logData[exIdx + 1]?.name : null;

  // ── End confirm modal ─────────────────────────────────────────────────────────
  if (showEnd) return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:300, gap:16 }}>
      <div style={{ fontSize:32 }}>🛑</div>
      <div style={{ fontWeight:800, fontSize:20, textAlign:"center" }}>End Workout?</div>
      <div style={{ fontSize:13, color:"rgba(255,255,255,0.4)", textAlign:"center" }}>
        {fmt(workoutTimer)} elapsed · {logData.flatMap(e => e.sets.filter(s => s.done)).length} sets completed
      </div>
      <div style={{ display:"flex", gap:10, width:"100%" }}>
        <button onClick={() => { S.current.showEnd=false; S.current.paused=false; syncState(); startInterval(); }}
          style={{ ...btnStyle("rgba(255,255,255,0.1)"), flex:1, fontSize:14 }}>Keep Going</button>
        <button onClick={() => { setPhase("done"); setShowEnd(false); }}
          style={{ ...btnStyle("#27ae60"), flex:1, fontSize:14 }}>Save & Finish ✓</button>
      </div>
      <button onClick={() => onFinish(logData, workoutTimer)}
        style={{ background:"none", border:"none", color:"#e74c3c", cursor:"pointer", fontSize:13 }}>
        Discard Workout
      </button>
    </div>
  );

  // ── Done ──────────────────────────────────────────────────────────────────────
  if (phase === "done") return (
    <div>
      <div style={{ textAlign:"center", padding:"24px 0 16px" }}>
        <div style={{ fontSize:40, marginBottom:8 }}>🏆</div>
        <div style={{ fontSize:22, fontWeight:800 }}>Workout Complete!</div>
        <div style={{ fontSize:13, color:"rgba(255,255,255,0.4)", marginTop:4 }}>{fmt(workoutTimer)} total time</div>
      </div>
      {logData.map((ex, ei) => (
        <div key={ex.id} style={cardStyle}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
            <div style={{ fontWeight:700 }}>{ex.name}</div>
            <div style={{ fontSize:12, color:"#ef6c35" }}>{totalVolume(ex).toLocaleString()} lbs vol</div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"28px 1fr 1fr 60px", gap:6, marginBottom:6 }}>
            {["Set","Weight","Reps","Vol"].map((h,i) => <div key={i} style={{ fontSize:10, color:"rgba(255,255,255,0.3)", textTransform:"uppercase", letterSpacing:1 }}>{h}</div>)}
          </div>
          {ex.sets.map((s, si) => (
            <div key={si} style={{ display:"grid", gridTemplateColumns:"28px 1fr 1fr 60px", gap:6, alignItems:"center", marginBottom:5 }}>
              <div style={{ fontSize:12, color:"rgba(255,255,255,0.4)", fontWeight:600 }}>{si+1}</div>
              <input value={s.weight} onChange={e => updateLog(ei, si, "weight", e.target.value)} placeholder="lbs" type="number"
                style={{ ...inputStyle, padding:"6px 8px", fontSize:13, textAlign:"center" }} />
              <input value={s.reps} onChange={e => updateLog(ei, si, "reps", e.target.value)} placeholder="reps" type="number"
                style={{ ...inputStyle, padding:"6px 8px", fontSize:13, textAlign:"center" }} />
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", textAlign:"center" }}>
                {s.weight && s.reps ? (parseFloat(s.weight)*parseInt(s.reps)).toLocaleString() : "—"}
              </div>
            </div>
          ))}
        </div>
      ))}
      <button onClick={() => onFinish(logData, workoutTimer)}
        style={{ ...btnStyle("#27ae60"), width:"100%", fontSize:15, padding:"13px", marginTop:4 }}>
        Save Session ✓
      </button>
    </div>
  );

  // ── Active phase ──────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Top bar */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
        <div style={{ textAlign:"left" }}>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", textTransform:"uppercase", letterSpacing:1 }}>Elapsed</div>
          <div style={{ fontSize:14, fontFamily:"monospace", fontWeight:700 }}>{fmt(workoutTimer)}</div>
        </div>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", textTransform:"uppercase", letterSpacing:1 }}>Remaining</div>
          <div style={{ fontSize:14, fontFamily:"monospace", fontWeight:700, color:"#f0b429" }}>{fmt(futureRoutineSec)}</div>
        </div>
        <button onClick={triggerEnd}
          style={{ ...btnStyle("rgba(231,76,60,0.2)", { fontSize:12, padding:"6px 12px", color:"#e74c3c" }) }}>End</button>
      </div>

      {/* Progress bar */}
      <div style={{ height:3, background:"rgba(255,255,255,0.07)", borderRadius:2, marginBottom:16, overflow:"hidden" }}>
        <div style={{ height:"100%", borderRadius:2, background:"linear-gradient(90deg,#ef6c35,#f0b429)",
          width:`${Math.max(2,((totalRoutineSec-futureRoutineSec)/totalRoutineSec)*100)}%`,
          transition:"width 1s linear" }} />
      </div>

      {/* Ring timer */}
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", marginBottom:12 }}>
        <div style={{ position:"relative", width:200, height:200 }}>
          <svg width={200} height={200} style={{ transform:"rotate(-90deg)" }}>
            <circle cx={100} cy={100} r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={SW} />
            <circle cx={100} cy={100} r={R} fill="none" stroke={ringColor} strokeWidth={isCountdown ? SW+2 : SW}
              strokeDasharray={circ} strokeDashoffset={circ * pct}
              strokeLinecap="round" style={{ transition:"stroke-dashoffset 0.9s linear, stroke 0.2s, stroke-width 0.2s" }} />
          </svg>
          <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
            <div style={{ fontSize:11, textTransform:"uppercase", letterSpacing:2, color:ringColor, fontWeight:700, marginBottom:2 }}>
              {isWork ? "WORK" : "REST"}
            </div>
            <div style={{ fontSize:52, fontWeight:900, letterSpacing:-2, fontFamily:"monospace", lineHeight:1,
              color: isCountdown && remaining <= 3 ? "#e74c3c" : "#fff" }}>
              {fmt(remaining)}
            </div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.35)", marginTop:5 }}>Set {setIdx+1} / {totalSets}</div>
          </div>
        </div>
        <div style={{ textAlign:"center", marginTop:6 }}>
          <div style={{ fontSize:20, fontWeight:800 }}>{ex?.name}</div>
          {!isWork && nextEx && <div style={{ fontSize:12, color:"rgba(255,255,255,0.35)", marginTop:3 }}>Up next: {nextEx}</div>}
        </div>
      </div>

      {/* Set dots */}
      <div style={{ display:"flex", justifyContent:"center", gap:8, marginBottom:14 }}>
        {ex?.sets.map((s, i) => (
          <div key={i} style={{ width:12, height:12, borderRadius:"50%",
            background: s.done ? "#27ae60" : i===setIdx ? ringColor : "rgba(255,255,255,0.12)",
            border: i===setIdx && !s.done ? `2px solid ${ringColor}` : "2px solid transparent",
            boxShadow: i===setIdx && !s.done ? `0 0 6px ${ringColor}` : "none",
            transition:"all 0.3s" }} />
        ))}
      </div>

      {/* Controls: Back · Pause · Skip */}
      <div style={{ display:"flex", gap:8, marginBottom:14 }}>
        <button onClick={goBack} disabled={!canGoBack}
          style={{ ...btnStyle("rgba(255,255,255,0.08)", { fontSize:13, padding:"10px 14px", opacity: canGoBack ? 1 : 0.3 }) }}>
          ⏮ Back
        </button>
        <button onClick={togglePause}
          style={{ ...btnStyle("rgba(255,255,255,0.1)"), flex:1, fontSize:15 }}>
          {paused ? "▶ Resume" : "⏸ Pause"}
        </button>
        <button onClick={skipPhase}
          style={{ ...btnStyle(isWork ? "rgba(239,108,53,0.15)" : "rgba(92,184,178,0.15)", { fontSize:13, padding:"10px 14px", color:arcColor }) }}>
          Skip ⏭
        </button>
      </div>

      {/* Last session stats */}
      {(() => {
        const hasStat = exStat?.avg != null || exStat?.rollingAvg != null;
        const hasBase = !hasStat && session.exercises[exIdx]?.baseWeight;
        if (!hasStat && !hasBase) return null;
        return (
          <div style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:10, padding:"8px 12px", marginBottom:10 }}>
            {hasStat ? (
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", textTransform:"uppercase", letterSpacing:1 }}>
                  {(exStat.sessionCount ?? 1) > 1 ? `${exStat.sessionCount} sessions` : "Last session"}
                </div>
                <div style={{ display:"flex", gap:14, fontSize:12 }}>
                  <span><span style={{ color:"#5cb8b2", fontWeight:700 }}>↓</span> <span style={{ color:"rgba(255,255,255,0.7)" }}>{exStat.min} lbs</span></span>
                  <span><span style={{ color:"#ef6c35", fontWeight:700 }}>↑</span> <span style={{ color:"rgba(255,255,255,0.7)" }}>{exStat.max} lbs</span></span>
                  <span><span style={{ color:"#f0b429", fontWeight:700 }}>≈</span> <span style={{ color:"#f0b429", fontWeight:700 }}>{exStat.rollingAvg ?? exStat.lastAvg} lbs</span></span>
                </div>
              </div>
            ) : (
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", textTransform:"uppercase", letterSpacing:1 }}>Base weight</div>
                <div style={{ fontSize:13, color:"#f0b429", fontWeight:700 }}>
                  {session.exercises[exIdx]?.baseWeight} lbs{session.exercises[exIdx]?.baseReps ? ` × ${session.exercises[exIdx].baseReps} reps` : ""}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Log weight/reps */}
      <div style={cardStyle}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", textTransform:"uppercase", letterSpacing:1 }}>
            Log Set {setIdx+1} · {ex?.name}
          </div>
          {(() => {
            if (exStat?.rollingAvg != null) return <div style={{ fontSize:10, color:"#f0b429" }}>pre-filled from history</div>;
            if (session.exercises[exIdx]?.baseWeight) return <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)" }}>pre-filled from base</div>;
            return null;
          })()}
        </div>
        <div style={{ display:"flex", gap:10 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", marginBottom:4 }}>Weight (lbs)</div>
            <input value={logData[exIdx]?.sets[setIdx]?.weight || ""} onChange={e => updateLog(exIdx, setIdx, "weight", e.target.value)}
              type="number" placeholder={exStat?.rollingAvg != null ? String(exStat.rollingAvg) : exStat?.lastAvg != null ? String(exStat.lastAvg) : (session.exercises[exIdx]?.baseWeight ? String(session.exercises[exIdx].baseWeight) : "0")}
              style={{ ...inputStyle, textAlign:"center", fontSize:20, fontWeight:700, padding:"10px" }} />
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", marginBottom:4 }}>Reps</div>
            <input value={logData[exIdx]?.sets[setIdx]?.reps || ""} onChange={e => updateLog(exIdx, setIdx, "reps", e.target.value)}
              type="number" placeholder={session.exercises[exIdx]?.baseReps ? String(session.exercises[exIdx].baseReps) : "0"}
              style={{ ...inputStyle, textAlign:"center", fontSize:20, fontWeight:700, padding:"10px" }} />
          </div>
        </div>
      </div>

      {/* Exercise queue */}
      <div style={{ display:"flex", gap:6, marginTop:12, overflowX:"auto", paddingBottom:4 }}>
        {logData.map((e, i) => (
          <div key={e.id} style={{ flexShrink:0, padding:"5px 10px", borderRadius:8, fontSize:12,
            background: i<exIdx ? "rgba(39,174,96,0.15)" : i===exIdx ? "rgba(239,108,53,0.2)" : "rgba(255,255,255,0.05)",
            color: i<exIdx ? "#27ae60" : i===exIdx ? "#ef6c35" : "rgba(255,255,255,0.3)",
            border:`1px solid ${i===exIdx ? "rgba(239,108,53,0.3)" : "transparent"}`,
            fontWeight: i===exIdx ? 700 : 400 }}>
            {i<exIdx ? "✓ " : ""}{e.name}
          </div>
        ))}
      </div>
    </div>
  );
}


function WorkoutTab() {
  const [sessions, setSessions]         = useState([]);
  const [routines, setRoutines]         = useState([]);
  const [active, setActive]             = useState(null); // active session config
  const [workoutTimer, setWorkoutTimer] = useState(0);
  const [view, setView]                 = useState("home"); // "home"|"routines"|"editRoutine"|"history"
  const [editingRoutine, setEditingRoutine] = useState(null);
  const workoutRef = useRef(null);

  useEffect(() => {
    local.get("workout-sessions").then(d => d && setSessions(d));
    local.get("workout-routines").then(d => {
      if (d && d.length > 0) {
        setRoutines(d);
      } else {
        // First load — seed with imported routines
        setRoutines(IMPORTED_ROUTINES);
        local.set("workout-routines", IMPORTED_ROUTINES);
      }
    });
  }, []);
  useEffect(() => { local.set("workout-routines", routines);  }, [routines]);

  // Global elapsed timer while session active
  useEffect(() => {
    if (active) {
      workoutRef.current = setInterval(() => setWorkoutTimer(t => t + 1), 1000);
    } else {
      clearInterval(workoutRef.current);
      setWorkoutTimer(0);
    }
    return () => clearInterval(workoutRef.current);
  }, [!!active]);

  const startFromRoutine = (routine) => {
    unlockAudio(); // unlock iOS Safari audio on this tap
    setActive({ id: uid(), date: today(), name: routine.name, routineId: routine.id, exercises: routine.exercises });
    setView("home");
  };

  const saveRoutine = (r) => {
    setRoutines(prev => {
      const exists = prev.find(x => x.id === r.id);
      return exists ? prev.map(x => x.id === r.id ? r : x) : [...prev, r];
    });
    setEditingRoutine(null);
    setView("routines");
  };

  const deleteRoutine = (id) => setRoutines(prev => prev.filter(r => r.id !== id));

  // ── Rolling avg stats across ALL sessions for a routine ────────────────────
  // Returns per-exercise: { name, min, max, lastAvg, rollingAvg, sessionCount, trend }
  const rollingAvgStats = (routineId) => {
    const routineSessions = sessions.filter(s => s.routineId === routineId);
    if (!routineSessions.length) return null;

    // Collect all exercise names from the most recent session
    const exNames = routineSessions[0].exercises.map(e => e.name);

    return exNames.map(exName => {
      const allWeights = []; // flat list across all sessions
      const sessionAvgs = []; // one avg per session

      routineSessions.forEach(s => {
        const ex = s.exercises.find(e => e.name === exName);
        if (!ex) return;
        const w = (ex.sets || []).filter(s => s.done && parseFloat(s.weight) > 0).map(s => parseFloat(s.weight));
        if (!w.length) return;
        allWeights.push(...w);
        sessionAvgs.push(w.reduce((a,b) => a+b, 0) / w.length);
      });

      if (!allWeights.length) return { name: exName, min: null, max: null, lastAvg: null, rollingAvg: null, sessionCount: 0, trend: 0 };

      const min         = Math.round(Math.min(...allWeights) * 10) / 10;
      const max         = Math.round(Math.max(...allWeights) * 10) / 10;
      const rollingAvg  = Math.round((allWeights.reduce((a,b) => a+b, 0) / allWeights.length) * 10) / 10;
      const lastAvg     = Math.round(sessionAvgs[0] * 10) / 10;     // most recent session
      const prevAvg     = sessionAvgs.length > 1 ? Math.round(sessionAvgs[1] * 10) / 10 : null;
      const trend       = prevAvg != null ? Math.round((lastAvg - prevAvg) * 10) / 10 : 0;

      return { name: exName, min, max, lastAvg, rollingAvg, sessionCount: sessionAvgs.length, trend };
    });
  };

  // ── handleFinish: save session, then show progressive overload suggestions ──
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [finishedSession, setFinishedSession] = useState(null);

  const handleFinish = (logData, dur) => {
    const finished = {
      id: active.id, date: active.date, name: active.name,
      routineId: active.routineId,
      duration: dur || workoutTimer,
      exercises: logData.map(ex => ({ ...ex, name: ex.name })),
    };
    const updatedSessions = [finished, ...sessions.slice(0, 49)];
    setSessions(updatedSessions);
    local.set("workout-sessions", updatedSessions);
    
    setFinishedSession(finished);
    setActive(null);
    if (active.routineId) setShowSuggestions(true);
  };

  // Auto-update routine base weights with new rolling avgs
  const applyNewBaseWeights = (routineId, newStats) => {
    setRoutines(prev => prev.map(r => {
      if (r.id !== routineId) return r;
      return {
        ...r,
        exercises: r.exercises.map(ex => {
          const stat = newStats.find(s => s.name === ex.name);
          if (!stat?.rollingAvg) return ex;
          return { ...ex, baseWeight: stat.rollingAvg };
        })
      };
    }));
    setShowSuggestions(false);
    setFinishedSession(null);
  };

  // ── Active Tabata session ────────────────────────────────────────────────────
  if (active) return (
    <TabataSession
      session={active}
      workoutTimer={workoutTimer}
      lastStats={active.routineId ? rollingAvgStats(active.routineId) : null}
      onFinish={handleFinish}
    />
  );

  // ── Progressive overload suggestion screen ───────────────────────────────────
  if (showSuggestions && finishedSession?.routineId) {
    // Recompute stats now that the new session is saved
    const routineSessions = [finishedSession, ...sessions.filter(s => s.routineId === finishedSession.routineId && s.id !== finishedSession.id)];
    const exNames = finishedSession.exercises.map(e => e.name);

    const newStats = exNames.map(exName => {
      const allWeights = [];
      const sessionAvgs = [];
      routineSessions.forEach(s => {
        const ex = s.exercises.find(e => e.name === exName);
        if (!ex) return;
        const w = (ex.sets || []).filter(s => s.done && parseFloat(s.weight) > 0).map(s => parseFloat(s.weight));
        if (!w.length) return;
        allWeights.push(...w);
        sessionAvgs.push(w.reduce((a,b) => a+b, 0) / w.length);
      });
      if (!allWeights.length) return { name: exName, rollingAvg: null, lastAvg: null, prevAvg: null, trend: 0 };
      const rollingAvg = Math.round((allWeights.reduce((a,b) => a+b, 0) / allWeights.length) * 10) / 10;
      const lastAvg    = Math.round(sessionAvgs[0] * 10) / 10;
      const prevAvg    = sessionAvgs.length > 1 ? Math.round(sessionAvgs[1] * 10) / 10 : null;
      const trend      = prevAvg != null ? Math.round((lastAvg - prevAvg) * 10) / 10 : 0;
      const routine    = routines.find(r => r.id === finishedSession.routineId);
      const baseWeight = routine?.exercises.find(e => e.name === exName)?.baseWeight ?? null;
      return { name: exName, rollingAvg, lastAvg, prevAvg, trend, baseWeight };
    }).filter(s => s.rollingAvg != null);

    const hasChanges = newStats.some(s => s.baseWeight == null || Math.abs(s.rollingAvg - parseFloat(s.baseWeight)) >= 0.5);

    return (
      <div>
        <div style={{ textAlign: "center", padding: "20px 0 16px" }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📈</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>Session Saved!</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>
            Here's your updated suggested weights
          </div>
        </div>

        {newStats.map(s => {
          const changed = s.baseWeight == null || Math.abs(s.rollingAvg - parseFloat(s.baseWeight)) >= 0.5;
          const up      = s.trend > 0;
          const down    = s.trend < 0;
          return (
            <div key={s.name} style={{ ...cardStyle, marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{s.name}</div>
                  <div style={{ display: "flex", gap: 16, fontSize: 12 }}>
                    <span style={{ color: "rgba(255,255,255,0.4)" }}>
                      Last: <span style={{ color: "#fff", fontWeight: 600 }}>{s.lastAvg} lbs</span>
                    </span>
                    {s.prevAvg != null && (
                      <span style={{ color: "rgba(255,255,255,0.4)" }}>
                        Prev: <span style={{ color: "rgba(255,255,255,0.6)" }}>{s.prevAvg} lbs</span>
                      </span>
                    )}
                  </div>
                  {s.trend !== 0 && (
                    <div style={{ fontSize: 12, marginTop: 4, color: up ? "#27ae60" : "#e74c3c" }}>
                      {up ? "▲" : "▼"} {Math.abs(s.trend)} lbs vs last session
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1 }}>New suggestion</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: changed ? "#f0b429" : "rgba(255,255,255,0.5)" }}>
                    {s.rollingAvg} lbs
                  </div>
                  {s.baseWeight != null && changed && (
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
                      was {s.baseWeight} lbs
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          {hasChanges && (
            <button onClick={() => applyNewBaseWeights(finishedSession.routineId, newStats)}
              style={{ ...btnStyle("#ef6c35"), flex: 1, fontSize: 14 }}>
              Update Routine Weights ✓
            </button>
          )}
          <button onClick={() => { setShowSuggestions(false); setFinishedSession(null); }}
            style={{ ...btnStyle("rgba(255,255,255,0.08)"), flex: hasChanges ? 0 : 1, fontSize: 14, padding: "10px 18px" }}>
            {hasChanges ? "Skip" : "Done"}
          </button>
        </div>

        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.2)", textAlign: "center", marginTop: 12, lineHeight: 1.5 }}>
          Rolling avg across {routineSessions.filter(s => s.exercises.some(e => e.sets?.some(x => x.done))).length} session{routineSessions.length !== 1 ? "s" : ""}
        </div>
      </div>
    );
  }

  // ── Routine editor ───────────────────────────────────────────────────────────
  if (view === "editRoutine") return (
    <RoutineEditor
      routine={editingRoutine}
      onSave={saveRoutine}
      onCancel={() => { setEditingRoutine(null); setView("routines"); }}
    />
  );

  // ── Routines list ────────────────────────────────────────────────────────────
  if (view === "routines") return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <button onClick={() => setView("home")} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: 13, padding: 0 }}>← Back</button>
        <button onClick={() => { setEditingRoutine(null); setView("editRoutine"); }}
          style={btnStyle("#ef6c35", { fontSize: 13, padding: "8px 14px" })}>+ New Routine</button>
      </div>

      {routines.length === 0 && (
        <div style={{ ...emptyStyle, paddingTop: 40 }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>📋</div>
          <div>No routines yet</div>
          <div style={{ fontSize: 12, marginTop: 6, color: "rgba(255,255,255,0.2)" }}>Create one to quickly start a workout</div>
        </div>
      )}

      {routines.map(r => (
        <div key={r.id} style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{r.name}</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{r.exercises.length} exercises</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { setEditingRoutine(r); setView("editRoutine"); }}
                style={btnStyle("rgba(255,255,255,0.08)", { fontSize: 12, padding: "6px 12px" })}>Edit</button>
              <button onClick={() => deleteRoutine(r.id)}
                style={btnStyle("rgba(231,76,60,0.15)", { fontSize: 12, padding: "6px 12px", color: "#e74c3c" })}>Delete</button>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 12 }}>
            {r.exercises.map((e, i) => {
              const stats  = rollingAvgStats(r.id);
              const exStat = stats?.find(s => s.name === e.name);
              return (
                <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: "rgba(239,108,53,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#ef6c35", fontWeight: 700, flexShrink: 0 }}>{i+1}</div>
                  <div style={{ flex: 1 }}>
                    <span style={{ color: "rgba(255,255,255,0.75)" }}>{e.name}</span>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginLeft: 6 }}>{e.sets}×{e.workSec}s / {e.restSec}s</span>
                  </div>
                  {exStat?.rollingAvg != null && (
                    <div style={{ display: "flex", gap: 6, fontSize: 10 }}>
                      <span style={{ color: "#5cb8b2" }}>↓{exStat.min}</span>
                      <span style={{ color: "#ef6c35" }}>↑{exStat.max}</span>
                      <span style={{ color: "#f0b429", fontWeight: 700 }}>≈{exStat.rollingAvg}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button onClick={() => startFromRoutine(r)} style={{ ...btnStyle("#ef6c35"), width: "100%", fontSize: 14 }}>
            ▶ Start This Workout
          </button>
        </div>
      ))}
    </div>
  );

  // ── History ──────────────────────────────────────────────────────────────────
  if (view === "history") return (
    <div>
      <button onClick={() => setView("home")} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 16 }}>← Back</button>
      <div style={sectionHeader}>Session History</div>
      {sessions.length === 0 && <div style={emptyStyle}>No sessions logged yet</div>}
      {sessions.map(s => {
        const totalVol = s.exercises?.reduce((sum, e) =>
          sum + (e.sets || []).filter(x => x.done).reduce((a, st) => a+(parseFloat(st.weight)||0)*(parseInt(st.reps)||0), 0), 0) ?? 0;
        return (
          <div key={s.id} style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{s.name}</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{s.date} · {fmt(s.duration || 0)}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 13, color: "#ef6c35", fontWeight: 700 }}>{totalVol.toLocaleString()} lbs</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>volume</div>
              </div>
            </div>
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
              {s.exercises?.map(e => (
                <div key={e.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "rgba(255,255,255,0.65)" }}>{e.name}</span>
                  <span style={{ color: "rgba(255,255,255,0.4)" }}>
                    {(e.sets||[]).filter(x=>x.done).length} sets · {(e.sets||[]).filter(x=>x.done).map(x=>`${x.weight}×${x.reps}`).join(", ")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );

  // ── Home ─────────────────────────────────────────────────────────────────────
  return (
    <div>
      <div style={sectionHeader}>Start Workout</div>

      {routines.length > 0 ? (
        <div style={{ marginBottom: 16 }}>
          {routines.map(r => {
            const stats = rollingAvgStats(r.id);
            return (
              <button key={r.id} onClick={() => startFromRoutine(r)}
                style={{
                  width: "100%", textAlign: "left", marginBottom: 8, cursor: "pointer",
                  background: "rgba(239,108,53,0.08)", border: "1px solid rgba(239,108,53,0.2)",
                  borderRadius: 12, padding: "12px 14px", color: "#fff",
                }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: stats ? 10 : 0 }}>
                  <div style={{ flex: 1, paddingRight: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{r.name}</div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 3 }}>
                      {r.exercises.length} exercises · {fmt(routineTotalSec(r.exercises))}
                    </div>
                  </div>
                  <div style={{ fontSize: 22, color: "#ef6c35", flexShrink: 0 }}>▶</div>
                </div>
                {stats && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {stats.filter(s => s.rollingAvg != null).map(s => (
                      <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", flex: 1 }}>{s.name}</div>
                        <div style={{ display: "flex", gap: 10, fontSize: 11 }}>
                          <span style={{ color: "#5cb8b2" }}>↓ {s.min}</span>
                          <span style={{ color: "#ef6c35" }}>↑ {s.max}</span>
                          <span style={{ color: "#f0b429", fontWeight: 700 }}>≈ {s.rollingAvg} lbs</span>
                          {s.trend !== 0 && (
                            <span style={{ color: s.trend > 0 ? "#27ae60" : "#e74c3c" }}>
                              {s.trend > 0 ? "▲" : "▼"}{Math.abs(s.trend)}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div style={{ ...cardStyle, textAlign: "center", padding: "24px 16px", marginBottom: 16 }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>📋</div>
          <div style={{ fontSize: 14, color: "rgba(255,255,255,0.45)", marginBottom: 12 }}>Build a routine to start fast</div>
          <button onClick={() => setView("routines")} style={btnStyle("rgba(239,108,53,0.2)", { fontSize: 13, color: "#ef6c35" })}>Create Your First Routine</button>
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => setView("routines")} style={{ ...btnStyle("rgba(255,255,255,0.08)"), flex: 1, fontSize: 13 }}>📋 Routines</button>
        <button onClick={() => setView("history")}  style={{ ...btnStyle("rgba(255,255,255,0.08)"), flex: 1, fontSize: 13 }}>🕐 History</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOVEMENT TAB
// ═══════════════════════════════════════════════════════════════════════════════
function MovementTab() {
  const [data, setData] = useState({ steps: "", calories: "", activeMin: "", heartRate: "", distance: "", standHours: "" });
  const [saved, setSaved] = useState(null);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    local.get("movement-history").then(d => { if (d) setHistory(d); });
    local.get(`movement-${today()}`).then(d => { if (d) { setData(d); setSaved(d); } });
  }, []);

  const save = () => {
    local.set(`movement-${today()}`, data);
    setSaved({ ...data });
    setHistory(prev => {
      const filtered = prev.filter(e => e.date !== today());
      const updated = [{ ...data, date: today() }, ...filtered].slice(0, 30);
      local.set("movement-history", updated);
      return updated;
    });
    
  };

  const GOALS = { steps: 10000, calories: 600, activeMin: 60, standHours: 12 };

  return (
    <div>
      <div style={sectionHeader}>Today · {new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}</div>

      {/* Rings row */}
      {saved && (
        <div style={{ ...cardStyle, display: "flex", justifyContent: "space-around", padding: "20px 8px", marginBottom: 16 }}>
          <Ring value={parseInt(saved.steps)||0} max={GOALS.steps} color="#ef6c35" size={72} stroke={7} label={((parseInt(saved.steps)||0)/1000).toFixed(1)+"k"} sublabel="Steps" />
          <Ring value={parseInt(saved.calories)||0} max={GOALS.calories} color="#f0b429" size={72} stroke={7} label={saved.calories||"0"} sublabel="Cal" />
          <Ring value={parseInt(saved.activeMin)||0} max={GOALS.activeMin} color="#5cb8b2" size={72} stroke={7} label={saved.activeMin||"0"} sublabel="Min" />
          <Ring value={parseInt(saved.standHours)||0} max={GOALS.standHours} color="#9b59b6" size={72} stroke={7} label={saved.standHours||"0"} sublabel="Stand" />
        </div>
      )}

      {/* Input grid */}
      <div style={cardStyle}>
        <div style={labelStyle}>Log Today's Activity</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
          {[
            { key: "steps", label: "Steps", placeholder: "e.g. 8500", unit: "steps" },
            { key: "calories", label: "Active Calories", placeholder: "e.g. 450", unit: "kcal" },
            { key: "activeMin", label: "Active Minutes", placeholder: "e.g. 45", unit: "min" },
            { key: "distance", label: "Distance", placeholder: "e.g. 3.2", unit: "miles" },
            { key: "heartRate", label: "Avg Heart Rate", placeholder: "e.g. 72", unit: "bpm" },
            { key: "standHours", label: "Stand Hours", placeholder: "e.g. 10", unit: "hrs" },
          ].map(({ key, label, placeholder, unit }) => (
            <div key={key}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.8 }}>{label}</div>
              <div style={{ position: "relative" }}>
                <input value={data[key]} onChange={e => setData(d => ({ ...d, [key]: e.target.value }))}
                  placeholder={placeholder} type="number"
                  style={{ ...inputStyle, paddingRight: 36 }} />
                <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "rgba(255,255,255,0.25)" }}>{unit}</span>
              </div>
            </div>
          ))}
        </div>
        <button onClick={save} style={{ ...btnStyle("#ef6c35"), width: "100%", marginTop: 14 }}>Save Today</button>
      </div>

      {/* 7-day history */}
      {history.length > 1 && (
        <div style={cardStyle}>
          <div style={labelStyle}>7-Day Steps</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 60, marginTop: 12 }}>
            {history.slice(0, 7).reverse().map((d, i) => {
              const h = Math.max(4, ((parseInt(d.steps)||0) / GOALS.steps) * 56);
              return (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div style={{ width: "100%", height: h, background: "linear-gradient(180deg, #ef6c35, #c0392b)", borderRadius: "3px 3px 0 0" }} />
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{d.date?.slice(5)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// FOOD SEARCH via Open Food Facts
// ═══════════════════════════════════════════════════════════════════════════════
async function searchFood(query) {
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=8&fields=product_name,brands,nutriments,serving_size,serving_quantity`;
  const res = await fetch(url);
  const data = await res.json();
  return (data.products || [])
    .filter(p => p.product_name && p.nutriments)
    .map(p => {
      const n = p.nutriments;
      // Prefer per-serving values, fall back to per-100g
      const factor = p.serving_quantity ? p.serving_quantity / 100 : 1;
      const cal100  = n["energy-kcal_100g"] || n["energy-kcal"] || 0;
      const prot100 = n["proteins_100g"] || n["proteins"] || 0;
      const carb100 = n["carbohydrates_100g"] || n["carbohydrates"] || 0;
      const fat100  = n["fat_100g"] || n["fat"] || 0;
      return {
        name: p.product_name + (p.brands ? ` (${p.brands.split(",")[0].trim()})` : ""),
        servingLabel: p.serving_size || "100g",
        servingQty: p.serving_quantity || 100,
        per100: { calories: Math.round(cal100), protein: Math.round(prot100*10)/10, carbs: Math.round(carb100*10)/10, fat: Math.round(fat100*10)/10 },
        calories: Math.round(cal100 * factor),
        protein:  Math.round(prot100 * factor * 10) / 10,
        carbs:    Math.round(carb100 * factor * 10) / 10,
        fat:      Math.round(fat100  * factor * 10) / 10,
      };
    });
}

// ─── Food Search Panel ────────────────────────────────────────────────────────
function FoodSearchPanel({ mealType, onAdd }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [servings, setServings] = useState(1);
  const debounceRef = useRef(null);

  const doSearch = useCallback(async (q) => {
    if (!q.trim() || q.trim().length < 2) { setResults([]); return; }
    setLoading(true); setError(""); setSelected(null);
    try {
      const r = await searchFood(q);
      setResults(r);
      if (r.length === 0) setError("No results — try a different name");
    } catch {
      setError("Search failed — check connection");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 600);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  const scaled = selected ? {
    calories: Math.round(selected.per100.calories * (selected.servingQty / 100) * servings),
    protein:  Math.round(selected.per100.protein  * (selected.servingQty / 100) * servings * 10) / 10,
    carbs:    Math.round(selected.per100.carbs     * (selected.servingQty / 100) * servings * 10) / 10,
    fat:      Math.round(selected.per100.fat       * (selected.servingQty / 100) * servings * 10) / 10,
  } : null;

  const handleAdd = () => {
    if (!selected) return;
    onAdd({
      id: uid(),
      name: selected.name,
      meal: mealType,
      servings,
      servingLabel: selected.servingLabel,
      ...scaled,
    });
    setQuery(""); setResults([]); setSelected(null); setServings(1);
  };

  return (
    <div>
      {/* Search input */}
      <div style={{ position: "relative", marginBottom: 8 }}>
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setSelected(null); }}
          placeholder="Search food (e.g. chicken breast, oats…)"
          style={{ ...inputStyle, paddingRight: 36 }}
        />
        {loading && (
          <div style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: "rgba(255,255,255,0.4)" }}>⟳</div>
        )}
      </div>

      {error && <div style={{ fontSize: 12, color: "#e74c3c", marginBottom: 8 }}>{error}</div>}

      {/* Results list */}
      {!selected && results.length > 0 && (
        <div style={{ background: "rgba(0,0,0,0.4)", borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)", marginBottom: 10 }}>
          {results.map((r, i) => (
            <button key={i} onClick={() => { setSelected(r); setServings(1); }}
              style={{
                width: "100%", background: "none", border: "none", borderBottom: i < results.length-1 ? "1px solid rgba(255,255,255,0.06)" : "none",
                padding: "10px 12px", cursor: "pointer", textAlign: "left", color: "#fff",
              }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{r.name}</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                {r.servingLabel} · {r.calories} kcal · P:{r.protein}g · C:{r.carbs}g · F:{r.fat}g
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Selected food + servings */}
      {selected && scaled && (
        <div style={{ background: "rgba(239,108,53,0.1)", border: "1px solid rgba(239,108,53,0.3)", borderRadius: 12, padding: 12, marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{selected.name}</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 10 }}>per {selected.servingLabel}</div>

          {/* Serving adjuster */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>Servings:</div>
            <button onClick={() => setServings(s => Math.max(0.25, Math.round((s - 0.25)*4)/4))}
              style={{ ...btnStyle("rgba(255,255,255,0.1)", { padding: "4px 10px", fontSize: 16 }) }}>−</button>
            <div style={{ fontWeight: 700, fontSize: 16, minWidth: 32, textAlign: "center" }}>{servings}</div>
            <button onClick={() => setServings(s => Math.round((s + 0.25)*4)/4)}
              style={{ ...btnStyle("rgba(255,255,255,0.1)", { padding: "4px 10px", fontSize: 16 }) }}>+</button>
          </div>

          {/* Scaled macros */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginBottom: 12 }}>
            {[["Calories", scaled.calories, "#fff", "kcal"],
              ["Protein",  scaled.protein,  MACRO_COLORS.protein, "g"],
              ["Carbs",    scaled.carbs,    MACRO_COLORS.carbs,   "g"],
              ["Fat",      scaled.fat,      MACRO_COLORS.fat,     "g"]
            ].map(([label, val, color, unit]) => (
              <div key={label} style={{ background: "rgba(255,255,255,0.06)", borderRadius: 8, padding: "8px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 15, fontWeight: 700, color }}>{val}</div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleAdd} style={{ ...btnStyle("#ef6c35"), flex: 1 }}>Add to {mealType}</button>
            <button onClick={() => { setSelected(null); }}
              style={{ ...btnStyle("rgba(255,255,255,0.08)", { padding: "10px 14px" }) }}>✕</button>
          </div>
        </div>
      )}

      {/* Manual entry toggle */}
      {!selected && (
        <ManualFoodEntry mealType={mealType} onAdd={onAdd} />
      )}
    </div>
  );
}

function ManualFoodEntry({ mealType, onAdd }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", calories: "", protein: "", carbs: "", fat: "" });

  const handleAdd = () => {
    if (!form.name.trim()) return;
    onAdd({ id: uid(), meal: mealType, servingLabel: "custom", servings: 1, ...form });
    setForm({ name: "", calories: "", protein: "", carbs: "", fat: "" });
    setOpen(false);
  };

  if (!open) return (
    <button onClick={() => setOpen(true)}
      style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 12, padding: "4px 0" }}>
      + Enter macros manually
    </button>
  );

  return (
    <div style={{ marginTop: 8, background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: 12, border: "1px solid rgba(255,255,255,0.08)" }}>
      <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        placeholder="Food name" style={{ ...inputStyle, marginBottom: 8 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginBottom: 8 }}>
        {[["calories","Cal"],["protein","Pro"],["carbs","Carb"],["fat","Fat"]].map(([k,l]) => (
          <div key={k}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 3, textAlign: "center" }}>{l}</div>
            <input value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
              type="number" placeholder="0" style={{ ...inputStyle, textAlign: "center", padding: "7px 4px", fontSize: 13 }} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={handleAdd} style={{ ...btnStyle("#ef6c35"), flex: 1, fontSize: 13 }}>Add</button>
        <button onClick={() => setOpen(false)} style={{ ...btnStyle("rgba(255,255,255,0.08)", { fontSize: 13 }) }}>Cancel</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// NUTRITION TAB
// ═══════════════════════════════════════════════════════════════════════════════
function NutritionTab() {
  const [meals, setMeals] = useState([]);
  const [goals, setGoals] = useState({ calories: 2200, protein: 180, carbs: 220, fat: 65 });
  const [activeMeal, setActiveMeal] = useState("Breakfast");
  const [showGoals, setShowGoals] = useState(false);

  useEffect(() => {
    local.get(`meals-${today()}`).then(d => d && setMeals(d));
    local.get("nutrition-goals").then(d => d && setGoals(d));
  }, []);
  useEffect(() => { local.set(`meals-${today()}`, meals);  }, [meals]);

  const totals = meals.reduce((acc, m) => ({
    calories: acc.calories + (parseInt(m.calories)||0),
    protein:  acc.protein  + (parseFloat(m.protein)||0),
    carbs:    acc.carbs    + (parseFloat(m.carbs)||0),
    fat:      acc.fat      + (parseFloat(m.fat)||0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

  const saveGoals = () => { local.set("nutrition-goals", goals);  setShowGoals(false); };

  const MEAL_TYPES = ["Breakfast", "Lunch", "Dinner", "Snack", "Pre-workout", "Post-workout"];

  return (
    <div>
      {/* Summary */}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -1 }}>{Math.round(totals.calories).toLocaleString()}</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1 }}>of {goals.calories.toLocaleString()} kcal</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: goals.calories - totals.calories >= 0 ? "#27ae60" : "#ef6c35" }}>
              {Math.abs(Math.round(goals.calories - totals.calories))}
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{goals.calories - totals.calories >= 0 ? "remaining" : "over"}</div>
          </div>
        </div>
        <MacroBar label="Protein" value={Math.round(totals.protein)} goal={goals.protein} color={MACRO_COLORS.protein} />
        <MacroBar label="Carbs"   value={Math.round(totals.carbs)}   goal={goals.carbs}   color={MACRO_COLORS.carbs} />
        <MacroBar label="Fat"     value={Math.round(totals.fat)}     goal={goals.fat}     color={MACRO_COLORS.fat} />
        <button onClick={() => setShowGoals(g => !g)}
          style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 12, marginTop: 4, padding: 0 }}>
          {showGoals ? "Hide" : "Edit"} Goals
        </button>
      </div>

      {showGoals && (
        <div style={cardStyle}>
          <div style={labelStyle}>Daily Goals</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
            {Object.entries(goals).map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 4, textTransform: "capitalize" }}>{k} {k === "calories" ? "(kcal)" : "(g)"}</div>
                <input value={v} type="number" onChange={e => setGoals(g => ({ ...g, [k]: parseInt(e.target.value)||0 }))} style={inputStyle} />
              </div>
            ))}
          </div>
          <button onClick={saveGoals} style={{ ...btnStyle("#ef6c35"), width: "100%", marginTop: 12 }}>Save Goals</button>
        </div>
      )}

      {/* Meal type selector */}
      <div style={cardStyle}>
        <div style={labelStyle}>Log Food</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12, marginTop: 8 }}>
          {MEAL_TYPES.map(m => (
            <button key={m} onClick={() => setActiveMeal(m)}
              style={{ ...chipStyle, background: activeMeal === m ? "#ef6c35" : "rgba(255,255,255,0.08)", color: activeMeal === m ? "#fff" : "rgba(255,255,255,0.5)", fontSize: 11 }}>
              {m}
            </button>
          ))}
        </div>
        <FoodSearchPanel
          mealType={activeMeal}
          onAdd={(food) => setMeals(m => [...m, food])}
        />
      </div>

      {/* Meal log grouped */}
      {MEAL_TYPES.filter(m => meals.some(f => f.meal === m)).map(mealType => (
        <div key={mealType} style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{mealType}</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
              {Math.round(meals.filter(f => f.meal === mealType).reduce((s,f) => s+(parseInt(f.calories)||0), 0))} kcal
            </div>
          </div>
          {meals.filter(f => f.meal === mealType).map(food => (
            <div key={food.id} style={{ padding: "8px 0", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1, paddingRight: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{food.name}</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
                    {food.servings && food.servings !== 1 ? `${food.servings}× ` : ""}{food.servingLabel || ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{Math.round(food.calories)}</div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>kcal</div>
                  </div>
                  <button onClick={() => setMeals(m => m.filter(x => x.id !== food.id))}
                    style={{ background: "none", border: "none", color: "rgba(255,255,255,0.2)", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
                {[["P", food.protein, MACRO_COLORS.protein], ["C", food.carbs, MACRO_COLORS.carbs], ["F", food.fat, MACRO_COLORS.fat]].map(([l,v,c]) => (
                  v ? <span key={l} style={{ fontSize: 11, color: c, fontWeight: 600 }}>{l} {Math.round(v*10)/10}g</span> : null
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}

      {meals.length === 0 && <div style={emptyStyle}>Search for a food above to start logging</div>}
    </div>
  );
}

// ─── Shared styles ─────────────────────────────────────────────────────────────
const btnStyle = (bg, extra = {}) => ({
  background: bg, border: "none", color: "#fff", borderRadius: 10,
  padding: "10px 16px", cursor: "pointer", fontSize: 14, fontWeight: 700,
  letterSpacing: 0.3, ...extra
});
const cardStyle = { background: "rgba(255,255,255,0.05)", borderRadius: 14, padding: "14px 16px", marginBottom: 12, border: "1px solid rgba(255,255,255,0.07)" };
const inputStyle = { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#fff", padding: "9px 12px", fontSize: 14, width: "100%", boxSizing: "border-box", outline: "none" };
const chipStyle = { border: "none", borderRadius: 20, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600, transition: "all 0.15s" };
const labelStyle = { fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, color: "rgba(255,255,255,0.35)", fontWeight: 600 };
const sectionHeader = { fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, color: "rgba(255,255,255,0.3)", fontWeight: 600, marginBottom: 12 };
const emptyStyle = { textAlign: "center", color: "rgba(255,255,255,0.2)", fontSize: 14, padding: "24px 0" };

// ═══════════════════════════════════════════════════════════════════════════════
// BACKUP DRAWER — export / import JSON for Drive backup
// ═══════════════════════════════════════════════════════════════════════════════
function BackupDrawer({ onClose }) {
  const [mode, setMode]     = useState("menu");
  const [json, setJson]     = useState("");
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState("");
  const [summary, setSummary] = useState(null);

  const doExport = async () => {
    setMode("export");
    setStatus("Reading data…");
    const data = await exportAllData();
    setJson(data);
    // Build summary
    try {
      const parsed = JSON.parse(data);
      setSummary({
        sessions:  (parsed["workout-sessions"] || []).length,
        routines:  (parsed["workout-routines"] || []).length,
        mealDays:  Object.keys(parsed).filter(k => k.startsWith("meals-")).length,
        moveDays:  Object.keys(parsed).filter(k => k.startsWith("movement-")).length,
        savedAt:   new Date().toLocaleString(),
      });
    } catch {}
    setStatus("");
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch { setCopied(false); }
  };

  const shareData = async () => {
    try {
      await navigator.share({ title: "FitLog Backup", text: json });
    } catch { copyToClipboard(); }
  };

  const doImport = async () => {
    try {
      setStatus("Importing…");
      await importAllData(json);
      setStatus("✓ Restored! Pull down to refresh the app.");
    } catch {
      setStatus("Invalid data — make sure you pasted the full backup JSON.");
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 100, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#1a1218", borderRadius: "20px 20px 0 0", padding: "20px 20px 48px", maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontWeight: 800, fontSize: 18 }}>💾 Save & Restore</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: 22, cursor: "pointer" }}>×</button>
        </div>

        {mode === "menu" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>What gets saved</div>
              {[
                ["🏋️", "All workout sessions", "weights, reps, volume history"],
                ["📋", "Your routines", "exercises, timers, base weights"],
                ["🥗", "Nutrition logs", "meals and macro history"],
                ["🏃", "Movement data", "steps, calories, activity"],
              ].map(([icon, title, sub]) => (
                <div key={title} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{ fontSize: 20 }}>{icon}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{sub}</div>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={doExport} style={{ ...btnStyle("#ef6c35"), width: "100%", fontSize: 15, padding: "13px" }}>
              ↑ Export / Save Data
            </button>
            <button onClick={() => setMode("import")} style={{ ...btnStyle("rgba(255,255,255,0.08)"), width: "100%", fontSize: 15, padding: "13px" }}>
              ↓ Import / Restore Data
            </button>
          </div>
        )}

        {mode === "export" && (
          <div>
            {status && <div style={{ fontSize: 13, color: "#f0b429", marginBottom: 12 }}>{status}</div>}
            {summary && (
              <div style={{ ...cardStyle, marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>Backup includes</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {[
                    [`${summary.sessions} sessions`, "workout history"],
                    [`${summary.routines} routines`, "with base weights"],
                    [`${summary.mealDays} meal days`, "nutrition logs"],
                    [`${summary.moveDays} activity days`, "movement data"],
                  ].map(([v, l]) => (
                    <div key={l} style={{ background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "#ef6c35" }}>{v}</div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{l}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginTop: 8 }}>Exported {summary.savedAt}</div>
              </div>
            )}
            {json && (
              <>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 10 }}>
                  Save this to Google Drive, Notes, iCloud, or email it to yourself.
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <button onClick={shareData} style={{ ...btnStyle("#ef6c35"), flex: 1, fontSize: 14 }}>
                    Share / Save…
                  </button>
                  <button onClick={copyToClipboard} style={{ ...btnStyle(copied ? "#27ae60" : "rgba(255,255,255,0.1)"), flex: 1, fontSize: 14 }}>
                    {copied ? "Copied ✓" : "Copy"}
                  </button>
                </div>
                <textarea readOnly value={json}
                  style={{ ...inputStyle, height: 120, fontSize: 10, fontFamily: "monospace", resize: "none" }} />
              </>
            )}
            <button onClick={() => setMode("menu")} style={{ ...btnStyle("rgba(255,255,255,0.06)"), width: "100%", marginTop: 10, fontSize: 13 }}>← Back</button>
          </div>
        )}

        {mode === "import" && (
          <div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 12, lineHeight: 1.6 }}>
              Paste your previously exported backup JSON below. This will restore all your workout sessions, routines, and nutrition data.
            </div>
            <textarea value={json} onChange={e => setJson(e.target.value)}
              placeholder="Paste your backup JSON here…"
              style={{ ...inputStyle, height: 220, fontSize: 11, fontFamily: "monospace", resize: "none", marginBottom: 10 }} />
            {status && (
              <div style={{ fontSize: 13, color: status.includes("✓") ? "#27ae60" : "#e74c3c", marginBottom: 10, lineHeight: 1.5 }}>
                {status}
              </div>
            )}
            <button onClick={doImport} disabled={!json.trim()}
              style={{ ...btnStyle(!json.trim() ? "rgba(255,255,255,0.1)" : "#ef6c35"), width: "100%", fontSize: 15, padding: "13px", opacity: !json.trim() ? 0.5 : 1 }}>
              Restore Data
            </button>
            <button onClick={() => setMode("menu")} style={{ ...btnStyle("rgba(255,255,255,0.06)"), width: "100%", marginTop: 8, fontSize: 13 }}>← Back</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT APP
// ═══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [tab, setTab]               = useState(0);
  const [showBackup, setShowBackup] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings]     = useState(DEFAULT_SETTINGS);

  // Load settings from storage on mount
  useEffect(() => {
    local.get("app-settings").then(s => { if (s) setSettings(s); });
  }, []);

  // Unlock audio on very first tap anywhere — critical for iOS Safari PWA
  useEffect(() => {
    const unlock = () => { unlockAudio(); document.removeEventListener("touchstart", unlock); document.removeEventListener("mousedown", unlock); };
    document.addEventListener("touchstart", unlock, { once: true, passive: true });
    document.addEventListener("mousedown",  unlock, { once: true });
    return () => { document.removeEventListener("touchstart", unlock); document.removeEventListener("mousedown", unlock); };
  }, []);

  const updateSettings = (newSettings) => {
    setSettings(newSettings);
    local.set("app-settings", newSettings);
  };

  return (
    <SettingsCtx.Provider value={settings}>
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(160deg, #0f0f14 0%, #1a1218 50%, #0f1418 100%)",
      color: "#fff",
      fontFamily: "'DM Sans', 'SF Pro Display', -apple-system, sans-serif",
      maxWidth: 430, margin: "0 auto",
    }}>
      {showBackup   && <BackupDrawer onClose={() => setShowBackup(false)} />}
      {showSettings && <SettingsDrawer settings={settings} onChange={updateSettings} onClose={() => setShowSettings(false)} />}

      {/* Header */}
      <div style={{ padding: "20px 20px 0", position: "sticky", top: 0, background: "linear-gradient(160deg, #0f0f14, #1a1218)", zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5 }}>FitLog</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
              {new Date().toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowSettings(true)}
              style={{ background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 20, padding: "6px 12px", cursor: "pointer", color: "rgba(255,255,255,0.5)", fontSize: 12 }}>
              ⚙️ Settings
            </button>
            <button onClick={() => setShowBackup(true)}
              style={{ background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 20, padding: "6px 12px", cursor: "pointer", color: "rgba(255,255,255,0.5)", fontSize: 12 }}>
              📦
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display: "flex", background: "rgba(255,255,255,0.06)", borderRadius: 12, padding: 3, marginBottom: 4 }}>
          {TABS.map((t, i) => (
            <button key={t} onClick={() => setTab(i)} style={{
              flex: 1, border: "none", borderRadius: 10, padding: "9px 4px",
              background: tab === i ? "rgba(255,255,255,0.12)" : "none",
              color: tab === i ? "#fff" : "rgba(255,255,255,0.4)",
              fontSize: 13, fontWeight: tab === i ? 700 : 500, cursor: "pointer",
              transition: "all 0.2s"
            }}>
              {["🏋️ Workout","🏃 Movement","🥗 Nutrition"][i]}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "16px 20px 40px" }}>
        {tab === 0 && <WorkoutTab />}
        {tab === 1 && <MovementTab />}
        {tab === 2 && <NutritionTab />}
      </div>
    </div>
    </SettingsCtx.Provider>
  );
}
