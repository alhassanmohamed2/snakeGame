const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new socketIo.Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

// --- Game State ---
const GRID_SIZE = 30;
let players = {};
let food = [];
let gameInterval = null;

const TICK_RATE = 120; // milliseconds per tick

// --- Player Name Generation ---
const ADJECTIVES = ["Agile", "Brave", "Clever", "Daring", "Eager", "Fast", "Glowing", "Happy", "Iron", "Jolly", "Keen", "Lucky"];
const ANIMALS = ["Ape", "Bear", "Cat", "Dog", "Eagle", "Fox", "Goat", "Hawk", "Impala", "Jaguar", "Koala", "Lion"];

function generateRandomName() {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
    const num = Math.floor(Math.random() * 100);
    return `${adj} ${animal} ${num}`;
}

// --- Game Logic ---

function getSafeRandomPosition() {
    let position;
    let isSafe = false;
    let attempts = 0;

    while (!isSafe && attempts < GRID_SIZE * GRID_SIZE) {
        position = {
            x: Math.floor(Math.random() * GRID_SIZE),
            y: Math.floor(Math.random() * GRID_SIZE)
        };
        
        let occupied = false;
        // Check against other players' bodies
        for (const playerId in players) {
            if (players[playerId].body) {
                for (const segment of players[playerId].body) {
                    if (segment.x === position.x && segment.y === position.y) {
                        occupied = true;
                        break;
                    }
                }
            }
            if (occupied) break;

            // Check against the immediate next position of other snakes' heads
            if (players[playerId].body && players[playerId].body.length > 0) {
                 const head = players[playerId].body[0];
                 const dir = players[playerId].direction;
                 const nextPos = { x: head.x + dir.x, y: head.y + dir.y };
                 if(nextPos.x === position.x && nextPos.y === position.y){
                     occupied = true;
                     break;
                 }
            }

        }

        // Check against food
        if (!occupied) {
            for (const f of food) {
                if (f.x === position.x && f.y === position.y) {
                    occupied = true;
                    break;
                }
            }
        }
        
        isSafe = !occupied;
        attempts++;
    }
    
    if (attempts >= GRID_SIZE * GRID_SIZE) {
        // Fallback if no safe spot is found after many tries (very rare)
        return { x: 0, y: 0 };
    }

    return position;
}


function addFood() {
    // Ensure food count matches player count
    while (food.length < Object.keys(players).length) {
        food.push(getSafeRandomPosition());
    }
     while (food.length > Object.keys(players).length && food.length > 0) {
        food.pop();
    }
}


function gameLoop() {
    // Move snakes
    for (const playerId in players) {
        const player = players[playerId];
        // Also check if the player is paused
        if (!player.isAlive || player.isPaused || player.spawnProtection > 0) {
             if(player.spawnProtection > 0) player.spawnProtection--;
             continue;
        };

        const head = { ...player.body[0] };
        head.x += player.direction.x;
        head.y += player.direction.y;
        
        // Wall pass-through logic
        if (head.x < 0) head.x = GRID_SIZE - 1;
        if (head.x >= GRID_SIZE) head.x = 0;
        if (head.y < 0) head.y = GRID_SIZE - 1;
        if (head.y >= GRID_SIZE) head.y = 0;

        player.body.unshift(head);

        // Check for food collision
        let ateFood = false;
        food = food.filter(f => {
            if (f.x === head.x && f.y === head.y) {
                ateFood = true;
                player.score++;
                return false; // Remove food
            }
            return true;
        });

        if (ateFood) {
            addFood();
        } else {
            player.body.pop();
        }
    }

    // Check for collisions
    const playerIds = Object.keys(players);
    for (const playerId of playerIds) {
        const player = players[playerId];
        if (!player.isAlive || player.isPaused) continue; // Ignore paused players in collision checks

        const head = player.body[0];

        // Self-collision
        for (let i = 1; i < player.body.length; i++) {
            if (head.x === player.body[i].x && head.y === player.body[i].y) {
                player.isAlive = false;
                break;
            }
        }
        if (!player.isAlive) continue;

        // Other player collision
        for (const otherPlayerId of playerIds) {
            if (playerId === otherPlayerId) continue;
            const otherPlayer = players[otherPlayerId];
            // Don't collide with dead or paused players
            if (!otherPlayer.isAlive || otherPlayer.isPaused) continue;

            for (let i = 0; i < otherPlayer.body.length; i++) {
                if (head.x === otherPlayer.body[i].x && head.y === otherPlayer.body[i].y) {
                    player.isAlive = false;
                    break;
                }
            }
            if (!player.isAlive) break;
        }
    }

    // Emit the new game state to all clients
    io.emit('gameState', { players, food });
}


// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Create a new player
    players[socket.id] = {
        name: generateRandomName(),
        body: [],
        direction: { x: 0, y: 0 },
        score: 0,
        isAlive: false,
        isPaused: false, // Add pause state
        spawnProtection: 0
    };
    
    addFood(); // Adjust food count for the new player

    // Send the new player their ID and name
    socket.emit('init', { id: socket.id, name: players[socket.id].name });
    
    // Start game loop if it's the first player
    if (Object.keys(players).length === 1 && !gameInterval) {
        gameInterval = setInterval(gameLoop, TICK_RATE);
    }
    
    // Listen for player actions
    socket.on('startGame', () => {
        if (players[socket.id] && !players[socket.id].isAlive) {
            players[socket.id].body = [getSafeRandomPosition()];
            players[socket.id].direction = { x: 0, y: 0 };
            players[socket.id].isAlive = true;
            players[socket.id].score = 0;
            players[socket.id].isPaused = false;
            players[socket.id].spawnProtection = 1; // 1 tick of spawn protection
        }
    });
    
    socket.on('directionChange', (newDirection) => {
        const player = players[socket.id];
        if (player && player.isAlive && !player.isPaused) { // Player cannot change direction while paused
             // Prevent the snake from reversing on itself
            if (player.body.length > 1) {
                if (newDirection.x !== 0 && player.direction.x === -newDirection.x) return;
                if (newDirection.y !== 0 && player.direction.y === -newDirection.y) return;
            }
            player.direction = newDirection;
        }
    });

    socket.on('toggle-pause', () => {
        const player = players[socket.id];
        if (player && player.isAlive) {
            player.isPaused = !player.isPaused;
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('A user disconnected:', socket.id);
        delete players[socket.id];
        addFood(); // Adjust food count after a player leaves
        
        // Stop game loop if no players are left
        if (Object.keys(players).length === 0) {
            clearInterval(gameInterval);
            gameInterval = null;
            food = [];
        }
    });
});


server.listen(PORT, () => {
    console.log(`Snake server running on http://localhost:${PORT}`);
});

