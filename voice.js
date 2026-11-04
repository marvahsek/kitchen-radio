'use strict';

/* ---------- voice control ----------
   Runs entirely on the phone with Vosk (offline speech recognition). Two recognisers share one model:
   - wakeRec listens for "Kishori" among a few hundred everyday words, which soak up ordinary talk and
     lyrics. The model doesn't know "Kishori", so it is spelled by sound ("kish ori", "ki shorty").
   - cmdRec only knows the command phrases, so Indian names come out right ("mara thi", "vee jay").
   After the wake word, audio goes to cmdRec for a few seconds, then back to wakeRec.

   Brindavan bhajans sing "Kishori" a lot, so while music plays a plain "Kishori" only counts if a
   command follows in the same breath ("Kishori, next song"), checked silently. "Kishori Maa" always
   opens the listening window. */

const VOICE_LIB = 'vendor/vosk-browser-0.0.8.js';
const VOICE_MODEL = new URL('models/vosk-model-small-en-in-0.4.tar.gz', location.href).href;

const WAKE_PLAIN = ['kish ori', 'ki shorty', 'ki sorry', 'key shorty'];
const WAKE_STRONG = WAKE_PLAIN.map((p) => p + ' ma');
const WAKE_ENDS = new Set(['ori', 'shorty', 'sorry']);
const WAKE_MIN_CONF = 0.55;
// Everyday English, Hindi and Tamil words for wakeRec to put non-wake speech into. Words the model
// doesn't know are dropped by Vosk.
const WAKE_GARBAGE = ('the be to of and a in that have i it for not on with he as you do at this but his by from they we say her she or an ' +
  'will my one all would there their what so up out if about who get which go me when make can like time no just him know take people ' +
  'into year your good some could them see other than then now look only come its over think also back after use two how our work first ' +
  'well way even new want because any these give day most us is are was were been has had did said says going went got made very much ' +
  'more many lot yes okay ok oh ah hmm hey hi hello please thank thanks sorry sure right here where why tell call phone mother father ' +
  'baby kids child food rice milk tea water salt sugar dal curry roti cooker gas fire hot cold eat wait stop enough start done ready let ' +
  'put keep bring open close door fridge kitchen house home today tomorrow morning evening night week money car keys clean wash cut boil ' +
  'cook fry song songs music love heart life dream sky rain moon sun god ram krishna radha hari jai ma pa na ka ra ha ho hum main yeh ' +
  'wo vo ne se ki ko par tho anna amma po').split(' ');
// Everyday words give cmdRec somewhere to put speech that isn't a command.
const FILLERS = ('i you we he she it they the a an is are was to of and in on at for with this that what yes no not do did ' +
  'have has my your our now so but just very like oh uh um ah hmm come go get give take make put here there where when how why who can will would should')
  .split(' ');

const NUM_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  'twenty five': 25, thirty: 30, 'thirty five': 35, forty: 40, 'forty five': 45, fifty: 50, sixty: 60, ninety: 90,
};
const TIMER_FORMS = ['timer {n} minutes', 'timer {n} minute', 'timer for {n} minutes', 'set timer {n} minutes', 'set timer for {n} minutes',
  'set a timer for {n} minutes', '{n} minute timer', '{n} minutes timer', 'start {n} minute timer'];

const voice = {
  state: 'off', mode: 'idle', model: null, wakeRec: null, cmdRec: null, sampleRate: 48000,
  stream: null, src: null, node: null, ring: [],
  commands: new Map(), prefixes: new Set(),
  lastPartial: '', partialAt: 0, listenStart: 0, listenUntil: 0, cooldownUntil: 0,
};

const sayWords = (m) => (m.say || '').split(',')
  .map((s) => s.toLowerCase().replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);

function reply(text) { say(text); }

function buildCommands() {
  const C = new Map();
  const add = (phrases, fn) => phrases.forEach((p) => C.set(p, fn));
  const needMood = (fn) => () => (currentMood ? fn() : reply('Nothing is playing'));

  add(['play', 'play music', 'just play', 'start music', 'play songs', 'play some music', 'play something'], () => {
    const m = pickJustPlay();
    if (!m) return reply('Please add a playlist first');
    playMood(m); reply(`Playing ${m.name}`);
  });
  for (const m of cfg.moods) {
    if (!m.list) continue;
    for (const w of sayWords(m)) {
      add([w, `play ${w}`, `${w} songs`, `play ${w} songs`, `${w} music`, `play ${w} music`], () => { playMood(m); reply(`Playing ${m.name}`); });
    }
  }
  add(['stop', 'stop music', 'stop the music', 'stop it', 'stop playing'], () => {
    if (alarmTimer) return dismissAlarm();
    stopMusic();
  });
  add(['pause', 'pause music', 'pause the music'], needMood(() => { if (isPlaying) togglePlay(); }));
  add(['resume', 'continue', 'resume music', 'play again'], needMood(() => { if (!isPlaying) togglePlay(); }));
  add(['next', 'next song', 'skip', 'skip song', 'skip this', 'change song', 'change the song', 'another song'], needMood(() => player.nextVideo()));
  add(['previous', 'previous song', 'go back', 'last song'], needMood(() => player.previousVideo()));
  add(['shuffle', 'shuffle songs'], needMood(() => startShuffled()));
  add(['louder', 'volume up', 'increase volume', 'increase the volume', 'more volume', 'turn it up'], () => setVolume(cfg.volume + 15));
  add(['softer', 'quieter', 'volume down', 'decrease volume', 'decrease the volume', 'lower volume', 'lower the volume', 'less volume', 'turn it down'],
    () => setVolume(cfg.volume - 15));

  for (const [word, n] of Object.entries(NUM_WORDS)) {
    add(TIMER_FORMS.map((f) => f.replace('{n}', word)), () => { addTimer(n); reply(`Timer set for ${n} minute${n === 1 ? '' : 's'}`); });
  }
  add(['timer for half an hour', 'half an hour timer', 'set timer for half an hour'], () => { addTimer(30); reply('Timer set for 30 minutes'); });
  add(['cancel timer', 'stop timer', 'cancel the timer', 'stop the timer', 'cancel timers', 'cancel all timers', 'stop alarm', 'stop the alarm'], () => {
    if (alarmTimer) return dismissAlarm();
    if (!timers.length) return reply('There are no timers');
    timers = []; saveTimers(); renderTimers(); reply('Timers cancelled');
  });
  add(['what time is it', 'what is the time', 'tell me the time'], () => {
    const d = new Date();
    reply(`It's ${d.getHours() % 12 || 12} ${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'A M' : 'P M'}`);
  });
  add(['what is playing', 'what song is this', 'which song is this', 'what is this song'], needMood(() => {
    const d = player.getVideoData?.() || {};
    reply(d.title ? `This is ${d.title}` : 'I am not sure');
  }));
  add(['thank you', 'thanks', 'never mind', 'cancel', 'nothing'], () => { if (alarmTimer) dismissAlarm(); });

  const keys = [...C.keys()];
  voice.prefixes = new Set(keys.filter((k) => keys.some((o) => o.startsWith(k + ' '))));
  return C;
}

function rebuildCommands() {
  voice.commands = buildCommands();
  renderVoiceHints();
  if (!voice.model) return;
  voice.cmdRec?.remove();
  const grammar = [...new Set([...voice.commands.keys(), ...WAKE_PLAIN, ...WAKE_STRONG, ...FILLERS]), '[unk]'];
  voice.cmdRec = new voice.model.KaldiRecognizer(voice.sampleRate, JSON.stringify(grammar));
  voice.cmdRec.setWords(true);
  voice.cmdRec.on('partialresult', (m) => onCmdPartial(m.result.partial || ''));
  voice.cmdRec.on('result', (m) => onCmdResult(m.result));
}

/* ---------- starting and stopping ---------- */

function loadScript(src) {
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => fail(new Error('Could not load ' + src));
    document.head.append(s);
  });
}

// opts.noMic loads everything except the microphone (used by voiceTestFile on a computer).
async function voiceStart(opts = {}) {
  if (voice.state === 'loading' || voice.state === 'ready' || voice.state === 'listening') return;
  setVoiceState('loading', 'Starting the microphone…');
  try {
    ensureAudio();
    voice.sampleRate = actx.sampleRate;
    if (!opts.noMic) {
      voice.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: cfg.voice.echo, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    }
    if (!voice.model) {
      setVoiceState('loading', 'Loading voice… (first time only, about 40 MB)');
      if (!window.Vosk) await loadScript(VOICE_LIB);
      voice.model = await Vosk.createModel(VOICE_MODEL, -2);
    }
    voice.wakeRec?.remove();
    const wakeGrammar = [...new Set([...WAKE_GARBAGE, ...WAKE_PLAIN, ...WAKE_STRONG]), '[unk]'];
    voice.wakeRec = new voice.model.KaldiRecognizer(voice.sampleRate, JSON.stringify(wakeGrammar));
    voice.wakeRec.setWords(true);
    voice.wakeRec.on('partialresult', (m) => onWakePartial(m.result.partial || ''));
    voice.wakeRec.on('result', (m) => onWakeResult(m.result));
    rebuildCommands();
    if (voice.stream) {
      voice.src = actx.createMediaStreamSource(voice.stream);
      voice.node = actx.createScriptProcessor(4096, 1, 1);
      voice.node.onaudioprocess = (e) => onAudio(e.inputBuffer.getChannelData(0));
      voice.src.connect(voice.node);
      voice.node.connect(actx.destination); // outputs silence; Chrome only runs the processor when it's connected
    }
    voice.mode = 'idle';
    setVoiceState('ready');
  } catch (err) {
    console.error(err);
    voiceStop();
    setVoiceState('error', err?.name === 'NotAllowedError'
      ? 'Microphone is blocked. Allow it for this site in Chrome, then tap 🎙'
      : 'Voice could not start. Tap 🎙 to try again.');
  }
}

function voiceStop() {
  if (voice.mode !== 'idle') stopListening(false, true);
  voice.node?.disconnect(); voice.src?.disconnect();
  voice.stream?.getTracks().forEach((t) => t.stop());
  voice.node = voice.src = voice.stream = null;
  voice.ring = [];
  setVoiceState('off');
}

async function voiceRestart() { voiceStop(); if (cfg.voice.enabled) await voiceStart(); }

function setVoiceState(state, msg) {
  voice.state = state;
  const b = $('#btnMic');
  b.className = 'iconbtn mic-' + state;
  b.setAttribute('aria-label', state === 'off' ? 'Turn voice on' : 'Turn voice off');
  $('#voiceHint').textContent = msg ?? (state === 'ready' || state === 'listening' ? 'Say “Kishori”' : state === 'off' ? 'Voice off' : '');
}

// A quiet on-screen nudge, e.g. after a plain "Kishori" over music didn't lead anywhere.
let hintTimer;
function flashHint(text) {
  if (voice.state !== 'ready') return;
  $('#voiceHint').textContent = text;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => voice.state === 'ready' && setVoiceState('ready'), 6000);
}

/* ---------- audio in ---------- */

function onAudio(ch) {
  if (voice.state !== 'ready' && voice.state !== 'listening') return;
  const buf = new Float32Array(ch);
  // Keep the last 2.5 s so a command said in the same breath as the wake word isn't lost.
  voice.ring.push(buf);
  let total = 0;
  for (const b of voice.ring) total += b.length;
  while (total > voice.sampleRate * 2.5) total -= voice.ring.shift().length;

  if (voice.mode === 'idle') {
    voice.wakeRec.acceptWaveformFloat(buf, voice.sampleRate);
    checkWake();
  } else {
    voice.cmdRec.acceptWaveformFloat(buf, voice.sampleRate);
    if (voice.mode === 'listening') {
      let sum = 0;
      for (let i = 0; i < buf.length; i += 4) sum += buf[i] * buf[i];
      $('#listenLevel').style.width = `${Math.min(100, Math.sqrt(sum / (buf.length / 4)) * 400)}%`;
    }
    checkListening();
  }
}

/* ---------- the wake word ---------- */

// Partial results carry no confidence, so when one looks like the wake word we ask wakeRec for its
// final result (which does) and decide in onWakeResult. A plain "Kishori" waits a moment for a "Maa".
function onWakePartial(p) {
  if (voice.mode !== 'idle' || voice.wakeAskedAt) return;
  if (WAKE_STRONG.some((w) => p.includes(w))) { voice.wakeSeenAt = 0; askWake(); return; }
  if (!voice.wakeSeenAt && WAKE_PLAIN.some((w) => p.includes(w))) voice.wakeSeenAt = performance.now();
  // With music there may be no pause to end on, so keep the running text short; don't cut between "ki" and "shorty".
  if (!voice.wakeSeenAt && p.split(' ').length > 12 && !/\b(ki|kish|key)$/.test(p)) voice.wakeRec.retrieveFinalResult();
}

function checkWake() {
  if (voice.wakeSeenAt && performance.now() - voice.wakeSeenAt > 700) { voice.wakeSeenAt = 0; askWake(); }
  if (voice.wakeAskedAt && performance.now() - voice.wakeAskedAt > 2000) voice.wakeAskedAt = 0;
}

function askWake() {
  voice.wakeAskedAt = performance.now();
  voice.wakeRec.retrieveFinalResult();
}

function findWake(res) {
  const ws = res.result || [], toks = ws.map((w) => w.word);
  for (const [kind, phrases] of [['strong', WAKE_STRONG], ['plain', WAKE_PLAIN]]) {
    for (const p of phrases) {
      const pt = p.split(' ');
      for (let i = 0; i + pt.length <= toks.length; i++) {
        if (pt.every((t, j) => toks[i + j] === t)) {
          const avg = ws.slice(i, i + pt.length).reduce((a, w) => a + w.conf, 0) / pt.length;
          if (avg >= WAKE_MIN_CONF) return kind;
        }
      }
    }
  }
  return null;
}

function onWakeResult(res) {
  voice.wakeAskedAt = 0;
  voice.wakeSeenAt = 0;
  if (voice.mode !== 'idle' || performance.now() < voice.cooldownUntil) return;
  // While a timer is ringing, a plain "stop" is enough.
  if (alarmTimer && (res.result || []).some((w) => ['stop', 'okay', 'ok', 'enough'].includes(w.word) && w.conf >= 0.7)) { dismissAlarm(); return; }
  const kind = findWake(res);
  if (!kind) return;
  if (kind === 'plain' && isPlaying) startChecking();
  else startListening();
}

/* ---------- after the wake word ---------- */

function openCommandWindow(mode, ms) {
  voice.mode = mode;
  voice.lastPartial = '';
  voice.forced = false;
  voice.listenStart = voice.partialAt = performance.now();
  voice.listenUntil = voice.listenStart + ms;
  for (const b of voice.ring) voice.cmdRec.acceptWaveformFloat(b, voice.sampleRate);
}

function startListening() {
  openCommandWindow('listening', 7000);
  setVoiceState('listening');
  $('#listenHeard').innerHTML = '&nbsp;';
  $('#listen').hidden = false;
  chime(true);
  if (!alarmTimer) fadeTo(0.2, 300);
}

// A plain "Kishori" over music could be the song, so look for a command without chiming or lowering the music.
function startChecking() {
  openCommandWindow('checking', 3500);
}

function stopListening(understood, quiet) {
  const was = voice.mode;
  voice.mode = 'idle';
  voice.cmdRec?.retrieveFinalResult();
  // Short, so "Kishori… Kishori Maa" straight after a silent check still works.
  voice.cooldownUntil = performance.now() + 300;
  if (was === 'checking') {
    if (!understood && !quiet) flashHint('Over music, say “Kishori Maa”');
    return;
  }
  $('#listen').hidden = true;
  if (voice.state === 'listening') setVoiceState('ready');
  if (!understood && !quiet) chime(false);
  if (!alarmTimer) fadeTo(1, 800);
}

// What was said after the wake word, if it ends in a command with at most one stray word before it
// ("uh play melody"). Anything chattier is treated as talk, not a command.
function matchCommand(text) {
  const words = text.replace(/\[unk\]/g, ' ').trim().split(/\s+/).filter(Boolean);
  let k = -1;
  words.forEach((w, i) => { if (WAKE_ENDS.has(w)) k = words[i + 1] === 'ma' ? i + 1 : i; });
  const rest = words.slice(k + 1);
  for (let i = 0; i < rest.length && i <= 1; i++) {
    const p = rest.slice(i).join(' ');
    if (voice.commands.has(p)) return p;
  }
  return null;
}

function onCmdPartial(p) {
  if (voice.mode === 'idle' || p === voice.lastPartial) return;
  voice.lastPartial = p;
  voice.partialAt = performance.now();
  voice.forced = false;
  voice.listenUntil = Math.max(voice.listenUntil, voice.partialAt + (voice.mode === 'listening' ? 3000 : 1800));
  if (voice.mode !== 'listening') return;
  const shown = p.replace(/\[unk\]/g, '').replace(/^.*\b(ori|shorty|sorry)( ma)?\b/, '').trim();
  $('#listenHeard').textContent = shown || ' ';
}

function onCmdResult(res) {
  if (voice.mode === 'idle') return;
  voice.lastPartial = '';
  const cmd = matchCommand(res.text || '');
  if (!cmd) return;
  // Short words like "play" often score lower, so judge the phrase on average with a floor per word.
  const confs = (res.result || []).slice(-cmd.split(' ').length).map((w) => w.conf);
  const avg = confs.reduce((a, b) => a + b, 0) / confs.length;
  if (avg >= 0.75 && Math.min(...confs) >= 0.5) runCommand(cmd);
}

// Music means there may never be a pause for the recogniser to finish on, so when the partial text has
// been a whole command for a moment, ask for the final result (which carries confidence) and decide there.
// Wait longer for commands that could still grow ("play" → "play krishna").
function checkListening() {
  if (voice.mode === 'idle') return;
  const now = performance.now();
  const cmd = !voice.forced && matchCommand(voice.lastPartial);
  if (cmd && now - voice.partialAt > (voice.prefixes.has(cmd) ? 1500 : 800)) {
    voice.forced = true;
    voice.cmdRec.retrieveFinalResult();
    return;
  }
  if (now > voice.listenUntil || now - voice.listenStart > (voice.mode === 'listening' ? 15000 : 6000)) stopListening(false);
}

function runCommand(cmd) {
  const fn = voice.commands.get(cmd);
  stopListening(true);
  chime(true, true);
  try { fn(); } catch (e) { console.error(e); }
}

function chime(up, short) {
  ensureAudio();
  if (!actx) return;
  const n = actx.currentTime;
  if (!up) { beep(n, 392, 0.25); return; }
  beep(n, short ? 880 : 660, 0.25);
  if (!short) beep(n + 0.12, 990, 0.25);
}

function renderVoiceHints() {
  const moodWords = cfg.moods.filter((m) => m.list && sayWords(m).length).slice(0, 3).map((m) => `“play ${sayWords(m)[0]}”`);
  $('#listenHint').textContent = ['', ...moodWords, '“next song”', '“louder”', '“timer 5 minutes”', '“stop”'].filter(Boolean).join(' · ');
}

/* ---------- wiring ---------- */

$('#btnMic').onclick = () => {
  cfg.voice.enabled = !(voice.state === 'ready' || voice.state === 'listening' || voice.state === 'loading');
  saveCfg();
  cfg.voice.enabled ? voiceStart() : voiceStop();
};
$('#listen').onclick = () => stopListening(false, true);

// For testing on a computer: plays a recording through the same path as the microphone.
window.voiceTestFile = async (url) => {
  if (!voice.model) await voiceStart({ noMic: true });
  const buf = await actx.decodeAudioData(await (await fetch(url)).arrayBuffer());
  const ch = buf.getChannelData(0), step = 4096, pause = new Float32Array(step);
  const chunks = [];
  for (let i = 0; i < ch.length; i += step) chunks.push(ch.subarray(i, i + step));
  for (let i = 0; i < 24; i++) chunks.push(pause);
  const wait = () => new Promise((r) => setTimeout(r, (step / buf.sampleRate) * 1000));
  for (const c of chunks) { onAudio(c); await wait(); }
  // Like a quiet room: keep sending silence until any listening window has closed.
  for (let i = 0; voice.mode !== 'idle' && i < 250; i++) { onAudio(pause); await wait(); }
};

setVoiceState('off');
renderVoiceHints();
