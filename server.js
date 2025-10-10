const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = new socketIo.Server(server);

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS_PER_ROOM = 4;

app.set('trust proxy', true);
app.use(express.static('public'));

// --- Database Setup ---
const db = new sqlite3.Database('./stats.db', (err) => {
    if (err) console.error('Database connection error:', err.message);
    else console.log('Connected to the stats.db SQLite database.');
});
db.run('CREATE TABLE IF NOT EXISTS players (ip TEXT PRIMARY KEY, first_seen TEXT, last_seen TEXT, visit_count INTEGER)');

function broadcastStats() {
    db.all('SELECT * FROM players ORDER BY last_seen DESC', [], (err, rows) => {
        if (!err) io.to('admins').emit('statsUpdated', rows);
    });
}

// --- Game State Management ---
const GRID_SIZE = 30;
const TICK_RATE = 120;
let rooms = {}; // Object to hold all game rooms

// --- Player Name Generation ---
const ADJECTIVES = ["Agile", "Brave", "Clever", "Daring", "Eager", "Fast", "Glowing", "Happy", "Iron", "Jolly", "Keen", "Lucky"];
const ANIMALS = ["Ape", "Bear", "Cat", "Dog", "Eagle", "Fox", "Goat", "Hawk", "Impala", "Jaguar", "Koala", "Lion"];

function generateRandomName() {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
    const num = Math.floor(Math.random() * 100);
    return `${adj} ${animal} ${num}`;
}

// --- Room & Game Logic ---
function createRoom(roomId) {
    rooms[roomId] = {
        id: roomId,
        players: {},
        food: [],
        gameInterval: null
    };
    console.log(`Room created: ${roomId}`);
}

function findOrCreateRoom() {
    for (const roomId in rooms) {
        if (Object.keys(rooms[roomId].players).length < MAX_PLAYERS_PER_ROOM) {
            return roomId;
        }
    }
    const newRoomId = `room_${Date.now()}`;
    createRoom(newRoomId);
    return newRoomId;
}

function getSafeRandomPosition(room) {
    let position;
    let isSafe = false;
    let attempts = 0;
    while (!isSafe && attempts < GRID_SIZE * GRID_SIZE) {
        position = { x: Math.floor(Math.random() * GRID_SIZE), y: Math.floor(Math.random() * GRID_SIZE) };
        let occupied = false;
        for (const playerId in room.players) {
            const player = room.players[playerId];
            if (player.isAlive && !player.isPaused && player.body) {
                for (const segment of player.body) {
                    if (segment.x === position.x && segment.y === position.y) {
                        occupied = true;
                        break;
                    }
                }
            }
            if (occupied) break;
        }
        isSafe = !occupied;
        attempts++;
    }
    return position;
}

function addFood(room) {
    const playerCount = Object.keys(room.players).length;
    while (room.food.length < playerCount) {
        room.food.push(getSafeRandomPosition(room));
    }
    while (room.food.length > playerCount && room.food.length > 0) {
        room.food.pop();
    }
}

function gameLoop(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    for (const playerId in room.players) {
        const player = room.players[playerId];
        if (!player.isAlive || player.isPaused || player.spawnProtection > 0) {
            if (player.spawnProtection > 0) player.spawnProtection--;
            continue;
        }
        const head = { ...player.body[0] };
        head.x += player.direction.x;
        head.y += player.direction.y;
        if (head.x < 0) head.x = GRID_SIZE - 1;
        if (head.x >= GRID_SIZE) head.x = 0;
        if (head.y < 0) head.y = GRID_SIZE - 1;
        if (head.y >= GRID_SIZE) head.y = 0;
        player.body.unshift(head);
        let ateFood = false;
        room.food = room.food.filter(f => {
            if (f.x === head.x && f.y === head.y) {
                ateFood = true;
                player.score++;
                return false;
            }
            return true;
        });
        if (ateFood) addFood(room);
        else player.body.pop();
    }

    const playerIds = Object.keys(room.players);
    for (const playerId of playerIds) {
        const player = room.players[playerId];
        if (!player) continue; 
        if (!player.isAlive || player.isPaused) continue;
        const head = player.body[0];
        for (let i = 1; i < player.body.length; i++) {
            if (head.x === player.body[i].x && head.y === player.body[i].y) {
                player.isAlive = false;
                break;
            }
        }
        if (!player.isAlive) continue;
        for (const otherPlayerId of playerIds) {
            if (playerId === otherPlayerId) continue;
            const otherPlayer = room.players[otherPlayerId];
            if (!otherPlayer || !otherPlayer.isAlive || otherPlayer.isPaused) continue;
            for (let i = 0; i < otherPlayer.body.length; i++) {
                if (head.x === otherPlayer.body[i].x && head.y === otherPlayer.body[i].y) {
                    player.isAlive = false;
                    break;
                }
            }
            if (!player.isAlive) break;
        }
    }
    io.to(roomId).emit('gameState', { players: room.players, food: room.food });
}

io.on('connection', (socket) => {
    const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    const now = new Date().toISOString();
    db.get('SELECT * FROM players WHERE ip = ?', [ip], (err, row) => {
        if (err) return console.error("DB Error:", err.message);
        if (row) db.run('UPDATE players SET last_seen = ?, visit_count = visit_count + 1 WHERE ip = ?', [now, ip], (err) => { if (!err) broadcastStats(); });
        else db.run('INSERT INTO players (ip, first_seen, last_seen, visit_count) VALUES (?, ?, ?, 1)', [ip, now, now], (err) => { if (!err) broadcastStats(); });
    });

    const roomId = findOrCreateRoom();
    socket.join(roomId);
    socket.roomId = roomId;

    // --- FIX FOR A CRITICAL RACE CONDITION ---
    // Re-fetch the room after joining to ensure it wasn't deleted by another
    // player disconnecting at the exact same time. This prevents a server crash.
    const room = rooms[roomId];
    if (!room) {
        console.error(`Race condition detected: Room ${roomId} was not found for player ${socket.id}. Disconnecting.`);
        socket.disconnect();
        return;
    }

    room.players[socket.id] = { name: generateRandomName(), body: [], direction: { x: 0, y: 0 }, score: 0, isAlive: false, spawnProtection: 0, isPaused: false };
    
    addFood(room);
    socket.emit('init', { id: socket.id, name: room.players[socket.id].name, roomId: roomId });
    
    if (Object.keys(room.players).length === 1 && !room.gameInterval) {
        room.gameInterval = setInterval(() => gameLoop(roomId), TICK_RATE);
    }
    
    socket.on('adminAuth', (password) => {
        if (password === 'Java123@sql') {
            socket.join('admins');
            db.all('SELECT * FROM players ORDER BY last_seen DESC', [], (err, rows) => { if (!err) socket.emit('statsUpdated', rows); });
        } else socket.emit('authFailed');
    });

    socket.on('startGame', () => {
        const room = rooms[socket.roomId];
        if (!room || !room.players[socket.id]) return; 
        const player = room.players[socket.id];
        if (player && !player.isAlive) {
            player.body = [getSafeRandomPosition(room)];
            player.direction = { x: 0, y: 0 };
            player.isAlive = true;
            player.score = 0;
            player.spawnProtection = 2;
            player.isPaused = false;
        }
    });
    socket.on('directionChange', (newDirection) => {
        const room = rooms[socket.roomId];
        if (!room || !room.players[socket.id]) return;
        const player = room.players[socket.id];
        if (player && player.isAlive && !player.isPaused) {
            if (player.body.length > 1) {
                if (newDirection.x !== 0 && player.direction.x === -newDirection.x) return;
                if (newDirection.y !== 0 && player.direction.y === -newDirection.y) return;
            }
            player.direction = newDirection;
        }
    });
    socket.on('toggle-pause', () => {
        const room = rooms[socket.roomId];
        if (!room || !room.players[socket.id]) return;
        const player = room.players[socket.id];
        if (player && player.isAlive) {
            player.isPaused = !player.isPaused;
        }
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected:', socket.id);
        const roomId = socket.roomId;
        if (roomId && rooms[roomId] && rooms[roomId].players[socket.id]) {
            const room = rooms[roomId];
            delete room.players[socket.id];
            addFood(room);
            if (Object.keys(room.players).length === 0) {
                clearInterval(room.gameInterval);
                delete rooms[roomId];
                console.log(`Room closed: ${roomId}`);
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Snake server running on http://localhost:${PORT}`);
});

