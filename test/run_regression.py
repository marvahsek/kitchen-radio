#!/usr/bin/env python3
"""
Kitchen Radio: Voice Regression Test Suite
Generates test WAV files with macOS `say` and tests wake & command recognition against
the exact Vosk model (`models/vosk-model-small-en-in-0.4`).
"""

import os
import sys
import wave
import json
import subprocess

TEST_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '_test')
MODEL_DIR = '/tmp/model/vosk-model-small-en-in-0.4'

os.makedirs(TEST_DIR, exist_ok=True)

# Test definitions
# (filename, voice, speech_text, expected_wake, expected_cmd, test_description, music_on, alarm_on)
TEST_CASES = [
    # Positive commands (music off)
    ("c01_rishi_play_music.wav", "Rishi", "Kishori. [[slnc 700]] Play music.", "plain", "play music", "Positive command: play music (Rishi)", False, False),
    ("c02_tara_next_song.wav", "Tara", "Kishori. [[slnc 700]] Next song.", "plain", "next song", "Positive command: next song (Tara)", False, False),
    ("c03_aman_pause.wav", "Aman", "Kishori. [[slnc 700]] Pause.", "plain", "pause", "Positive command: pause (Aman)", False, False),
    ("c04_samantha_volume_up.wav", "Samantha", "Kishori. [[slnc 700]] Volume up.", "plain", "volume up", "Positive command: volume up (Samantha)", False, False),
    ("c05_rishi_timer_5min.wav", "Rishi", "Kishori. [[slnc 700]] Timer for five minutes.", "plain", "timer for five minutes", "Positive command: timer for five minutes (Rishi)", False, False),
    ("c06_tara_sleep_timer_15min.wav", "Tara", "Kishori. [[slnc 700]] Stop music in fifteen minutes.", "plain", "stop music in fifteen minutes", "Positive command: sleep timer 15 min (Tara)", False, False),
    ("c07_aman_what_time.wav", "Aman", "Kishori. [[slnc 700]] What time is it.", "plain", "what time is it", "Positive command: what time is it (Aman)", False, False),
    ("c08_rishi_cancel_timer.wav", "Rishi", "Kishori. [[slnc 700]] Cancel timer.", "plain", "cancel timer", "Positive command: cancel timer (Rishi)", False, False),
    ("c09_tara_play_melody.wav", "Tara", "Kishori. [[slnc 700]] Play melody.", "plain", ["play melody", "melody"], "Positive command: play melody (Tara)", False, False),
    ("c10_rishi_shuffle.wav", "Rishi", "Kishori. [[slnc 700]] Shuffle.", "plain", "shuffle", "Positive command: shuffle (Rishi)", False, False),

    # Strong wake ("Kishori Maa") over music
    ("m01_tara_kishori_maa_next.wav", "Tara", "Kishori Maa. [[slnc 700]] Next song.", "strong", "next song", "Kishori Maa over music: next song (Tara)", True, False),
    ("m02_rishi_kishori_maa_pause.wav", "Rishi", "Kishori Maa. [[slnc 700]] Pause.", "strong", "pause", "Kishori Maa over music: pause (Rishi)", True, False),
    ("m03_aman_kishori_maa_louder.wav", "Aman", "Kishori Maa. [[slnc 700]] Louder.", "strong", "louder", "Kishori Maa over music: louder (Aman)", True, False),

    # Plain "Kishori" alone over music (silent check -> closes silently with NO command)
    ("k01_aman_plain_kishori_alone.wav", "Aman", "Kishori.", "plain", None, "Plain Kishori alone over music (silent check, no action)", True, False),

    # Chatter after wake word (must do nothing)
    ("x01_rishi_chatter_after_wake.wav", "Rishi", "Kishori. [[slnc 700]] I think we should cook some rice and vegetables tomorrow.", "plain", None, "Chatter after wake word does nothing (Rishi)", False, False),

    # Bhajan lines singing "Kishori" (silent check only, NO command)
    ("b01_lekha_bhajan_kishori.wav", "Lekha", "radhe radhe radhe barsane wali radhe kishori radhe krishna radhe radhe", "plain_or_none", None, "Bhajan line singing Kishori (Lekha)", True, False),
    ("b02_lekha_bhajan_radha.wav", "Lekha", "jai radha madhav jai kunj bihari radhe radhe govind radhe", None, None, "Bhajan line with no wake word (Lekha)", False, False),

    # Hindi chatter / lyrics (no wake word, no action)
    ("h01_lekha_hindi_talk.wav", "Lekha", "aaj kitchen mein dal roti chawal aur sabji banegi khana garam rakhna", None, None, "Hindi kitchen chatter (Lekha)", False, False),
    ("h02_lekha_arijit_lyrics.wav", "Lekha", "kyunki tum hi ho ab tum hi ho zindagi ab tum hi ho chain bhi mera dard bhi", None, None, "Arijit Singh lyrics (Lekha)", False, False),

    # Tamil chatter (no wake word, no action)
    ("t01_vani_tamil_talk.wav", "Vani", "innikku samayal la sambar rasam poriyal pannalam nalla irukkum", None, None, "Tamil kitchen chatter 1 (Vani)", False, False),
    ("t02_vani_tamil_talk2.wav", "Vani", "kadai le poi paal thair vaangi varanam marakkama vanga", None, None, "Tamil kitchen chatter 2 (Vani)", False, False),

    # English chatter (no wake word, no action)
    ("e01_samantha_kitchen_chatter.wav", "Samantha", "I think the tomatoes are finished please buy some onions and milk from the store", None, None, "English kitchen chatter (Samantha)", False, False),
    ("e02_tara_kitchen_chatter.wav", "Tara", "The water is boiling in the kettle can you make some tea for everyone", None, None, "English kitchen chatter 2 (Tara)", False, False),

    # Alarm dismissal by plain "stop" with no wake word
    ("a01_tara_stop_alarm.wav", "Tara", "stop", None, "alarm_dismissed", "Alarm dismissal by plain 'stop' (Tara)", False, True),
]

def generate_wavs():
    print("=== Generating test WAV files with macOS `say` ===")
    for fname, voice, text, _, _, desc, _, _ in TEST_CASES:
        path = os.path.join(TEST_DIR, fname)
        # Always regenerate to ensure punctuated audio is up to date
        cmd = ["/usr/bin/say", "-v", voice, "-o", path, "--data-format=LEI16@16000", text]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            print(f"Error generating {fname}: {res.stderr}")
    print("All test WAV files generated in _test/\n")

def run_tests():
    try:
        import vosk
    except ImportError:
        print("vosk module not found in this python environment.")
        return False

    vosk.SetLogLevel(-1) # Quiet logs
    print(f"Loading Vosk model from {MODEL_DIR}...")
    model = vosk.Model(MODEL_DIR)

    # Grammars exactly matching voice.js
    WAKE_PLAIN = ['kish ori', 'ki shorty', 'ki sorry', 'key shorty']
    WAKE_STRONG = [p + ' ma' for p in WAKE_PLAIN]
    WAKE_ENDS = set(['ori', 'shorty', 'sorry'])
    WAKE_GARBAGE = ('the be to of and a in that have i it for not on with he as you do at this but his by from they we say her she or an ' +
      'will my one all would there their what so up out if about who get which go me when make can like time no just him know take people ' +
      'into year your good some could them see other than then now look only come its over think also back after use two how our work first ' +
      'well way even new want because any these give day most us is are was were been has had did said says going went got made very much ' +
      'more many lot yes okay ok oh ah hmm hey hi hello please thank thanks sorry sure right here where why tell call phone mother father ' +
      'baby kids child food rice milk tea water salt sugar dal curry roti cooker gas fire hot cold eat wait stop enough start done ready let ' +
      'put keep bring open close door fridge kitchen house home today tomorrow morning evening night week money car keys clean wash cut boil ' +
      'cook fry song songs music love heart life dream sky rain moon sun god ram krishna radha hari jai ma pa na ka ra ha ho hum main yeh ' +
      'wo vo ne se ki ko par tho anna po').split()

    wake_grammar = list(set(WAKE_GARBAGE + WAKE_PLAIN + WAKE_STRONG)) + ['[unk]']

    NUM_WORDS = {
      'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12,
      'thirteen': 13, 'fourteen': 14, 'fifteen': 15, 'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19, 'twenty': 20,
      'twenty five': 25, 'thirty': 30, 'thirty five': 35, 'forty': 40, 'forty five': 45, 'fifty': 50, 'sixty': 60, 'ninety': 90,
    }
    TIMER_FORMS = ['timer {n} minutes', 'timer {n} minute', 'timer for {n} minutes', 'set timer {n} minutes', 'set timer for {n} minutes',
      'set a timer for {n} minutes', '{n} minute timer', '{n} minutes timer', 'start {n} minute timer']

    SLEEP_FORMS = [
      'stop music in {n} minutes', 'stop music in {n} minute',
      'stop the music in {n} minutes', 'stop the music in {n} minute',
      'stop music after {n} minutes', 'stop music after {n} minute',
      'stop the music after {n} minutes', 'stop the music after {n} minute',
      'stop playing in {n} minutes', 'stop playing in {n} minute',
      'stop playing after {n} minutes', 'stop playing after {n} minute',
      'turn off music in {n} minutes', 'turn off the music in {n} minutes',
      'sleep timer {n} minutes', 'sleep timer for {n} minutes',
      'set sleep timer {n} minutes', 'set sleep timer for {n} minutes'
    ]

    commands_list = [
      'play', 'play music', 'just play', 'start music', 'play songs', 'play some music', 'play something',
      'stop', 'stop music', 'stop the music', 'stop it', 'stop playing',
      'pause', 'pause music', 'pause the music',
      'resume', 'continue', 'resume music', 'play again',
      'next', 'next song', 'skip', 'skip song', 'skip this', 'change song', 'change the song', 'another song',
      'previous', 'previous song', 'go back', 'last song',
      'shuffle', 'shuffle songs',
      'louder', 'volume up', 'increase volume', 'increase the volume', 'more volume', 'turn it up',
      'softer', 'quieter', 'volume down', 'decrease volume', 'decrease the volume', 'lower volume', 'lower the volume', 'less volume', 'turn it down',
      'timer for half an hour', 'half an hour timer', 'set timer for half an hour',
      'cancel timer', 'stop timer', 'cancel the timer', 'stop the timer', 'cancel timers', 'cancel all timers', 'stop alarm', 'stop the alarm',
      'stop music in half an hour', 'stop music after half an hour', 'stop the music in half an hour', 'stop the music after half an hour',
      'cancel sleep timer', 'cancel the sleep timer', 'stop sleep timer', 'stop the sleep timer', 'turn off sleep timer',
      'what time is it', 'what is the time', 'tell me the time',
      'what is playing', 'what song is this', 'which song is this', 'what is this song',
      'thank you', 'thanks', 'never mind', 'cancel', 'nothing',
    ]
    for w in NUM_WORDS:
        for f in TIMER_FORMS:
            commands_list.append(f.replace('{n}', w))
        for f in SLEEP_FORMS:
            commands_list.append(f.replace('{n}', w))

    mood_words = ['krishna', 'radha', 'bah jan', 'mara thi', 'mara thee', 'a bang', 'melody', 'bollywood', 'hindi', 'ari jay', 'vee jay', 'vi jay', 'tamil', 'favorites', 'favorite']
    for w in mood_words:
        for t in [w, f'play {w}', f'{w} songs', f'play {w} songs', f'{w} music', f'play {w} music']:
            commands_list.append(t)

    commands_set = set(commands_list)
    prefixes_set = set(k for k in commands_list if any(o.startswith(k + ' ') for o in commands_list))
    FILLERS = ('i you we he she it they the a an is are was to of and in on at for with this that what yes no not do did ' +
      'have has my your our now so but just very like oh uh um ah hmm come go get give take make put here there where when how why who can will would should').split()

    cmd_grammar = list(set(commands_list + WAKE_PLAIN + WAKE_STRONG + FILLERS)) + ['[unk]']

    def match_command(text):
        words = [w for w in text.replace('[unk]', ' ').strip().split() if w]
        k = -1
        for i, w in enumerate(words):
            if w in WAKE_ENDS:
                k = i + 1 if (i + 1 < len(words) and words[i + 1] == 'ma') else i
        rest = words[k + 1:]
        for i in range(min(2, len(rest) + 1)):
            p = ' '.join(rest[i:])
            if p in commands_set:
                return p
        return None

    def find_wake(res):
        ws = res.get('result', [])
        toks = [w['word'] for w in ws]
        for kind, phrases in [('strong', WAKE_STRONG), ('plain', WAKE_PLAIN)]:
            for p in phrases:
                pt = p.split()
                for i in range(len(toks) - len(pt) + 1):
                    if toks[i:i + len(pt)] == pt:
                        avg = sum(w['conf'] for w in ws[i:i + len(pt)]) / len(pt)
                        if avg >= 0.55:
                            return kind
        return None

    print("\n=== Running Regression Suite against Vosk ===")
    passed = 0
    failed = 0

    for fname, voice, text, exp_wake, exp_cmd, desc, is_playing, is_alarm in TEST_CASES:
        wav_path = os.path.join(TEST_DIR, fname)
        wf = wave.open(wav_path, "rb")
        sample_rate = wf.getframerate()

        wake_rec = vosk.KaldiRecognizer(model, sample_rate, json.dumps(wake_grammar))
        wake_rec.SetWords(True)

        cmd_rec = vosk.KaldiRecognizer(model, sample_rate, json.dumps(cmd_grammar))
        cmd_rec.SetWords(True)

        # Simulation state matching voice.js
        mode = 'idle' # idle, checking, listening
        detected_wake = None
        executed_cmd = None
        ring_buffer = []

        last_partial = ""
        partial_at_ms = 0
        forced = False
        current_time_ms = 0

        # Read in 4096-sample frames (0.256s per frame at 16kHz)
        frame_samples = 4096
        frame_ms = (frame_samples / sample_rate) * 1000
        silence_frame = b'\x00' * (frame_samples * 2)

        # Feed audio followed by silence (as a quiet room does in voice.js)
        all_frames = []
        while True:
            data = wf.readframes(frame_samples)
            if len(data) == 0:
                break
            all_frames.append(data)
        # Trailing silence like voice.js
        for _ in range(8):
            all_frames.append(silence_frame)

        for data in all_frames:
            current_time_ms += frame_ms
            ring_buffer.append(data)
            if len(ring_buffer) > 10: # ~2.5s
                ring_buffer.pop(0)

            if mode == 'idle':
                if wake_rec.AcceptWaveform(data):
                    res = json.loads(wake_rec.Result())
                    # Check alarm stop
                    if is_alarm and any(w.get('word') in ['stop', 'okay', 'ok', 'enough'] and w.get('conf', 0) >= 0.7 for w in res.get('result', [])):
                        executed_cmd = 'alarm_dismissed'
                        break
                    wkind = find_wake(res)
                    if wkind:
                        detected_wake = wkind
                        mode = 'checking' if (wkind == 'plain' and is_playing) else 'listening'
                        for chunk in ring_buffer:
                            cmd_rec.AcceptWaveform(chunk)
                else:
                    part = json.loads(wake_rec.PartialResult()).get('partial', '')
                    if any(w in part for w in WAKE_STRONG + WAKE_PLAIN):
                        res = json.loads(wake_rec.FinalResult())
                        wkind = find_wake(res)
                        if wkind:
                            detected_wake = wkind
                            mode = 'checking' if (wkind == 'plain' and is_playing) else 'listening'
                            for chunk in ring_buffer:
                                cmd_rec.AcceptWaveform(chunk)
            else:
                # Inside command window
                if cmd_rec.AcceptWaveform(data):
                    res = json.loads(cmd_rec.Result())
                    cmd = match_command(res.get('text', ''))
                    if cmd:
                        ws = res.get('result', [])
                        cmd_len = len(cmd.split())
                        confs = [w['conf'] for w in ws[-cmd_len:]] if len(ws) >= cmd_len else [0.0]
                        avg_conf = sum(confs) / len(confs)
                        if avg_conf >= 0.75 and min(confs) >= 0.5:
                            executed_cmd = cmd
                            break
                else:
                    part = json.loads(cmd_rec.PartialResult()).get('partial', '')
                    if part != last_partial:
                        last_partial = part
                        partial_at_ms = current_time_ms
                        forced = False
                    
                    cmd = match_command(last_partial) if not forced else None
                    debounce_needed = 1500 if (cmd and cmd in prefixes_set) else 800
                    if cmd and (current_time_ms - partial_at_ms > debounce_needed):
                        forced = True
                        res = json.loads(cmd_rec.FinalResult())
                        cmd_final = match_command(res.get('text', ''))
                        if cmd_final:
                            ws = res.get('result', [])
                            cmd_len = len(cmd_final.split())
                            confs = [w['conf'] for w in ws[-cmd_len:]] if len(ws) >= cmd_len else [0.0]
                            avg_conf = sum(confs) / len(confs) if confs else 0
                            if avg_conf >= 0.75 and min(confs) >= 0.5:
                                executed_cmd = cmd_final
                                break

        # Flush final results if not yet decided
        if mode == 'idle' and not detected_wake and not executed_cmd:
            res = json.loads(wake_rec.FinalResult())
            if is_alarm and any(w.get('word') in ['stop', 'okay', 'ok', 'enough'] and w.get('conf', 0) >= 0.7 for w in res.get('result', [])):
                executed_cmd = 'alarm_dismissed'
            else:
                wkind = find_wake(res)
                if wkind:
                    detected_wake = wkind
        elif mode in ('listening', 'checking') and not executed_cmd:
            res = json.loads(cmd_rec.FinalResult())
            cmd = match_command(res.get('text', ''))
            if cmd:
                ws = res.get('result', [])
                cmd_len = len(cmd.split())
                confs = [w['conf'] for w in ws[-cmd_len:]] if len(ws) >= cmd_len else [0.0]
                avg_conf = sum(confs) / len(confs) if confs else 0
                if avg_conf >= 0.75 and min(confs) >= 0.5:
                    executed_cmd = cmd

        wf.close()

        # Check pass/fail
        wake_ok = True
        if exp_wake == 'plain_or_none':
            wake_ok = detected_wake in ('plain', None)
        else:
            wake_ok = (detected_wake == exp_wake)

        if isinstance(exp_cmd, list):
            cmd_ok = executed_cmd in exp_cmd
        else:
            cmd_ok = (executed_cmd == exp_cmd)

        test_passed = wake_ok and cmd_ok
        if test_passed:
            passed += 1
            print(f"  ✓ PASS: {desc}")
            print(f"          Wake: {detected_wake} (exp: {exp_wake}) | Cmd: '{executed_cmd}' (exp: '{exp_cmd}')")
        else:
            failed += 1
            print(f"  ✗ FAIL: {desc}")
            print(f"          Wake: {detected_wake} (exp: {exp_wake}) | Cmd: '{executed_cmd}' (exp: '{exp_cmd}')")

    print("\n" + "=" * 50)
    print(f"RESULTS: {passed} passed, {failed} failed out of {len(TEST_CASES)} tests")
    print("=" * 50)
    return failed == 0

if __name__ == '__main__':
    generate_wavs()
    success = run_tests()
    sys.exit(0 if success else 1)
