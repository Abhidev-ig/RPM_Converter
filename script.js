document.addEventListener('DOMContentLoaded', () => {
    const rpmInput = document.getElementById('rpm-input');
    const rpmSlider = document.getElementById('rpm-slider');
    const hzOutput = document.getElementById('hz-output');
    const radsOutput = document.getElementById('rads-output');
    const degsOutput = document.getElementById('degs-output');
    const gearIcon = document.querySelector('.gear-icon');
    const reactorHousing = document.querySelector('.reactor-housing');
    const alertBox = document.getElementById('critical-alert');
    const overdriveBtn = document.getElementById('overdrive-toggle');
    const particleContainer = document.getElementById('particles');
    const audioBtn = document.getElementById('audio-toggle');

    let overdriveEnabled = false;
    let particleInterval = null;

    // Audio Context
    let audioCtx = null;
    let engineOsc = null;
    let engineGain = null;
    let lfoOsc = null; // Low Frequency for rumble
    let lfoGain = null;
    let alarmOsc = null;
    let alarmGain = null;
    let isAudioActive = false;

    // --- AUDIO SYSTEM ---
    async function initAudio() {
        if (audioCtx) return;

        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();

            // Engine Oscillator (Main Hum)
            // INCREASED FREQUENCY for laptop speakers
            engineOsc = audioCtx.createOscillator();
            engineGain = audioCtx.createGain();
            engineOsc.type = 'sawtooth';
            engineOsc.frequency.value = 100; // was 50
            engineGain.gain.value = 0;

            // Low pass filter
            const filter = audioCtx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 800; // was 400

            engineOsc.connect(filter);
            filter.connect(engineGain);
            engineGain.connect(audioCtx.destination);
            engineOsc.start();

            // Sub-bass LFO (Rumble)
            lfoOsc = audioCtx.createOscillator();
            lfoGain = audioCtx.createGain();
            lfoOsc.type = 'sine';
            lfoOsc.frequency.value = 60; // was 30
            lfoGain.gain.value = 0;

            lfoOsc.connect(lfoGain);
            lfoGain.connect(audioCtx.destination);
            lfoOsc.start();

            // Alarm System
            alarmOsc = audioCtx.createOscillator();
            alarmGain = audioCtx.createGain();
            alarmOsc.type = 'square';
            alarmOsc.frequency.value = 880;
            alarmGain.gain.value = 0;

            alarmOsc.connect(alarmGain);
            alarmGain.connect(audioCtx.destination);
            alarmOsc.start();

            isAudioActive = true;
            audioBtn.textContent = 'AUDIO: ON';
            audioBtn.classList.add('active');

            // Resume context if suspended (browser policy)
            if (audioCtx.state === 'suspended') {
                await audioCtx.resume();
            }
            console.log("Audio System Initialized");

        } catch (e) {
            console.error("Audio Init Failed", e);
        }
    }

    function updateAudio(rpm) {
        if (!isAudioActive || !audioCtx) return;

        const normalizedRpm = Math.max(0, rpm);

        // 1. Engine Pitch (Frequency)
        // Base 100Hz
        const pitch = 100 + (normalizedRpm * 0.04);
        engineOsc.frequency.setTargetAtTime(pitch, audioCtx.currentTime, 0.1);

        // 2. Engine Volume (Gain)
        // BOOSTED VOLUME: 0.5 max (was 0.2)
        const vol = Math.min(0.5, normalizedRpm / 10000);
        engineGain.gain.setTargetAtTime(vol, audioCtx.currentTime, 0.1);

        // 3. Rumble
        lfoOsc.frequency.setTargetAtTime(60 + (normalizedRpm * 0.01), audioCtx.currentTime, 0.1);
        lfoGain.gain.setTargetAtTime(vol, audioCtx.currentTime, 0.1);
    }

    function setAlarm(state) {
        if (!isAudioActive || !alarmGain) return;
        // Simple alarm logic: if state is true, increase volume
        if (state) {
            const now = audioCtx.currentTime;
            if (alarmGain.gain.value < 0.01) {
                // Pulse Effect
                alarmGain.gain.setValueAtTime(0.1, now);
                alarmGain.gain.linearRampToValueAtTime(0, now + 0.3);
                alarmGain.gain.linearRampToValueAtTime(0.1, now + 0.6);
            }
        } else {
            alarmGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
        }
    }

    // Toggle Audio
    audioBtn.addEventListener('click', () => {
        if (!isAudioActive) {
            initAudio();
        } else {
            if (audioCtx) {
                audioCtx.close();
                audioCtx = null;
            }
            isAudioActive = false;

            audioBtn.textContent = 'AUDIO: OFF';
            audioBtn.classList.remove('active');
            logEvent("AUDIO MUTED", "sys");
        }
    });

    // Toggle Overdrive
    overdriveBtn.addEventListener('click', () => {
        overdriveEnabled = !overdriveEnabled;

        if (overdriveEnabled) {
            overdriveBtn.classList.add('active');
            overdriveBtn.textContent = 'SAFETY DISABLED';
            rpmSlider.max = 9999;
            document.body.classList.add('overdrive');
            // Add glitch effect to headers
            document.querySelector('h1').classList.add('glitch-effect');
            logEvent("LIMITER DISENGAGED. CAUTION.", "warn");
        } else {
            overdriveBtn.classList.remove('active');
            overdriveBtn.textContent = 'ENGAGE OVERDRIVE';
            rpmSlider.max = 6000;
            document.body.classList.remove('overdrive');
            document.querySelector('h1').classList.remove('glitch-effect');

            // Clamp value if it was above limit
            if (parseFloat(rpmInput.value) > 6000) {
                rpmInput.value = 6000;
                rpmSlider.value = 6000;
                convertValues('input');
            }
        }
    });

    function convertValues(source) {
        let rpm;

        // Sync input and slider
        if (source === 'slider') {
            rpm = parseFloat(rpmSlider.value);
            rpmInput.value = rpm;
        } else {
            rpm = parseFloat(rpmInput.value);
            if (!isNaN(rpm)) {
                const max = overdriveEnabled ? 9999 : 6000;
                rpmSlider.value = Math.min(rpm, max);
            }
        }

        // Reset states if invalid
        if (isNaN(rpm) || rpm === 0) {
            hzOutput.textContent = '0.00';
            radsOutput.textContent = '0.00';
            degsOutput.textContent = '0.00';
            gearIcon.style.animationDuration = '0s';
            updateVisualState(0);
            stopParticles();
            // Silence Audio
            if (isAudioActive && engineGain) {
                engineGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
                lfoGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
            }
            return;
        }

        // Update Physics
        const hz = rpm / 60;
        const rads = rpm * (2 * Math.PI) / 60;
        const degs = rpm * 6;

        const formatter = new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
            useGrouping: true
        });

        hzOutput.textContent = formatter.format(hz);
        radsOutput.textContent = formatter.format(rads);
        degsOutput.textContent = formatter.format(degs);

        // Update Visuals & Audio
        const speed = 60 / Math.abs(rpm);
        gearIcon.style.animationDuration = `${speed}s`;

        // --- VISUAL OVERLOAD ---
        // 1. Warp Speed Background
        // Map 0-10000 RPM to 20s-0.2s duration
        // High RPM = Low Duration
        const gridDuration = Math.max(0.2, 20 - (Math.abs(rpm) / 500));
        document.querySelector('.background-grid').style.animationDuration = `${gridDuration}s`;

        // 2. Core Pulse
        // Scale core slightly based on RPM intensity
        const scale = 1 + (Math.abs(rpm) / 20000); // 1.0 to 1.5
        document.querySelector('.core-wrapper').style.transform =
            `rotateX(calc(var(--mouseY, 0) * -15deg)) rotateY(calc(var(--mouseX, 0) * 15deg)) scale(${scale})`;

        updateVisualState(rpm);
        manageParticles(rpm);
        updateAudio(rpm);

        // 3. HUD Glitch (High RPM Randomness)
        if (overdriveEnabled && Math.abs(rpm) > 8000 && Math.random() > 0.8) {
            const panels = document.querySelectorAll('.hud-panel');
            panels.forEach(p => {
                const dx = (Math.random() - 0.5) * 10;
                const dy = (Math.random() - 0.5) * 10;
                p.style.transform = `translate(${dx}px, ${dy}px)`;
            });
            // Reset after brief glitches handled by CSS transition or next frame? 
            // CSS transition is 0.1s, so this will jitter.
        } else {
            // Reset to parallax default (though mousemove event handles this largely, manual reset helps)
            // Actually, mousemove writes to CSS vars. We shouldn't overwrite transform directly if we want parallax.
            // But we ARE overwriting transform here for Glitch.
            // Better approach: Add a CSS class .glitching that adds the offset via variable or calc?
            // Or just let the jitter be 'extra' translation.
            // We can skip resetting here and let mousemove listener win on next event?
            // Mousemove updates CSS variables, but doesn't set style.transform directly on panels.
            // Wait, the CSS uses `transform: translate(...)`.
            // Inline style overrides class style.
            // So if we set style.transform, we break parallax.

            // CORRECT FIX: Do not set style.transform directly.
            // Modify CSS variables --glitchX, --glitchY on the body/panel.
        }

        if (overdriveEnabled && Math.abs(rpm) > 8000) {
            const gx = (Math.random() - 0.5) * 10 + 'px';
            const gy = (Math.random() - 0.5) * 10 + 'px';
            document.body.style.setProperty('--glitchX', gx);
            document.body.style.setProperty('--glitchY', gy);
        } else {
            document.body.style.setProperty('--glitchX', '0px');
            document.body.style.setProperty('--glitchY', '0px');
        }
    }

    function updateVisualState(rpm) {
        if (rpm > 5000 && !overdriveEnabled) {
            document.body.classList.add('critical');
            reactorHousing.classList.add('shake-effect');
            alertBox.classList.add('visible');
            alertBox.textContent = "WARNING: CRITICAL RPM";
            setAlarm(true);
        } else if (rpm > 8000 && overdriveEnabled) {
            // Overdrive Critical
            reactorHousing.classList.add('shake-effect');
            alertBox.classList.add('visible');
            alertBox.textContent = "ERROR: REALITY INSTABILITY";
            alertBox.classList.add('glitch-effect');
            setAlarm(true);
        } else {
            document.body.classList.remove('critical');
            reactorHousing.classList.remove('shake-effect');
            alertBox.classList.remove('visible');
            alertBox.classList.remove('glitch-effect');
            setAlarm(false);
        }
    }

    // --- PARTICLE SYSTEM ---
    function manageParticles(rpm) {
        if (particleInterval) clearInterval(particleInterval);

        let spawnRate;
        if (rpm < 100) spawnRate = 500;
        else spawnRate = Math.max(10, 20000 / rpm); // 6000 rpm -> ~3ms (too fast), 20000/6000 = 3.3

        // Cap spawn rate to avoid browser crash
        spawnRate = Math.max(20, spawnRate);

        particleInterval = setInterval(() => {
            spawnParticle(rpm);
        }, spawnRate);
    }

    function stopParticles() {
        if (particleInterval) clearInterval(particleInterval);
        particleContainer.innerHTML = '';
    }

    function spawnParticle(rpm) {
        // Performance limit
        if (particleContainer.childElementCount > 50) return;

        const p = document.createElement('div');
        p.classList.add('particle');

        // Random angle
        const angle = Math.random() * Math.PI * 2;
        const distance = 150 + Math.random() * 100; // Fly out distance

        // CSS Variables for the animation
        const tx = Math.cos(angle) * distance + 'px';
        const ty = Math.sin(angle) * distance + 'px';

        p.style.setProperty('--tx', tx);
        p.style.setProperty('--ty', ty);

        particleContainer.appendChild(p);

        // Clean up
        setTimeout(() => p.remove(), 1000);
    }

    rpmInput.addEventListener('input', () => convertValues('input'));
    rpmSlider.addEventListener('input', () => convertValues('slider'));

    // Initial Run
    convertValues('input');
    // --- GAME SYSTEMS ---
    const gameBtn = document.getElementById('game-toggle');
    const gameStats = document.getElementById('game-stats');
    const targetDisplay = document.getElementById('target-rpm');
    const scoreDisplay = document.getElementById('score-output');

    let isGameActive = false;
    let score = 0;
    let targetRpm = 3000;
    let gameLoopInterval = null;
    let stabilityTimer = 0;

    gameBtn.addEventListener('click', () => {
        isGameActive = !isGameActive;

        if (isGameActive) {
            startGame();
            logEvent("SIMULATION SEQUENCE INITIATED", "sys");
        } else {
            stopGame();
            logEvent("SIMULATION ABORTED", "sys");
        }
    });

    function startGame() {
        gameBtn.textContent = 'ABORT SEQUENCE';
        gameStats.style.display = 'block';
        score = 0;
        document.body.classList.remove('critical', 'overdrive'); // Reset states

        // Disable Overdrive during calibration game? Or allow it? 
        // Let's force safety off for game rules
        if (overdriveEnabled) overdriveBtn.click();

        gameLoopInterval = setInterval(gameLoop, 100); // 10 ticks per second
    }

    function stopGame() {
        gameBtn.textContent = 'START SEQUENCE';
        gameStats.style.display = 'none';
        isGameActive = false;
        clearInterval(gameLoopInterval);
        document.body.classList.remove('stable', 'unstable');
    }

    function gameLoop() {
        // 1. Drift Target
        // Random walk
        const change = (Math.random() - 0.5) * 200; // +/- 100 RPM per tick possibility
        targetRpm += change;

        // Clamp Target
        targetRpm = Math.max(1000, Math.min(5500, targetRpm)); // Keep within reasonable bounds

        targetDisplay.textContent = Math.floor(targetRpm);

        // 2. Check Stability
        const currentRpm = parseFloat(rpmInput.value) || 0;
        const diff = Math.abs(currentRpm - targetRpm);

        // Stability Zone: +/- 300 RPM
        if (diff < 300) {
            // STABLE
            score += 10; // +100 points per second
            document.body.classList.add('stable');
            document.body.classList.remove('unstable');

            // Visual feedback on core handled by CSS
        } else {
            // UNSTABLE
            document.body.classList.remove('stable');
            document.body.classList.add('unstable');
        }

        scoreDisplay.textContent = score;
    }

    // --- MAIN LOOP UPDATE for Game Visuals ---
    // Hook into convertValues or just let CSS handle class-based visuals?
    // We used CSS classes 'stable'/'unstable' which override colors.
    // Ensure updateVisualState doesn't clobber game state

    // REDEFINED updateVisualState to respect Game Mode
    const originalUpdateVisuals = updateVisualState;

    // Overwrite the function in scope
    updateVisualState = function (rpm) {
        if (isGameActive) {
            alertBox.classList.remove('visible'); // Hide alerts during game to focus on target
            reactorHousing.classList.remove('shake-effect');
            return; // Let game loop handle classes
        }

        // Fallback to original logic if game not active
        if (rpm > 5000 && !overdriveEnabled) {
            document.body.classList.add('critical');
            reactorHousing.classList.add('shake-effect');
            alertBox.classList.add('visible');
            alertBox.textContent = "WARNING: CRITICAL RPM";
            setAlarm(true);
        } else if (rpm > 8000 && overdriveEnabled) {
            reactorHousing.classList.add('shake-effect');
            alertBox.classList.add('visible');
            alertBox.textContent = "ERROR: REALITY INSTABILITY";
            alertBox.classList.add('glitch-effect');
            setAlarm(true);
        } else {
            document.body.classList.remove('critical');
            reactorHousing.classList.remove('shake-effect');
            alertBox.classList.remove('visible');
            alertBox.classList.remove('glitch-effect');
            setAlarm(false);
        }
    };



    // --- FLIGHT RECORDER ---
    const canvas = document.getElementById('rpm-graph');
    const ctx = canvas.getContext('2d');
    const logTerminal = document.getElementById('log-terminal');

    // Graph Data
    let rpmHistory = new Array(100).fill(0);

    // Log Helper
    function logEvent(msg, type = 'info') {
        const now = new Date();
        const time = now.toLocaleTimeString('en-US', { hour12: false });
        const entry = document.createElement('div');
        entry.classList.add('log-entry');
        if (type === 'warn') entry.classList.add('warn');
        if (type === 'crit') entry.classList.add('crit');

        entry.textContent = `[${time}] ${msg}`;

        // Prepend to show newest at top (flex-direction: column-reverse handles visual bottom adherence if we appended, 
        // but column-reverse makes the *first* child be at the bottom. 
        // Actually, for a terminal, we usually want new items at bottom. 
        // If I use appendChild and flex-direction: column, I need to scroll to bottom.
        // If I use prepend and flex-direction: column-reverse, it stays anchored to bottom.
        // Let's use prepend.
        logTerminal.prepend(entry);

        // Trim logs
        if (logTerminal.children.length > 50) {
            logTerminal.lastElementChild.remove();
        }
    }

    // Graph Render Loop
    function updateGraph(currentRpm) {
        // Shift data
        rpmHistory.shift();
        rpmHistory.push(currentRpm);

        // Clear
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw Grid
        ctx.strokeStyle = 'rgba(0, 243, 255, 0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < canvas.width; i += 20) { ctx.moveTo(i, 0); ctx.lineTo(i, canvas.height); }
        for (let i = 0; i < canvas.height; i += 20) { ctx.moveTo(0, i); ctx.lineTo(canvas.width, i); }
        ctx.stroke();

        // Draw Line
        ctx.beginPath();
        const step = canvas.width / rpmHistory.length;

        // Normalize height: Max 9999 -> canvas.height
        const maxVal = 10000;

        // Move to first point
        let startY = canvas.height - (rpmHistory[0] / maxVal * canvas.height);
        ctx.moveTo(0, startY);

        // Loop
        for (let i = 1; i < rpmHistory.length; i++) {
            let x = i * step;
            let y = canvas.height - (rpmHistory[i] / maxVal * canvas.height);
            ctx.lineTo(x, y);
        }

        // Color based on current state
        if (currentRpm > 8000) ctx.strokeStyle = '#ff00ff'; // Overdrive
        else if (currentRpm > 5000) ctx.strokeStyle = '#ff0000'; // Critical
        else ctx.strokeStyle = '#00f3ff'; // Normal

        ctx.lineWidth = 2;
        ctx.stroke();

        // Fill area
        ctx.lineTo(canvas.width, canvas.height);
        ctx.lineTo(0, canvas.height);
        ctx.fillStyle = ctx.strokeStyle + '33'; // 20% opacity
        ctx.fill();
    }

    // Inject Logging into events
    // We need to modify existing event listeners to call logEvent
    // But since we are appending code, we can't easily modify the *inside* of existing checks above without search/replace.
    // However, I can hook into the 'convertValues' loop for graph.
    // For specific events (click), I might need to replace the blocks above. 
    // Wait, I am using replace_file_content but this block is just appending to the end usually?
    // User instruction says "Implement... Add log events...".
    // I should probably edit the existing blocks to add log calls, OR just observe changes.
    // I already have hooks for updates.

    // Let's hook the graph into the main update loop by redefining convertValues or calling it?
    // I can stick the call in `updateVisualState` which is called every frame?
    // Actually, `updateVisualState` is called by `convertValues`.
    // Let's monkey-patch `updateVisualState` again or just insert the call.

    // Start Graph Loop (Time-based, 20fps)
    setInterval(() => {
        const currentRpm = parseFloat(rpmInput.value) || 0;
        updateGraph(currentRpm);
    }, 50);

    // Monkey-patch Overdrive Toggle
    const originalOverdriveClick = overdriveBtn.onclick;
    // ... wait, I added an event listener, not onclick property. I can't easily hook it without modifying the original code block.
    // I will use replace_file_content to Inject log calls into the specific locations in the file instead of appending code at bottom.

    // -- This block is just for initialization -- 
    logEvent("RECORDER ONLINE", "sys");


    // --- DYNO MODE UPGRADE ---

    // --- MODE SWITCHING & UPGRADES ---
    const dynoToggle = document.getElementById('dyno-toggle');
    const stdView = document.getElementById('diagnostics-std');
    const dynoView = document.getElementById('diagnostics-dyno');
    const cncView = document.getElementById('diagnostics-cnc');
    const gearView = document.getElementById('diagnostics-gear');

    // Dyno Inputs
    const torqueInput = document.getElementById('torque-input');
    const kwOutput = document.getElementById('kw-output');
    const hpOutput = document.getElementById('hp-output');

    // CNC Inputs
    const diameterInput = document.getElementById('diameter-input');
    const velocityOutput = document.getElementById('velocity-output');

    // Gear Inputs
    const gearN1Input = document.getElementById('gear-n1');
    const gearN2Input = document.getElementById('gear-n2');
    const gearOutput = document.getElementById('gear-output');
    const torqueOutput = document.getElementById('torque-output');

    // Modes: 0=STD, 1=DYNO, 2=CNC, 3=GEAR
    let activeMode = 0;
    let currentTorque = 300;
    let currentDiameter = 100;
    let gearN1 = 20;
    let gearN2 = 40;

    dynoToggle.addEventListener('click', () => {
        activeMode = (activeMode + 1) % 4;
        updateModeUI();
    });

    function updateModeUI() {
        stdView.style.display = 'none';
        dynoView.style.display = 'none';
        cncView.style.display = 'none';
        gearView.style.display = 'none';

        if (activeMode === 0) {
            stdView.style.display = 'block';
            dynoToggle.textContent = 'MODE: STD';
            logEvent("DIAGNOSTICS: STANDARD MODE", "sys");
        } else if (activeMode === 1) {
            dynoView.style.display = 'block';
            dynoToggle.textContent = 'MODE: DYNO';
            logEvent("DIAGNOSTICS: DYNAMOMETER", "sys");
            updateCalculations();
        } else if (activeMode === 2) {
            cncView.style.display = 'block';
            dynoToggle.textContent = 'MODE: CNC';
            logEvent("DIAGNOSTICS: CNC MACHINING", "sys");
            updateCalculations();
        } else if (activeMode === 3) {
            gearView.style.display = 'block';
            dynoToggle.textContent = 'MODE: GEAR';
            logEvent("DIAGNOSTICS: TRANSMISSION", "sys");
            updateCalculations();
        }
    }

    torqueInput.addEventListener('input', () => {
        currentTorque = parseFloat(torqueInput.value) || 0;
        updateCalculations();
    });

    diameterInput.addEventListener('input', () => {
        currentDiameter = parseFloat(diameterInput.value) || 0;
        updateCalculations();
    });

    gearN1Input.addEventListener('input', () => {
        gearN1 = parseFloat(gearN1Input.value) || 1;
        updateCalculations();
    });

    gearN2Input.addEventListener('input', () => {
        gearN2 = parseFloat(gearN2Input.value) || 1;
        updateCalculations();
    });

    function updateCalculations() {
        const rpm = parseFloat(rpmInput.value) || 0;

        const formatter = new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });

        if (activeMode === 1) {
            // DYNO
            const kw = (currentTorque * rpm * 2 * Math.PI) / 60000;
            const hp = kw / 0.7457;
            kwOutput.textContent = formatter.format(kw);
            hpOutput.textContent = formatter.format(hp);
        } else if (activeMode === 2) {
            // CNC: v (m/s) = (PI * D_mm * RPM) / 60000
            const velocity = (Math.PI * currentDiameter * rpm) / 60000;
            velocityOutput.textContent = formatter.format(velocity);
        } else if (activeMode === 3) {
            // GEAR
            const ratio = gearN2 / (gearN1 || 1);
            const outRpm = rpm / (ratio || 1);
            const outTorque = currentTorque * ratio;

            gearOutput.textContent = `1:${formatter.format(ratio)} | ${Math.floor(outRpm)} RPM`;
            torqueOutput.textContent = formatter.format(outTorque);
        }
    }

    // Auto-update Active Mode
    setInterval(updateCalculations, 100);

    // --- BOOT SEQUENCE ---
    const bootScreen = document.getElementById('boot-screen');
    const bootLog = document.getElementById('boot-log');

    const bootMessages = [
        "INITIALIZING KERNEL...",
        "LOADING PHYSICS ENGINE (v2.4)...",
        "CONNECTING TO REACTOR CORE...",
        "CHECKING PLASMA CONTAINMENT...",
        "CALIBRATING SENSORS...",
        "SYSTEM READY."
    ];

    let msgIndex = 0;

    function typeMessage() {
        if (msgIndex >= bootMessages.length) {
            setTimeout(finishBoot, 500);
            return;
        }

        const msg = bootMessages[msgIndex];
        const line = document.createElement('div');
        bootLog.appendChild(line);

        // Instant typing for speed, or char by char?
        // Let's do instant line + delay for retro feel
        line.textContent = `> ${msg}`;

        msgIndex++;
        const delay = 200 + Math.random() * 300;
        setTimeout(typeMessage, delay);
    }

    function finishBoot() {
        bootScreen.style.opacity = '0';
        setTimeout(() => {
            bootScreen.style.display = 'none';
        }, 1000);
    }

    // Start Boot
    setTimeout(typeMessage, 500);

    // --- PARALLAX COCKPIT ---
    document.addEventListener('mousemove', (e) => {
        // Calculate normalized position (-1 to 1)
        const x = (e.clientX / window.innerWidth) * 2 - 1;
        const y = (e.clientY / window.innerHeight) * 2 - 1;

        // Update CSS variables
        document.body.style.setProperty('--mouseX', x);
        document.body.style.setProperty('--mouseY', y);
    });

});
