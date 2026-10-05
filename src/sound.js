// All sound is synthesised with Web Audio: no files to download or decode, so nothing can stall the game.
// One AudioContext, created on the first key press (browsers require a gesture). A moped engine that follows
// your speed, three ambience beds (street, market, water) and short one-shot effects, capped in number and
// faded by distance.

const MAX_VOICES = 16;
const HEAR_WITHIN = 60; // metres

export function createSound() {
    let ctx = null;
    let master;
    let noise; // 2s of white noise, shared by everything that hisses
    let engine;
    const beds = {};
    let voices = 0;
    let muted = false;
    const listener = { x: 0, z: 0 };

    function start() {
        if (ctx) return;
        ctx = new AudioContext();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 0.7;
        master.connect(ctx.destination);
        noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

        // Moped engine: a sawtooth and a detuned square through a lowpass, pitch and brightness follow speed
        const out = ctx.createGain();
        out.gain.value = 0;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 500;
        const saw = ctx.createOscillator();
        saw.type = 'sawtooth';
        const square = ctx.createOscillator();
        square.type = 'square';
        const squareGain = ctx.createGain();
        squareGain.gain.value = 0.35;
        saw.connect(filter);
        square.connect(squareGain).connect(filter);
        filter.connect(out).connect(master);
        saw.start();
        square.start();
        engine = { out, filter, saw, square };

        // Ambience: looping noise, filtered into street rumble, market babble and lapping water
        const bed = (type, frequency, q, wobble) => {
            const src = ctx.createBufferSource();
            src.buffer = noise;
            src.loop = true;
            const f = ctx.createBiquadFilter();
            f.type = type;
            f.frequency.value = frequency;
            f.Q.value = q;
            const g = ctx.createGain();
            g.gain.value = 0;
            const level = ctx.createGain();
            level.gain.value = 0;
            src.connect(f).connect(g).connect(level).connect(master);
            // Slow wobble on the volume so it breathes like a crowd or waves
            const lfo = ctx.createOscillator();
            lfo.frequency.value = wobble;
            const depth = ctx.createGain();
            depth.gain.value = 0.5;
            lfo.connect(depth).connect(g.gain);
            g.gain.value = 0.5;
            lfo.start();
            src.start();
            return level;
        };
        beds.street = bed('lowpass', 350, 0.5, 0.13);
        beds.market = bed('bandpass', 1100, 1.2, 3.1);
        beds.water = bed('lowpass', 260, 0.7, 0.22);
    }

    addEventListener('keydown', start);
    addEventListener('pointerdown', start);
    document.addEventListener('visibilitychange', () => {
        if (!ctx) return;
        if (document.hidden) ctx.suspend();
        else ctx.resume();
    });

    // Volume for something at (x, z): fades to nothing at HEAR_WITHIN
    const near = (x, z) => (x === undefined ? 1 : Math.max(0, 1 - Math.hypot(x - listener.x, z - listener.z) / HEAR_WITHIN));

    // Run a short sound; build(t, out) wires it up, starting at time t, and returns its length in seconds
    function voice(volume, build) {
        if (!ctx || volume <= 0.01 || voices >= MAX_VOICES) return;
        voices++;
        const out = ctx.createGain();
        out.gain.value = volume;
        out.connect(master);
        const length = build(ctx.currentTime, out);
        setTimeout(() => {
            out.disconnect();
            voices--;
        }, (length + 0.1) * 1000);
    }
    const tone = (t, out, type, f0, f1, length, level = 1) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + length);
        const g = ctx.createGain();
        g.gain.setValueAtTime(level, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + length);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + length);
    };
    const hiss = (t, out, type, frequency, length, level = 1, q = 0.8) => {
        const src = ctx.createBufferSource();
        src.buffer = noise;
        const f = ctx.createBiquadFilter();
        f.type = type;
        f.frequency.value = frequency;
        f.Q.value = q;
        const g = ctx.createGain();
        g.gain.setValueAtTime(level, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + length);
        src.connect(f).connect(g).connect(out);
        src.start(t, Math.random());
        src.stop(t + length);
    };
    const honk = (t, out, f, length) => {
        // Two slightly-out-of-tune squares through a lowpass: the nasal Lagos horn
        for (const detune of [1, 1.26]) {
            const o = ctx.createOscillator();
            o.type = 'square';
            o.frequency.value = f * detune;
            const lp = ctx.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.value = 1800;
            const g = ctx.createGain();
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(0.25, t + 0.02);
            g.gain.setValueAtTime(0.25, t + length - 0.04);
            g.gain.linearRampToValueAtTime(0, t + length);
            o.connect(lp).connect(g).connect(out);
            o.start(t);
            o.stop(t + length);
        }
    };

    const effects = {
        crash: (t, out) => (tone(t, out, 'sine', 90, 35, 0.35, 1), hiss(t, out, 'lowpass', 1400, 0.4, 0.8), 0.4),
        scrape: (t, out) => (hiss(t, out, 'highpass', 2500, 0.35, 0.5), 0.35),
        bump: (t, out) => (tone(t, out, 'sine', 110, 45, 0.18, 1), hiss(t, out, 'lowpass', 500, 0.1, 0.4), 0.2),
        thud: (t, out) => (tone(t, out, 'sine', 140, 60, 0.2, 1), 0.2),
        splash: (t, out) => (hiss(t, out, 'bandpass', 600, 1.4, 1, 0.6), hiss(t + 0.1, out, 'lowpass', 300, 1.2, 0.8), 1.4),
        smash: (t, out) => {
            tone(t, out, 'sine', 80, 40, 0.3, 0.8);
            for (let i = 0; i < 6; i++) hiss(t + i * 0.06 + Math.random() * 0.05, out, 'bandpass', 800 + Math.random() * 1500, 0.12, 0.7, 3); // wood and goods clattering
            return 0.6;
        },
        horn: (t, out) => {
            const f = 330 + Math.random() * 120;
            if (Math.random() < 0.5) return honk(t, out, f, 0.45), 0.45;
            honk(t, out, f, 0.18); // the double toot
            honk(t + 0.25, out, f, 0.3);
            return 0.6;
        },
        cash: (t, out) => (tone(t, out, 'sine', 1320, 1320, 0.25, 0.6), tone(t + 0.12, out, 'sine', 1760, 1760, 0.4, 0.6), hiss(t, out, 'highpass', 6000, 0.15, 0.3), 0.55),
        crowd: (t, out) => {
            for (let i = 0; i < 5; i++) hiss(t + i * 0.18, out, 'bandpass', 500 + Math.random() * 700, 0.25, 0.8, 4); // a rough shout
            return 1.1;
        },
        scream: (t, out) => {
            const o = ctx.createOscillator();
            o.type = 'sawtooth';
            o.frequency.setValueAtTime(520, t);
            o.frequency.exponentialRampToValueAtTime(180, t + 1.1);
            const vib = ctx.createOscillator();
            vib.frequency.value = 9;
            const vibDepth = ctx.createGain();
            vibDepth.gain.value = 25;
            vib.connect(vibDepth).connect(o.frequency);
            const bp = ctx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.value = 900;
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.5, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
            o.connect(bp).connect(g).connect(out);
            o.start(t);
            vib.start(t);
            o.stop(t + 1.2);
            vib.stop(t + 1.2);
            return 1.2;
        },
    };

    addEventListener('keydown', (e) => {
        if (e.key !== 'n' && e.key !== 'N') return;
        muted = !muted;
        if (master) master.gain.setTargetAtTime(muted ? 0 : 0.7, ctx.currentTime, 0.05);
    });

    return {
        get muted() {
            return muted;
        },
        // Where the player is, for distance fades
        listen(x, z) {
            listener.x = x;
            listener.z = z;
        },
        // One-shot effect; x, z optional (omit for sounds on the bike itself)
        play(name, volume = 1, x, z) {
            voice(volume * near(x, z), effects[name]);
        },
        // Called every frame with the bike's speed (m/s), top speed and whether the throttle is open
        engine(speed, top, throttle) {
            if (!ctx) return;
            const t = ctx.currentTime;
            const r = Math.min(1, Math.abs(speed) / top);
            engine.saw.frequency.setTargetAtTime(38 + r * 110, t, 0.08);
            engine.square.frequency.setTargetAtTime((38 + r * 110) * 2.02, t, 0.08);
            engine.filter.frequency.setTargetAtTime(400 + r * 1400 + (throttle ? 600 : 0), t, 0.1);
            engine.out.gain.setTargetAtTime(0.07 + r * 0.1 + (throttle ? 0.04 : 0), t, 0.1);
        },
        // Ambience mix, each 0..1; call a few times a second
        ambience({ street = 0, market = 0, water = 0 }) {
            if (!ctx) return;
            const t = ctx.currentTime;
            beds.street.gain.setTargetAtTime(street * 0.25, t, 0.6);
            beds.market.gain.setTargetAtTime(market * 0.18, t, 0.6);
            beds.water.gain.setTargetAtTime(water * 0.3, t, 0.6);
        },
    };
}
