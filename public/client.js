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
    const startBtnMobile = document.getElementById('start-respawn-btn-mobile');
    const pauseBtnMobile = document.getElementById('pause-btn-mobile');
    
    // Mobile Dropdown Menu
    const menuToggleBtn = document.getElementById('menu-toggle-btn');
    const mobileMenuDropdown = document.getElementById('mobile-menu-dropdown');
    
    // Players Modal (Mobile)
    const playersModal = document.getElementById('players-modal');
    const playersModalBtn = document.getElementById('players-modal-btn');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const playerListMobile = document.getElementById('player-list-mobile');
    const yourNameMobile = document.getElementById('your-name-mobile');
    
    // Pause Overlay
    const pauseOverlay = document.getElementById('pause-overlay');

    // --- Client State ---
    let selfId = null;
    let GRID_SIZE = 30;
    let hasJoinedGame = false;

    // --- Connection Handling ---
    socket.on('connect', () => {
        gameStatus.textContent = 'Connected! Press Start to join.';
        gameStatus.classList.remove('text-red-500');
    });

    socket.on('connect_error', () => {
        gameStatus.textContent = 'Connection failed. Please refresh.';
        gameStatus.classList.add('text-red-500');
    });

    socket.on('init', ({ id, name }) => {
        selfId = id;
        yourNameDesktop.textContent = name;
        yourNameMobile.textContent = name;
    });

    // --- Game State & Drawing ---
    socket.on('gameState', (state) => {
        drawGame(state);
        updateUI(state);
    });

    function resizeCanvas() {
        const container = canvas.parentElement;
        const size = container.clientWidth;
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
        food.forEach(f => ctx.fillRect(f.x * scale, f.y * scale, scale, scale));

        for (const id in players) {
            const player = players[id];
            if (!player.isAlive || player.isPaused || !player.body) continue;
            ctx.fillStyle = id === selfId ? '#48bb78' : '#63b3ed';
            player.body.forEach(segment => ctx.fillRect(segment.x * scale, segment.y * scale, scale, scale));
        }
    }
    
    function updateUI(state) {
        if (!playerListDesktop || !state) return;
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
        if (isAlive) {
            startButtonText = 'Playing...';
        } else if (hasJoinedGame) {
            startButtonText = 'Respawn';
        }
        
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
    function handleStart() {
        socket.emit('startGame');
        hasJoinedGame = true;
    }
    
    function handlePause() {
        socket.emit('toggle-pause');
    }
    
    startBtnDesktop.addEventListener('click', handleStart);
    pauseBtnDesktop.addEventListener('click', handlePause);
    
    // Modal Listeners
    closeModalBtn.addEventListener('click', () => playersModal.classList.add('hidden'));

    // Mobile Dropdown Menu Logic
    if (menuToggleBtn) {
        menuToggleBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            mobileMenuDropdown.classList.toggle('hidden');
        });

        document.addEventListener('click', (event) => {
            if (!mobileMenuDropdown.classList.contains('hidden') && !mobileMenuDropdown.contains(event.target) && event.target !== menuToggleBtn) {
                mobileMenuDropdown.classList.add('hidden');
            }
        });
    }

    startBtnMobile.addEventListener('click', () => {
        handleStart();
        mobileMenuDropdown.classList.add('hidden');
    });

    playersModalBtn.addEventListener('click', () => {
        playersModal.classList.remove('hidden');
        mobileMenuDropdown.classList.add('hidden');
    });

    pauseBtnMobile.addEventListener('click', () => {
        handlePause();
        mobileMenuDropdown.classList.add('hidden');
    });


    // --- Controls ---

    // Keyboard controls
    document.addEventListener('keydown', (e) => {
        let direction = null;
        switch (e.key) {
            case 'w': case 'ArrowUp': direction = { x: 0, y: -1 }; break;
            case 's': case 'ArrowDown': direction = { x: 0, y: 1 }; break;
            case 'a': case 'ArrowLeft': direction = { x: -1, y: 0 }; break;
            case 'd': case 'ArrowRight': direction = { x: 1, y: 0 }; break;
        }
        if (direction) socket.emit('directionChange', direction);
    });

    // Touch controls on canvas
    function handleCanvasTouch(event) {
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const touch = event.touches[0];
        const touchX = touch.clientX - rect.left;
        const touchY = touch.clientY - rect.top;

        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;

        const dx = touchX - centerX;
        const dy = touchY - centerY;

        let direction = null;
        if (Math.abs(dx) > Math.abs(dy)) {
            // Horizontal movement
            direction = dx > 0 ? { x: 1, y: 0 } : { x: -1, y: 0 }; // Right or Left
        } else {
            // Vertical movement
            direction = dy > 0 ? { x: 0, y: 1 } : { x: 0, y: -1 }; // Down or Up
        }

        if (direction) {
            socket.emit('directionChange', direction);
        }
    }

    canvas.addEventListener('touchstart', handleCanvasTouch);

    // Update helper text for touch devices
    if ('ontouchstart' in window || navigator.maxTouchPoints) {
        controlsHelper.textContent = 'Tap on the canvas to change direction.';
    }
});

