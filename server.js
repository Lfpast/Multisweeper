const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { JSONFilePreset } = require('lowdb/node');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));
app.use(express.json());

// Modes
const MODES = {
    simple: { w: 9, h: 9, m: 10 },
    classic: { w: 8, h: 8, m: 10 },
    medium: { w: 16, h: 16, m: 40 },
    expert: { w: 16, h: 30, m: 99 }
};

// LowDB
let db;
async function initDB() {
    db = await JSONFilePreset('db.json', {
        users: [], // {username, password: hash, stats: {simple:{games:0,wins:0,bestTime:Infinity},...}, rankings: {simple:[] } }
        rankings: {} // {mode: [{username,time},...]}
    });
};

initDB();

// Routes: Register/Login
app.post('/register', async (req, res) => {
    const { username, password } = req.body;

    if (db.data.users.find(u => u.username === username))  {
        return res.json({ success: false, msg: 'User exists' });
    }

    const hash = await bcrypt.hash(password, 10);
    db.data.users.push({ username, password: hash, stats: Object.fromEntries(Object.keys(MODES).map(mode => [mode, {games:0, wins:0, bestTime: Infinity}])) });
    await db.write();
    res.json({ success: true });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = db.data.users.find(u => u.username === username);

    if (!user || !await bcrypt.compare(password, user.password)) {
        return res.json({ success: false, msg: 'Invalid' });
    } 

    res.json({ success: true, username });
});

app.get('/stats/:username', (req, res) => {
    const user = db.data.users.find(u => u.username === req.params.username);
    res.json(user ? user.stats : {});
});

app.get('/rankings/:mode', (req, res) => {
    res.json(db.data.rankings[req.params.mode] || []);
});

// Game rooms
const rooms = new Map(); // roomId -> {hostId, players: Set[socket.id], usernameMap: Map[socket.id, username], settings: {mode}, state: {board:2d, revealed:2d false, flagged:2d false, signals:[], startTime, gameOver:false, result:'win'|'lose'} }

io.on('connection', (socket) => {
    let username = null;

    socket.on('auth', (user) => { username = user; }); // Client sends after login

    socket.on('createLobby', () => {
        const roomId = Math.random().toString(36).substring(2, 8);
        socket.join(roomId);
        rooms.set(roomId, { hostId: socket.id, players: new Set([socket.id]), usernameMap: new Map([[socket.id, username]]), settings: { mode: 'classic' } });
        socket.emit('lobbyCreated', roomId);
    });

    socket.on('joinLobby', (roomId) => {
        const room = rooms.get(roomId);

        if (room && room.players.size < 4) { // Max 4 players
            socket.join(roomId);
            room.players.add(socket.id);
            room.usernameMap.set(socket.id, username);
            io.to(roomId).emit('playersUpdate', Array.from(room.players).map(id => room.usernameMap.get(id)));
        } 
        else {
            socket.emit('joinError', 'Room full/not found');
        }
    });

    socket.on('setMode', ({ roomId, mode }) => {
        const room = rooms.get(roomId);

        if (room && room.hostId === socket.id) {
            room.settings.mode = mode;
            io.to(roomId).emit('modeSet', mode);
        }
    });

    socket.on('startGame', (roomId) => {
        const room = rooms.get(roomId);

        if (room && room.hostId === socket.id) {
            const { w, h, m } = MODES[room.settings.mode];
            const board = generateBoard(w, h, m); // See below
            const revealed = Array(h).fill().map(() => Array(w).fill(false));
            const flagged = Array(h).fill().map(() => Array(w).fill(false));
            room.state = { board, revealed, flagged, signals: [], startTime: Date.now(), gameOver: false };
            io.to(roomId).emit('gameStarted', room.state);
            // Timer: setInterval(() => io.to(roomId).emit('tick', Date.now() - room.state.startTime), 1000);
        }
    });

    socket.on('reveal', ({ roomId, x, y }) => {
        const room = rooms.get(roomId);

        if (!room || room.state.gameOver) {
            return;
        }

        const { board, revealed, flagged } = room.state;

        if (revealed[y][x] || flagged[y][x]) {
            return;
        }   

        if (board[y][x] === -1) { 
            // Mine
            room.state.gameOver = true;
            room.state.result = 'lose';
            io.to(roomId).emit('gameOver', 'lose');
            return;
        }

        floodReveal(board, revealed, y, x); // See below
        if (checkWin(board, revealed, board[0].length * board.length - countMines(board))) {
            room.state.gameOver = true;
            room.state.result = 'win';
            updateStats(room, room.settings.mode); // Update wins/best
            io.to(roomId).emit('gameOver', 'win');
        }

        io.to(roomId).emit('stateUpdate', { revealed, flagged, signals: room.state.signals });
    });

    socket.on('flag', ({ roomId, x, y }) => {
        // Toggle flagged[y][x], emit stateUpdate
    });

    socket.on('signal', ({ roomId, x, y, type }) => {
        // Add {x,y,type, timeout:5000} to signals, emit
    });

    socket.on('disconnect', () => {
        // Cleanup rooms if empty/host leaves
    });
});

function generateBoard(width, height, numMines) {
    let board = Array(height).fill().map(() => Array(width).fill(0));
    // Place mines (-1)
    let placed = 0;

    while (placed < numMines) {
        let row = Math.floor(Math.random() * height);
        let col = Math.floor(Math.random() * width);

        if (board[row][col] !== -1) {
            board[row][col] = -1;
            placed++;
        }
    }

    // Numbers
    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            if (board[r][c] === -1) {
                continue;
            }

            let count = 0;
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    let nr = r + dr, nc = c + dc;
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

// Flood reveal (recursive, safe for small boards)
function floodReveal(board, revealed, row, col) {
    if (row < 0 || row >= board.length || col < 0 || col >= board[0].length || revealed[row][col]) {
        return;
    }

    revealed[row][col] = true;
    if (board[row][col] !== 0) {
        return;
    } 
    
    // Border number
    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            floodReveal(board, revealed, row + dr, col + dc);
        }
    }
}


function checkWin(board, revealed, totalSafe) {
    let revealedSafe = 0;
    for (let r = 0; r < board.length; r++) {
        for (let c = 0; c < board[0].length; c++) {
            if (revealed[r][c] && board[r][c] !== -1) {
                revealedSafe++;
            }
        }
    }

    return revealedSafe === totalSafe;
}

function countMines(board) {
    let count = 0;
    board.flat().forEach(cell => { if (cell === -1) count++; });
    return count;
}

server.listen(8000, () => console.log('http://localhost:8000'));

