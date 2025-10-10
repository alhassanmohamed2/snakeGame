document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // --- DOM Elements ---
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const gameStatus = document.getElementById('game-status');
    const controlsHelper = document.getElementById('controls-helper');

    // Desktop UI
    const playerListDesktop = document.getElementById('player-list-desktop');
    const yourNameDesktop = document.getElementById('your-name-desktop');
    const startBtnDesktop = document.getElementById('start-respawn-btn-desktop');
    const pauseBtnDesktop = document.getElementById('pause-btn-desktop');

    // Mobile UI
    const menuToggleBtn = document.getElementById('menu-toggle-btn');
    const mobileMenuDropdown = document.getElementById('mobile-menu-dropdown');
    const startBtnMobile = document.getElementById('start-respawn-btn-mobile');
    const pauseBtnMobile = document.getElementById('pause-btn-mobile');
    const playersModalBtn = document.getElementById('players-modal-btn');
    const toggleControlsBtn = document.getElementById('toggle-controls-btn');
    
    // Players Modal
    const playersModal = document.getElementById('players-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const playerListMobile = document.getElementById('player-list-mobile');
    const yourNameMobile = document.getElementById('your-name-mobile');
    
    // Pause Overlay
    const pauseOverlay = document.getElementById('pause-overlay');

    // Joystick
    const joystickContainer = document.getElementById('joystick-container');
    let joystick = null;

    // --- Client State ---
    let selfId = null;
    let GRID_SIZE = 30;
    let hasJoinedGame = false;
    let lastGameState = null; 
    let touchDragEnabled = true;

    // --- Connection Handling ---
    socket.on('connect', () => { gameStatus.textContent = 'Finding a game...'; });
    socket.on('connect_error', () => { gameStatus.textContent = 'Connection failed. Please refresh.'; });
    socket.on('init', ({ id, name, roomId }) => {
        selfId = id;
        yourNameDesktop.textContent = name;
        yourNameMobile.textContent = name;
        gameStatus.textContent = `Connected to Room: ${roomId.split('_')[1]}`;
    });

    // --- Game State & Drawing ---
    socket.on('gameState', (state) => {
        lastGameState = state;
        drawGame(state);
        updateUI(state);
    });

    function resizeCanvas() {
        const container = canvas.parentElement;
        const size = Math.min(container.clientWidth, container.clientHeight);
        canvas.width = size;
        canvas.height = size;
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    function drawGame(state) {
        if (!canvas || !state) return;
        const { players, food } = state;
        const scale = canvas.width / GRID_SIZE;
        ctx.fillStyle = '#1a202c';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#f56565';
        if(food) food.forEach(f => ctx.fillRect(f.x * scale, f.y * scale, scale, scale));
        
        if(players) {
            for (const id in players) {
                const player = players[id];
                if (!player.isAlive || player.isPaused || !player.body || player.body.length === 0) continue;
                
                const ownSnake = { body: '#48bb78', head: '#68D391', tail: '#38A169' };
                const otherSnake = { body: '#63b3ed', head: '#90CDF4', tail: '#4299E1' };
                const colors = id === selfId ? ownSnake : otherSnake;

                player.body.forEach((segment, index) => {
                    const sx = segment.x * scale;
                    const sy = segment.y * scale;

                    if (index === 0) {
                        ctx.fillStyle = colors.head;
                        const dir = player.direction;
                        
                        ctx.save();
                        ctx.translate(sx + scale / 2, sy + scale / 2);
                        
                        const angle = Math.atan2(dir.y, dir.x);
                        ctx.rotate(angle);

                        ctx.beginPath();
                        ctx.moveTo(scale / 2, 0); 
                        ctx.lineTo(-scale / 2, -scale / 2.5);
                        ctx.lineTo(-scale / 2, scale / 2.5);
                        ctx.closePath();
                        ctx.fill();
                        
                        ctx.restore();

                    } else if (index === player.body.length - 1 && player.body.length > 1) {
                        ctx.fillStyle = colors.tail;
                        ctx.fillRect(sx + scale * 0.15, sy + scale * 0.15, scale * 0.7, scale * 0.7);
                    } else {
                        ctx.fillStyle = colors.body;
                        ctx.fillRect(sx, sy, scale, scale);
                    }
                });
            }
        }
    }
    
    function updateUI(state) {
        if (!playerListDesktop || !state || !state.players) return;
        const { players } = state;
        const sortedPlayers = Object.values(players).sort((a, b) => b.score - a.score);
        playerListDesktop.innerHTML = '';
        playerListMobile.innerHTML = '';
        sortedPlayers.forEach(player => {
            const card = document.createElement('div');
            let pausedIndicator = player.isPaused ? '<span class="text-xs text-yellow-400 ml-2">(Paused)</span>' : '';
            card.className = `player-card p-3 rounded-lg flex justify-between items-center transition-all ${player.isAlive ? 'bg-gray-700' : 'bg-gray-600 dead'}`;
            card.innerHTML = `<span class="font-semibold truncate">${player.name}${pausedIndicator}</span><span class="font-bold text-lg ${player.name === yourNameDesktop.textContent ? 'text-green-400' : ''}">${player.score}</span>`;
            playerListDesktop.appendChild(card.cloneNode(true));
            playerListMobile.appendChild(card);
        });
        const me = players[selfId];
        if (!me) return;
        const isAlive = me.isAlive;
        const isPaused = me.isPaused;
        let startButtonText = 'Start Game';
        if (isAlive) startButtonText = 'Playing...';
        else if (hasJoinedGame) startButtonText = 'Respawn';
        startBtnDesktop.textContent = startButtonText;
        startBtnDesktop.disabled = isAlive;
        startBtnMobile.textContent = startButtonText;
        startBtnMobile.disabled = isAlive;
        pauseBtnDesktop.textContent = isPaused ? 'Resume' : 'Pause';
        pauseBtnMobile.textContent = isPaused ? 'Resume' : 'Pause';
        pauseBtnDesktop.disabled = !isAlive;
        pauseBtnMobile.disabled = !isAlive;
        pauseOverlay.classList.toggle('hidden', !isPaused);
    }

    // --- Event Listeners ---
    function handleStart() { socket.emit('startGame'); hasJoinedGame = true; }
    function handlePause() { socket.emit('toggle-pause'); }

    startBtnDesktop.addEventListener('click', handleStart);
    pauseBtnDesktop.addEventListener('click', handlePause);
    startBtnMobile.addEventListener('click', () => { handleStart(); mobileMenuDropdown.classList.add('hidden'); });
    pauseBtnMobile.addEventListener('click', () => { handlePause(); mobileMenuDropdown.classList.add('hidden'); });
    
    playersModalBtn.addEventListener('click', () => { playersModal.classList.remove('hidden'); mobileMenuDropdown.classList.add('hidden'); });
    closeModalBtn.addEventListener('click', () => playersModal.classList.add('hidden'));

    menuToggleBtn.addEventListener('click', (e) => { e.stopPropagation(); mobileMenuDropdown.classList.toggle('hidden'); });
    document.addEventListener('click', (e) => {
        if (!mobileMenuDropdown.classList.contains('hidden') && !mobileMenuDropdown.contains(e.target) && e.target !== menuToggleBtn) {
            mobileMenuDropdown.classList.add('hidden');
        }
    });

    // --- Controls ---
    const keysPressed = {};

    function updateDirectionFromKeys() {
        const direction = { x: 0, y: 0 };
        if (keysPressed['w'] || keysPressed['ArrowUp']) direction.y = -1;
        else if (keysPressed['s'] || keysPressed['ArrowDown']) direction.y = 1;
        if (keysPressed['a'] || keysPressed['ArrowLeft']) direction.x = -1;
        else if (keysPressed['d'] || keysPressed['ArrowRight']) direction.x = 1;

        if (direction.x !== 0 || direction.y !== 0) {
            socket.emit('directionChange', direction);
        }
    }

    document.addEventListener('keydown', (e) => {
        if (['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            if (keysPressed[e.key]) return; 
            keysPressed[e.key] = true;
            updateDirectionFromKeys();
        }
    });

    document.addEventListener('keyup', (e) => {
        if (['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            keysPressed[e.key] = false;
        }
    });


    function handleCanvasTouch(event) {
        if (!touchDragEnabled) return;
        event.preventDefault();
        if (!lastGameState || !lastGameState.players[selfId] || !lastGameState.players[selfId].isAlive) return;
        const player = lastGameState.players[selfId];
        if (!player.body || player.body.length === 0) return;
        const head = player.body[0];
        const scale = canvas.width / GRID_SIZE;
        const headPixelX = head.x * scale + scale / 2;
        const headPixelY = head.y * scale + scale / 2;
        const rect = canvas.getBoundingClientRect();
        const touch = event.touches[0];
        const touchX = touch.clientX - rect.left;
        const touchY = touch.clientY - rect.top;
        const dx = touchX - headPixelX;
        const dy = touchY - headPixelY;
        
        // CHANGE: New logic to calculate 8-directional movement from touch angle.
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return; // Ignore taps near the center

        const angle = Math.atan2(dy, dx);
        const pi = Math.PI;
        let newDirection = null;

        if (angle > -pi / 8 && angle <= pi / 8) newDirection = { x: 1, y: 0 }; // Right
        else if (angle > pi / 8 && angle <= 3 * pi / 8) newDirection = { x: 1, y: 1 }; // Down-Right
        else if (angle > 3 * pi / 8 && angle <= 5 * pi / 8) newDirection = { x: 0, y: 1 }; // Down
        else if (angle > 5 * pi / 8 && angle <= 7 * pi / 8) newDirection = { x: -1, y: 1 }; // Down-Left
        else if (angle > 7 * pi / 8 || angle <= -7 * pi / 8) newDirection = { x: -1, y: 0 }; // Left
        else if (angle > -7 * pi / 8 && angle <= -5 * pi / 8) newDirection = { x: -1, y: -1 }; // Up-Left
        else if (angle > -5 * pi / 8 && angle <= -3 * pi / 8) newDirection = { x: 0, y: -1 }; // Up
        else if (angle > -3 * pi / 8 && angle <= -pi / 8) newDirection = { x: 1, y: -1 }; // Up-Right

        if (newDirection) {
            socket.emit('directionChange', newDirection);
        }
    }
    canvas.addEventListener('touchstart', handleCanvasTouch);
    canvas.addEventListener('touchmove', handleCanvasTouch);

    function createJoystick() {
        if (joystick) joystick.destroy();
        joystickContainer.classList.remove('hidden');
        joystick = nipplejs.create({
            zone: joystickContainer,
            mode: 'static',
            position: { right: '75px', bottom: '75px' },
            color: 'cyan',
            size: 150
        });
        joystick.on('dir:up dir:down dir:left dir:right dir:up-left dir:up-right dir:down-left dir:down-right', (evt, data) => {
            let direction = null;
            switch(data.direction.angle) {
                case 'up': direction = { x: 0, y: -1 }; break;
                case 'down': direction = { x: 0, y: 1 }; break;
                case 'left': direction = { x: -1, y: 0 }; break;
                case 'right': direction = { x: 1, y: 0 }; break;
                case 'up-left': direction = { x: -1, y: -1 }; break;
                case 'up-right': direction = { x: 1, y: -1 }; break;
                case 'down-left': direction = { x: -1, y: 1 }; break;
                case 'down-right': direction = { x: 1, y: 1 }; break;
            }
            if (direction) socket.emit('directionChange', direction);
        });
    }

    function destroyJoystick() {
        if (joystick) {
            joystick.destroy();
            joystick = null;
        }
        joystickContainer.classList.add('hidden');
    }

    toggleControlsBtn.addEventListener('click', () => {
        touchDragEnabled = !touchDragEnabled;
        if (touchDragEnabled) {
            destroyJoystick();
            controlsHelper.textContent = 'Touch/drag on canvas to move.';
            toggleControlsBtn.textContent = 'Use Joystick';
        } else {
            createJoystick();
            controlsHelper.textContent = 'Use the joystick to move.';
            toggleControlsBtn.textContent = 'Use Touch-Drag';
        }
        mobileMenuDropdown.classList.add('hidden');
    });

    if ('ontouchstart' in window || navigator.maxTouchPoints) {
        controlsHelper.textContent = 'Touch/drag on canvas to move.';
    }
});

