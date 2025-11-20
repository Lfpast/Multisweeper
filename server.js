// server.js - Complete Backend for Multisweeper

const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { JSONFilePreset } = require('lowdb/node');
const bcrypt = require('bcryptjs');
const path = require('path');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const wss = new WebSocket.Server({ port: 8080 });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Game Modes (including custom handling)
const MODES = {
    classic: { width: 8, height: 8, mines: 10 },
    simple:  { width: 9, height: 9, mines: 10 },
    medium:  { width: 16, height: 16, mines: 40 },
    expert:  { width: 30, height: 16, mines: 99 }, // Note: 30x16 as per doc
    custom:  {} // Will be set dynamically
};

// LowDB Initialization
let db;
async function initDB() {
    db = await JSONFilePreset('db.json', {
        users: [], // Array of { username, password (hash), stats: { mode: { games: 0, wins: 0, timeSpent: 0, bestTime: Infinity, winStreak: 0, longestStreak: 0 } } }
        rankings: {} // { mode: [{ username, bestTime }] sorted by bestTime asc, top 10 }
    });

    // Initialize rankings if not present
    Object.keys(MODES).forEach(mode => {
        if (!db.data.rankings[mode]) db.data.rankings[mode] = [];
    });

    await db.write();
}


initDB();

// Authentication Routes
app.post('/register', async (req, res) => {
    const { username, password } = req.body;

    if (db.data.users.find(u => u.username === username)) {
        return res.status(400).json({ success: false, msg: 'Username already exists' });
    }

    const hash = await bcrypt.hash(password, 10);
    const newUser = {
        username,
        password: hash,
        stats: Object.fromEntries(Object.keys(MODES).map(mode => [mode, {
            games: 0,
            wins: 0,
            timeSpent: 0,
            bestTime: Infinity,
            winStreak: 0,
            longestStreak: 0
        }]))
    };

    db.data.users.push(newUser);
    await db.write();
    res.json({ success: true });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = db.data.users.find(u => u.username === username);

    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ success: false, msg: 'Invalid credentials' });
    }

    res.json({ success: true, username });
});

// Stats and Rankings Endpoints
app.get('/stats/:username', (req, res) => {
    const user = db.data.users.find(u => u.username === req.params.username);

    if (!user) {
        return res.status(404).json({ msg: 'User not found' });
    }

    res.json(user.stats);
});

app.get('/rankings/:mode', (req, res) => {
    const mode = req.params.mode;
    if (!db.data.rankings[mode]) {
        return res.status(404).json({ msg: 'Mode not found' });
    }

    res.json(db.data.rankings[mode]);
});

// Rooms Management (lobbies and games)
const rooms = new Map(); // roomId -> { hostId, players: Set<socket.id>, usernameMap: Map<socket.id, username>, settings: { mode, width?, height?, mines? }, state?: { board, revealed, flagged, signals: [], startTime, endTime?, gameOver: false, result?: 'win'|'lose', cheats: Map<socket.id, level> } }

io.on('connection', (socket) => {
    let username = null;

    socket.on('auth', (user) => {
        username = user;
    });

    // Create Lobby
    socket.on('createLobby', () => {
        if (!username) return socket.emit('error', 'Authenticate first');
        const roomId = Math.random().toString(36).substring(2, 8);

        rooms.set(roomId, {
            hostId: socket.id,
            players: new Set([socket.id]),
            usernameMap: new Map([[socket.id, username]]),
            settings: { mode: 'classic' }
        });

        socket.join(roomId);
        socket.emit('lobbyCreated', roomId);
        io.to(roomId).emit('playersUpdate', Array.from(rooms.get(roomId).usernameMap.values()));
    });

    // Join Lobby
    socket.on('joinLobby', (roomId) => {
        if (!username) {
            return socket.emit('error', 'Authenticate first');
        }

        const room = rooms.get(roomId);

        if (!room) {
            return socket.emit('joinError', 'Room not found');
        }

        if (room.players.size >= 4) {
            return socket.emit('joinError', 'Room full');  // Max 4 players
        }

        if (room.state && room.state.startTime) {
            return socket.emit('joinError', 'Game already started');
        }

        socket.join(roomId);
        room.players.add(socket.id);
        room.usernameMap.set(socket.id, username);
        io.to(roomId).emit('playersUpdate', Array.from(room.usernameMap.values()));
    });

    // Set Game Mode (host only)
    socket.on('setMode', ({ roomId, mode, width, height, mines }) => {
        const room = rooms.get(roomId);
        if (!room || room.hostId !== socket.id) {
            return;
        }

        room.settings.mode = mode;
        if (mode === 'custom') {
            room.settings.width = width;
            room.settings.height = height;
            room.settings.mines = mines;
        }

        io.to(roomId).emit('modeSet', room.settings);
    });

    // Start Game (host only)
    socket.on('startGame', (roomId) => {
        const room = rooms.get(roomId);
        if (!room || room.hostId !== socket.id) {
            return;
        }

        if (room.state) {
            return; // Already started
        } 

        let { width, height, mines } = MODES[room.settings.mode] || {};
        if (room.settings.mode === 'custom') {
            ({ width, height, mines } = room.settings);
        }

        if (mines > width * height / 2) {
            mines = Math.floor(width * height / 2); // Safety: max 50% mines
        } 

        const board = generateBoard(width, height, mines);
        const revealed = Array(height).fill().map(() => Array(width).fill(false));
        const flagged = Array(height).fill().map(() => Array(width).fill(false));
        room.state = {
            board,
            revealed,
            flagged,
            signals: [],
            startTime: Date.now(),
            gameOver: false,
            cheats: new Map() // socket.id -> cheatLevel (0-3)
        };

        io.to(roomId).emit('gameStarted', { settings: room.settings, state: room.state });

        // Start timer broadcast
        room.timerInterval = setInterval(() => {
            if (room.state.gameOver) clearInterval(room.timerInterval);
            io.to(roomId).emit('tick', Date.now() - room.state.startTime);
        }, 1000);
    });

    // Reveal Tile
    socket.on('reveal', ({ roomId, x, y }) => {
        const room = rooms.get(roomId);
        if (!room || !room.state || room.state.gameOver || !room.players.has(socket.id)) {
            return;
        }

        const { board, revealed, flagged, cheats } = room.state;
        if (revealed[y][x] || flagged[y][x]) {
            return;
        }

        const cheatLevel = cheats.get(socket.id) || 0;

        if (board[y][x] === -1) { 
            // Mine hit
            if (cheatLevel >= 1 && (cheats.get(socket.id + '_trials') || 0) < 3) { 
                // Trial-and-error (level 1+)
                cheats.set(socket.id + '_trials', (cheats.get(socket.id + '_trials') || 0) + 1);
                io.to(roomId).emit('safeReveal', { x, y, isMine: true }); // Client handles animation, no game over
                flagged[y][x] = true; // Auto-flag
                io.to(roomId).emit('stateUpdate', { revealed, flagged, signals: room.state.signals });
                return;
            }

            // Game over
            room.state.gameOver = true;
            room.state.result = 'lose';
            room.state.endTime = Date.now();
            clearInterval(room.timerInterval);
            updateStats(room, false);
            io.to(roomId).emit('gameOver', { result: 'lose', state: room.state });
            return;
        }

        // Normal reveal
        floodReveal(board, revealed, y, x);
        const totalSafe = board.length * board[0].length - countMines(board);
        if (countRevealed(revealed) === totalSafe) {
            room.state.gameOver = true;
            room.state.result = 'win';
            room.state.endTime = Date.now();
            clearInterval(room.timerInterval);
            updateStats(room, true);
            io.to(roomId).emit('gameOver', { result: 'win', state: room.state });
        }

        io.to(roomId).emit('stateUpdate', { revealed, flagged, signals: room.state.signals });
    });

    // Flag Tile
    socket.on('flag', ({ roomId, x, y }) => {
        const room = rooms.get(roomId);
        if (!room || !room.state || room.state.gameOver || !room.players.has(socket.id)) {
            return;
        }

        const { revealed, flagged } = room.state;
        if (revealed[y][x]) {
            return;
        }

        flagged[y][x] = !flagged[y][x];
        io.to(roomId).emit('stateUpdate', { revealed, flagged, signals: room.state.signals });
    });

    // Send Signal
    socket.on('signal', ({ roomId, x, y, type }) => {
        const room = rooms.get(roomId);
        if (!room || !room.state || room.state.gameOver || !room.players.has(socket.id)) {
            return;
        }

        const signal = { x, y, type, sender: username, timestamp: Date.now() };
        room.state.signals.push(signal);

        // Auto-remove after 10s
        setTimeout(() => {
            room.state.signals = room.state.signals.filter(s => s !== signal);
            io.to(roomId).emit('stateUpdate', { revealed: room.state.revealed, flagged: room.state.flagged, signals: room.state.signals });
        }, 10000);

        io.to(roomId).emit('stateUpdate', { revealed: room.state.revealed, flagged: room.state.flagged, signals: room.state.signals });
    });

    // Cheat Toggle (client requests level, server tracks per player)
    socket.on('cheat', ({ roomId, level }) => { 
        // level 0-3
        const room = rooms.get(roomId);
        if (!room || !room.state || room.state.gameOver || !room.players.has(socket.id)) {
            return;
        }

        room.state.cheats.set(socket.id, level);
        if (level === 3) { 
            // Full mine marking: send all mine positions to this player only
            const mines = [];
            room.state.board.forEach((row, ry) => {
                row.forEach((cell, cx) => {
                    if (cell === -1) {
                        mines.push({ x: cx, y: ry });
                    }
                });
            });

            socket.emit('fullMines', mines); // Client auto-flags
        }

        // For level 2 (vision), client handles peek, no server need
    });

    // Restart Game (host only, or any after over)
    socket.on('restart', (roomId) => {
        const room = rooms.get(roomId);
        if (!room || !room.state.gameOver) {
            return;
        }

        if (room.hostId !== socket.id) {
            // Only host
            return;
        } 

        // Reset state
        delete room.state;
        io.to(roomId).emit('gameRestarted');
        // Host can start again
    });

    // Disconnect Handling
    socket.on('disconnect', () => {
        for (const [roomId, room] of rooms.entries()) {
            if (room.players.has(socket.id)) {
                room.players.delete(socket.id);
                room.usernameMap.delete(socket.id);
                io.to(roomId).emit('playersUpdate', Array.from(room.usernameMap.values()));

                if (room.players.size === 0) {
                    rooms.delete(roomId);
                } 
                else if (room.hostId === socket.id) {
                    // Transfer host to first player
                    room.hostId = Array.from(room.players)[0];
                    io.to(roomId).emit('newHost', room.usernameMap.get(room.hostId));
                }

                break;
            }
        }
    });
});

// WebSocket Server for simplified multiplayer (alternative to Socket.IO)
wss.on('connection', function connection(ws) {
    ws.on('message', function incoming(message) {
        let msg;
        try { msg = JSON.parse(message); } catch { return; }

        // Join Room
        if (msg.type === 'join') {
            const { roomId, rows, cols, mines } = msg;
            if (!rooms[roomId]) {
                rooms[roomId] = {
                    board: createBoard(rows, cols, mines),
                    players: new Set()
                };
            }
            rooms[roomId].players.add(ws);
            ws.roomId = roomId;
            ws.send(JSON.stringify({ type: 'board', board: rooms[roomId].board }));
        }

        // Player Action (e.g., reveal tile)
        if (msg.type === 'action') {
            const room = rooms[ws.roomId];
            if (!room) return;
            // Update room.board based on msg.action
            // Broadcast updated board state
            room.players.forEach(player => {
                player.send(JSON.stringify({ type: 'board', board: room.board }));
            });
        }
    });

    ws.on('close', function () {
        const roomId = ws.roomId;
        if (roomId && rooms[roomId]) {
            rooms[roomId].players.delete(ws);
            if (rooms[roomId].players.size === 0) {
                delete rooms[roomId]; // Delete room if empty
            }
        }
    });
});

// Game Helper Functions
function generateBoard(width, height, numMines) {
    const board = Array(height).fill().map(() => Array(width).fill(0));
    let placed = 0;
    while (placed < numMines) {
        const r = Math.floor(Math.random() * height);
        const c = Math.floor(Math.random() * width);
        if (board[r][c] === 0) {
            board[r][c] = -1;
            placed++;
        }
    }

    // Calculate numbers
    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            if (board[r][c] === -1) {
                continue;
            }

            let count = 0;
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (dr === 0 && dc === 0) {
                        continue;
                    }

                    const nr = r + dr, nc = c + dc;

                    if (nr >= 0 && nr < height && nc >= 0 && nc < width && board[nr][nc] === -1) {
                        count++;
                    }
                }
            }

            board[r][c] = count;
        }
    }

    return board;
}

function floodReveal(board, revealed, row, col) {
    const height = board.length;
    const width = board[0].length;
    if (row < 0 || row >= height || col < 0 || col >= width || revealed[row][col]) {
        return;
    }

    revealed[row][col] = true;
    if (board[row][col] !== 0) {
        // Stop at number
        return; 
    }

    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) {
                continue;
            }

            floodReveal(board, revealed, row + dr, col + dc);
        }
    }
}

function countMines(board) {
    return board.flat().filter(cell => cell === -1).length;
}

function countRevealed(revealed) {
    return revealed.flat().filter(bool => bool).length;
}

async function updateStats(room, isWin) {
    const mode = room.settings.mode;
    const time = room.state.endTime - room.state.startTime;
    for (const [sid, uname] of room.usernameMap) {
        const user = db.data.users.find(u => u.username === uname);
        if (!user) {
            continue;
        }

        const stats = user.stats[mode];
        stats.games++;
        stats.timeSpent += time;
        if (isWin) {
            stats.wins++;
            stats.bestTime = Math.min(stats.bestTime, time);
            stats.winStreak++;
            stats.longestStreak = Math.max(stats.longestStreak, stats.winStreak);
            // Update rankings
            const ranking = db.data.rankings[mode];
            const existing = ranking.find(r => r.username === uname);
            if (existing) {
                if (time < existing.bestTime) {
                    existing.bestTime = time;
                }
            } 
            else {
                ranking.push({ username: uname, bestTime: time });
            }

            // Sort and keep top 10
            ranking.sort((a, b) => a.bestTime - b.bestTime);
            db.data.rankings[mode] = ranking.slice(0, 10);
        } 
        else {
            stats.winStreak = 0;
        }
    }
    
    await db.write();
}

// Start Server
const PORT = 8000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
