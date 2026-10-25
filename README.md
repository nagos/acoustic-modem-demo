# Acoustic Modem

A browser communications laboratory that sends real ASCII data through laptop speakers and receives it through a microphone. TypeScript, Web Audio AudioWorklets, Canvas 2D, Vite, and Vitest; no backend, framework, or communication link between laptops.

## Run

Use Node.js 22.12+ (or Node 24) and npm.

```sh
npm install
npm run dev
```

Open the printed localhost URL in desktop Chrome or Chromium. Switch between Transmitter and Receiver at the top. Multiplexing defaults to None on both roles. Audio and microphone capture only start after explicit user actions.

```sh
npm run build
npm run preview
npm test
npm run test:watch
```

`build` type-checks application code and generates `dist/`. Serve that directory using any static HTTPS host. There are no external fonts, CDNs, analytics, runtime service calls, or backend requirements. Downloading the page assets is ordinary hosting traffic; laptops exchange modem data only through sound.

### GitHub Pages deployment

The workflow in [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) installs dependencies with `npm ci`, runs the tests, builds the app, and deploys `dist/` through the official GitHub Pages actions.

1. Push this project to a GitHub repository.
2. In **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**.
3. Push a commit to the repository's default branch, or open **Actions → Deploy to GitHub Pages → Run workflow** and select that branch. If the initial run happened before Pages was enabled, rerun it after step 2.
4. Open the published URL shown by the `github-pages` deployment environment.

No personal access token or repository secret is needed. The workflow detects the default branch rather than assuming `main` or `master`. Runs on other branches or tags skip deployment. The build reads the Pages base path automatically, supporting both `https://OWNER.github.io/REPOSITORY/` and root/custom-domain sites without changing local Vite configuration. Worklets and workers use the same deployment prefix.

To check a repository-path build locally:

```sh
npm run build -- --base /acoustic-modem/
npm run preview
```

Open the preview URL with `/acoustic-modem/` appended. `npm run build` without `--base` restores a normal root-path build. Pages provides an HTTPS deployment; the user still grants microphone permission explicitly in Receiver.

### Two laptops and HTTPS

The simplest setup is to run this project separately on both laptops and open `http://localhost:5173` on each. The two apps do not connect to one another. Synchronize the laptops' operating-system clocks using their normal time settings **before** arming. The app never synchronizes clocks over a network.

For one shared static deployment, run `npm run build` and put `dist/` on a trusted HTTPS static host. Open the same URL on both machines. A LAN URL such as `http://192.168.1.10:5173` is **not** a secure context and cannot reliably use microphone capture. Localhost refers to each laptop itself.

For a local HTTPS deployment, use an HTTPS reverse proxy with a certificate trusted on both laptops. For example, configure Caddy with a hostname you control, `root * /absolute/path/to/dist`, and `file_server`; Caddy can obtain a public certificate when the hostname and network configuration permit it. For LAN-only development, use a local certificate authority and install its root certificate on both laptops, then configure your static server with the generated certificate and key. Do not disable browser security to enable microphone capture.

## Demonstrations

Keep the tabs visible and computers awake. Use built-in speakers/microphones or wired audio; avoid Bluetooth. Begin at modest output volume, with laptops roughly 0.5–1 m apart in a quiet room. Increase level only if needed.

### Tone

1. Laptop A: select Transmitter → Tone generator.
2. Laptop B: select Receiver → Spectrogram → Start. Grant the browser's permission prompt; select the intended input from the microphone list.
3. Start a 1200 Hz tone on A. B should show a horizontal line near 1.2 kHz.
4. Change to 1600 Hz, observe the line move, then stop the tone.

Frequency and volume controls are smoothed to avoid clicks. Tone generation is independent of minute framing. Switching transmitter mode stops the previous source.

### Morse key (manual telegraph)

In Transmitter → Tone generator, click **Morse key · OFF** to enable the key. The continuous tone stops and the generator waits silently. Hold **Space** to transmit the selected sine-wave frequency; release it for silence. Short presses form dots, longer holds form dashes; spacing is manual. Frequency and output volume use the existing controls.

Click outside numeric/text inputs before keying. Space does not transmit while editing an input, and keyboard auto-repeat does not retrigger the tone. Key-down indication shows when audio is on. Releasing Space, losing window focus, hiding the tab, or focusing another control releases the key. Switching roles or transmitter modes disables Morse key and stops its oscillator. Click the toggle again to return to the normal continuous-tone generator. There is no automatic Morse encoder or decoder.

### One message — Multiplexing: None

Select **None** in the Multiplexing selector on both laptops. On the receiver, select the **FSK Decoder** tab first. The transmitter shows one message input, with a maximum of ten printable ASCII characters. The receiver shows one decoded message panel.

Arm both devices. Arm Receiver activates the microphone if needed, then schedules the next minute after audio preparation and any permission prompt. One physical BFSK stream carries the message at 1200 Hz for zero and 1600 Hz for one. All ten byte slots belong to the message; there is no alternation and no Channel B signal. Short messages are padded with spaces. Timing remains 700 ms per bit, 56 seconds of payload, and four seconds of silence. Both devices finish once; the receiver freezes for inspection.

### FDM

1. A: Digital modem → FDM; enter `HELLOWORLD` in A and `DOGS__CATS` in B.
2. B: Select the FSK Decoder tab and select FDM. Arm Receiver will activate the microphone automatically. Start with offset 0 ms, floor −50 dBFS, separation 6 dB.
3. Arm both comfortably before the next minute boundary.
4. Observe simultaneous bands at 1200/1600 Hz and 2800/3200 Hz. Bits fill one at a time; a character appears on both channels every 5.6 seconds.
5. From second 56 to 60 the transmitter is silent. Both devices finish once. Inspect the frozen waterfall to check bit decisions, frequency, and confidence.

### TDM

1. Select TDM on both devices. Enter `HELLO` and `WORLD` on the transmitter. TDM permits five characters per logical channel; switching modes does not silently truncate existing input.
2. Arm both for the same next minute.
3. Observe one physical band at 1200/1600 Hz. Whole byte slots alternate A, B, A, B, producing the two messages.
4. Check the four-second silent tail, automatic completion, and frozen inspection.

The receiver does not discover frames or mode automatically. The computers must agree on mode and clock timing. A mode mismatch or missed boundary will produce incorrect or unknown data.

### Continuous spectrogram without a decoder

Select the **Spectrogram** tab at the top of Receiver. No Arm action or minute-long capture is needed:

- **Start** activates the microphone immediately and runs the spectrogram continuously.
- The cursor follows local seconds within a minute. At 60 seconds it wraps to zero, replacing only the columns it passes. The rest of the previous sweep stays visible.
- **Freeze** holds the image and cursor while keeping the microphone open. **Start** resumes overwriting from the current time without clearing the retained image.
- **Stop** holds the image and releases the microphone. Start can reopen it and resume.
- Hovering shows the actual recording time for that column. Framing grids and silence shading appear only for armed decoder captures.
- A sample-rate change clears incompatible spectral bins. Dropped measurements leave gaps in the area the cursor has passed.

Select **FSK Decoder** at the top to access one-shot Arm/Disarm controls and bit/byte panels. Both tabs share one microphone stream and one spectrogram. Switching tabs never opens or stops the microphone, clears the chart, changes its data source, or resets a frozen image. An armed or receiving FSK capture continues even when the Spectrogram tab is selected.

Only explicit actions change the chart source: Arm prepares a new decoder frame; Start in Spectrogram resumes the live sweep. Captured results remain available, and **View captured frame** in FSK Decoder restores their chart for inspection without restarting the microphone.

### Controls and inspection

- Arm Receiver activates the selected microphone if necessary and schedules the next minute only after permission and audio initialization finish. An existing microphone stream is reused. On first use, arm the receiver and grant permission before arming the transmitter for the same scheduled minute. If permission is denied, no frame is armed and saved results stay intact.
- Disarm cancels a scheduled TX or RX frame before it starts. The RX microphone stays open until explicitly stopped.
- Stop aborts TX audio. Stop & freeze retains the partial RX capture and marks it incomplete.
- Arm Again creates another one-shot frame and clears the previous RX result explicitly.
- Frozen results stay visible across minute boundaries, including while the microphone remains open.
- Stop microphone releases all microphone tracks and processing nodes. During capture it also freezes a partial result.
- Role changes stop output and release the microphone; any active RX capture becomes incomplete.
- Leaving the page also stops audio and aborts an unfinished frame. Returning with browser Back/Forward preserves saved results and restores controls, keyboard handlers, and resizing; start audio again explicitly.
- If a microphone replacement fails, the current working microphone remains active and the selector returns to it.
- Hover or click the waterfall to inspect slots; focus it and use left/right arrows to move one bit. For decoder captures, the silence region has no payload bits.
- `0` and `1` are decisions, `?` is unknown, `·` is pending, `␠` is an actual preserved ASCII space. Byte errors display `�`; unexpected nonprintable bytes display hexadecimal notation rather than invented printable characters.
- JSON export includes frame settings, timing, measured spectra, all bit decisions, confidence, byte values, decoded text, and errors. Raw microphone audio is not retained or exported.

## Protocol and implementation

| Property | Value |
| --- | --- |
| Frame | 60 seconds, aligned to the next wall-clock minute |
| Payload / silent tail | 56 / 4 seconds |
| Bit / byte | 700 ms / 5.6 s |
| Bit order / encoding | MSB first / printable ASCII 0x20–0x7E |
| Padding | ASCII space, included in fixed-length physical payload |
| None | One message, 1200/1600 Hz; ten bytes; no Channel B |
| FDM | A: 1200/1600 Hz; B: 2800/3200 Hz; ten bytes each |
| TDM | Shared 1200/1600 Hz; alternating A/B byte slots; five bytes each |

There is deliberately no preamble, CRC, error correction, retransmission, channel identifier, packet discovery, or automatic clock synchronization.

`src/protocol` defines pure framing and encoding; `src/dsp` contains the shared continuous-phase modulator, streaming Goertzel decoder, FFT, spectral worker, and PCM loopback. `src/audio` owns worklets and device lifecycle. `src/state` contains pure one-shot state machines, and `src/ui` renders measured spectra and bit/byte panels. `src/main.ts` connects these to the DOM.

Both channels use independent oscillators summed with amplitude normalization. Five-millisecond ramps occur only at the beginning/end of the active payload, with continuous phase and no inserted bit gaps. Maximum output amplitude is bounded by the selected output gain.

### Timing and browser limits

The main thread maps a wall-clock timestamp to audio sample positions when arming. TX uses `AudioContext.getOutputTimestamp()` when valid, with a base-latency estimate fallback. RX uses the AudioContext processing timeline. Worklets determine boundaries from absolute sample indices and the actual device sample rate; neither JavaScript timers nor Canvas updates schedule bits. Absolute boundaries are rounded separately, avoiding cumulative drift at fractional sample durations. Processing blocks may cross bit and frame boundaries.

The decoder analyzes the central 60% of each expected bit using Hann-weighted Goertzel filters. A winning tone must exceed both the configured signal floor and candidate separation. Confidence measures normalized energy separation; it is not a probability of correct reception. Decisions appear after the analysis window; bytes appear after eight decisions and the physical byte boundary. Positive RX offsets can delay the final decision past that boundary.

**Positive timing offset means analyze later microphone samples.** It compensates signal arriving later than expected. Range: −500 to +500 ms. A rolling half-second PCM buffer supports negative analysis offsets even when arming shortly before the boundary. A late arm with insufficient retained samples produces unknown bits. Change offset between captures; settings are frozen while armed/receiving.

Browser processing timestamps are not hardware ADC timestamps. Microphone buffering, driver processing, speaker output latency, acoustic travel time, clock skew, and operating-system scheduling limit cross-laptop synchronization. Published track latency is diagnostic and may be missing or approximate; it is not silently applied as a precise correction. Common 44100/48000 Hz devices are supported without assuming the laptops share a sample rate. Keep system clocks stable. A significant detected clock jump or audio-context interruption aborts the current frame; resume audio and arm again. An arm too close to the output scheduling deadline is rejected explicitly.

The spectral worker computes 4096-sample Hann-windowed FFTs at approximately 30 columns per second, using sample timestamps rather than message-arrival times. Spectrogram colors span −60 to −18 dBFS, saturating outside those bounds. This display contrast does not change the stored −100…0 dBFS spectral-bin encoding or decoder signal thresholds. Spectra reflect windows around their labeled time, so tone transitions have finite visual width. Canvas rendering and resizing do not feed or clock the decoder. Frozen captures stop accumulating data. Only a short rolling PCM buffer and batched audio blocks are retained, not a minute-long recording.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Microphone unavailable | Use HTTPS/localhost, allow browser and OS microphone permissions, check selected input, and close applications holding the device exclusively. |
| No visible spectrum | Activate microphone, speak or clap, check the input meter and OS input mute. Silence is dark. Check that the intended device is selected. |
| No detected FSK | Enable decoder, match FDM/TDM, arm before the same minute, and verify tone lines at the expected frequencies. Increase speaker level gradually or lower the detection floor if the signal is weak. |
| Incorrect bit timing | Synchronize clocks before arming. Inspect tone transitions against the grid. Positive offset analyzes later audio; increase it for delayed arrivals. Retry with a short known message and tune between captures. |
| Output too quiet | Check app and OS output volume, selected speaker device, and speaker distance. Try the tone generator first. |
| Clipping / many wrong bits | Lower output level or increase distance. Input meter warns near full scale. Speaker distortion can occur even before microphone PCM clips. |
| Noise suppression / automatic gain | Expand Capture diagnostics. Reported true means the requested setting was not disabled. Turn off OS microphone enhancements or use another input. Unreported means unknown, not verified off. |
| Echo cancellation | Disable OS/driver communication or voice-processing effects. The app requests echo cancellation off and never plays microphone audio through speakers. |
| Excessive speaker-to-mic latency | Avoid Bluetooth and virtual audio devices. Use built-in/wired devices, tune RX offset, and keep both tabs visible. If the required correction exceeds ±500 ms, change hardware rather than relying on this protocol. |
| Different device sample rates | Normally supported automatically. The app displays actual AudioContext rate. Do not manually force matching rates; instead check clock synchronization, audio processing, and offset. |
| AudioContext suspended | Press Resume audio, keep the browser foregrounded and computer awake, then arm again. An interrupted frame is not resumed mid-frame. |
| Frozen waterfall appears stuck | Without a decoder, Start resumes the continuous sweep after Freeze or Stop. For a decoded frame, Arm Again explicitly replaces the previous capture; monitoring never overwrites its results. |
| Device disconnected | Partial capture is retained as aborted. Choose a working input and activate the microphone again. |

## Verification

Vitest tests cover ASCII, padding, MSB conversion, exact protocol durations, boundaries, FDM independence, TDM byte allocation, waveform frequencies, clipping limits, phase continuity, FFT peaks, full-frame clean/noisy PCM loopback at 44100/48000 Hz, unknown/ambiguous/missing samples, timing offsets, block-boundary behavior, and TX/RX one-shot transitions. Regression tests also cover pending bytes at slot boundaries, inactive TDM channel retention, audio reinitialization after disposal, failed microphone replacement, and cancellation of late initialization or microphone-permission results.

A reproducible Chrome integration check also exercises the **actual production worklet classes** in `OfflineAudioContext`, including frame boundaries inside processing blocks and late arming with negative-offset history replay. With the development server open, run this in the browser console:

```js
await (await import('/src/tests/browser-worklets.ts')).verifyBrowserWorklets()
```

It checks None, FDM, and TDM at both 44100 and 48000 Hz, verifies both decoded messages and automatic completion, and throws on mismatch. This uses generated PCM without physical playback or microphone capture.

The expandable in-app reference panel offers None, FDM, and TDM **internal PCM loopback**. It executes production modulation and demodulation in a worker with seeded noise. It does not access speakers or microphones and cannot establish that a real acoustic link works.

Physical acceptance requires two laptops: perform the tone, FDM, and TDM demonstrations above, confirm both decoded messages, four seconds of silence, automatic completion, frozen inspection, cancellation, abort, Arm Again, resource release, and no automatic repeats. Real two-laptop acoustic transmission has not been verified merely by passing loopback tests.

Observed automated and real acoustic results are recorded in [VALIDATION.md](VALIDATION.md). The recorded physical tests used two tabs on one laptop; separate-laptop acceptance remains outstanding.
