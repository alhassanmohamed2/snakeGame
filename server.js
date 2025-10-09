const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = new socketIo.Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json()); // Middleware to parse JSON bodies

// --- Database Setup ---
const db = new sqlite3.Database('./stats.db', (err) => {
    if (err) {
        console.error('Database connection error:', err.message);
    }
    console.log('Connected to the stats.db SQLite database.');
});

// Create table for player stats if it doesn't exist
db.run('CREATE TABLE IF NOT EXISTS players (ip TEXT PRIMARY KEY, first_seen TEXT, last_seen TEXT, visit_count INTEGER)', (err) => {
    if (err) {
        console.error("Error creating players table:", err);
    }
});


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
        for (const playerId in players) {
            const player = players[playerId];
            if (!player.isAlive || player.isPaused) continue;
            if (player.body) {
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

function addFood() {
    while (food.length < Object.keys(players).length) {
        food.push(getSafeRandomPosition());
    }
    while (food.length > Object.keys(players).length && food.length > 0) {
        food.pop();
    }
}

function gameLoop() {
    for (const playerId in players) {
        const player = players[playerId];
        if (!player.isAlive || player.isPaused || player.spawnProtection > 0) {
            if(player.spawnProtection > 0) player.spawnProtection--;
            continue;
        };
        const head = { ...player.body[0] };
        head.x += player.direction.x;
        head.y += player.direction.y;
        if (head.x < 0) head.x = GRID_SIZE - 1;
        if (head.x >= GRID_SIZE) head.x = 0;
        if (head.y < 0) head.y = GRID_SIZE - 1;
        if (head.y >= GRID_SIZE) head.y = 0;
        player.body.unshift(head);
        let ateFood = false;
        food = food.filter(f => {
            if (f.x === head.x && f.y === head.y) {
                ateFood = true;
                player.score++;
                return false;
            }
            return true;
        });
        if (ateFood) {
            addFood();
        } else {
            player.body.pop();
        }
    }
    const playerIds = Object.keys(players);
    for (const playerId of playerIds) {
        const player = players[playerId];
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
            const otherPlayer = players[otherPlayerId];
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
    io.emit('gameState', { players, food });
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    const ip = socket.handshake.address;
    const now = new Date().toISOString();
    db.get('SELECT * FROM players WHERE ip = ?', [ip], (err, row) => {
        if (err) return console.error("DB Error:", err.message);
        if (row) {
            db.run('UPDATE players SET last_seen = ?, visit_count = visit_count + 1 WHERE ip = ?', [now, ip]);
        } else {
            db.run('INSERT INTO players (ip, first_seen, last_seen, visit_count) VALUES (?, ?, ?, 1)', [ip, now, now]);
        }
    });
    players[socket.id] = { name: generateRandomName(), body: [], direction: { x: 0, y: 0 }, score: 0, isAlive: false, spawnProtection: 0, isPaused: false };
    addFood();
    socket.emit('init', { id: socket.id, name: players[socket.id].name });
    if (Object.keys(players).length === 1 && !gameInterval) {
        gameInterval = setInterval(gameLoop, TICK_RATE);
    }
    socket.on('startGame', () => {
        if (players[socket.id] && !players[socket.id].isAlive) {
            players[socket.id].body = [getSafeRandomPosition()];
            players[socket.id].direction = { x: 0, y: 0 };
            players[socket.id].isAlive = true;
            players[socket.id].score = 0;
            players[socket.id].spawnProtection = 2;
            players[socket.id].isPaused = false;
        }
    });
    socket.on('directionChange', (newDirection) => {
        const player = players[socket.id];
        if (player && player.isAlive && !player.isPaused) {
            if (player.body.length > 1) {
                if (newDirection.x !== 0 && player.direction.x === -newDirection.x) return;
                if (newDirection.y !== 0 && player.direction.y === -newDirection.y) return;
            }
            player.direction = newDirection;
        }
    });
    socket.on('toggle-pause', () => {
        if (players[socket.id] && players[socket.id].isAlive) {
            players[socket.id].isPaused = !players[socket.id].isPaused;
        }
    });
    socket.on('disconnect', () => {
        console.log('A user disconnected:', socket.id);
        delete players[socket.id];
        addFood();
        if (Object.keys(players).length === 0) {
            clearInterval(gameInterval);
            gameInterval = null;
            food = [];
        }
    });
});

// --- Admin Routes ---
app.get('/admin', (req, res) => {
    res.sendFile(__dirname + '/public/admin.html');
});

app.post('/admin-data', (req, res) => {
    const { password } = req.body;
    if (password === 'Java123@sql') {
        db.all('SELECT * FROM players ORDER BY last_seen DESC', [], (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json(rows);
        });
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
});

server.listen(PORT, () => {
    console.log(`Snake server running on http://localhost:${PORT}`);
});

