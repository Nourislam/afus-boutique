// Short beeps for the sales screen (scan accepted / refused). Generated with
// Web Audio, so no sound file and no internet are needed.
let context = null;

export function beep(kind = 'ok') {
    try {
        context = context || new (window.AudioContext || window.webkitAudioContext)();
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.type = 'square';
        osc.frequency.value = kind === 'ok' ? 1750 : 220;
        gain.gain.value = 0.04;
        osc.connect(gain);
        gain.connect(context.destination);
        const now = context.currentTime;
        osc.start(now);
        osc.stop(now + (kind === 'ok' ? 0.07 : 0.25));
    } catch {
        // Audio not available: silent
    }
}
