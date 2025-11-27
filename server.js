const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const fsPromises = fs.promises;

const app = express();
const server = createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

// 游戏模式
const MODES = {
    simple: { w: 9, h: 9, m: 10 },
    classic: { w: 8, h: 8, m: 10 },
    medium: { w: 16, h: 16, m: 40 },
    expert: { w: 30, h: 16, m: 99 }
};


// ==================== 数据存储初始化 ====================
function ensureDbAndFiles() {
    // 确保 db 目录存在
    if (!fs.existsSync('db')) {
        fs.mkdirSync('db');
    }
    // 初始化 users.json
    const usersPath = 'db/users.json';
    // [前端注意] 数据结构变更：现在初始化为对象 {} 而不是数组 []
    if (!fs.existsSync(usersPath) || fs.readFileSync(usersPath, 'utf-8').trim() === '') {
        fs.writeFileSync(usersPath, '{}');
    }
    // 初始化 lobbies.json
    const lobbiesPath = 'db/lobbies.json';
    if (!fs.existsSync(lobbiesPath) || fs.readFileSync(lobbiesPath, 'utf-8').trim() === '') {
        fs.writeFileSync(lobbiesPath, '{}');
    }
}

// 启动时保证数据文件存在并初始化
ensureDbAndFiles();

// 辅助函数：读取和写入
async function readUsers() {
    const data = await fsPromises.readFile('db/users.json', 'utf-8');
    // [前端注意] 数据结构变更：返回对象 {}
    return JSON.parse(data || '{}');
}

async function writeUsers(users) {
    await fsPromises.writeFile('db/users.json', JSON.stringify(users, null, 2));
}

async function readLobbies() {
    const data = await fsPromises.readFile('db/lobbies.json', 'utf-8');
    return JSON.parse(data || '{}');
}

async function writeLobbies(lobbies) {
    await fsPromises.writeFile('db/lobbies.json', JSON.stringify(lobbies, null, 2));
}

// ==================== REST API ====================

app.post('/register', async (req, res) => {
    // [Refactor] 新增 name 字段用于昵称
    const { username, password, name } = req.body;
    if (!username || !password || !name) return res.json({ success: false, msg: 'Missing fields' });

    const users = await readUsers();
    
    // [前端注意] 数据结构变更：直接通过 key 查找用户
    if (users[username]) return res.json({ success: false, msg: 'User exists' });

    const hash = await bcrypt.hash(password, 10);
    
    // [前端注意] 数据结构变更：使用 username 作为 key 存储
    users[username] = {
        name: name,
        password: hash,
        stats: Object.fromEntries(Object.keys(MODES).map(mode => [mode, { games: 0, wins: 0, bestTime: Infinity }]))
    };
    
    await writeUsers(users);
    res.json({ success: true });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const users = await readUsers();
    // 直接通过 key 获取用户对象
    const user = users[username];
    if (!user || !await bcrypt.compare(password, user.password)) {
        return res.json({ success: false, msg: 'Invalid credentials' });
    }
    // 生成 Session Token
    const token = crypto.randomBytes(16).toString('hex');
    SESSIONS.set(token, username);
    // 返回昵称 name 字段
    res.json({ success: true, username, name: user.name, token });
});

app.post('/verify', (req, res) => {
    const { username, token } = req.body;
    if (SESSIONS.has(token) && SESSIONS.get(token) === username) {
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

app.get('/stats/:username', async (req, res) => {
    const users = await readUsers();
    // [前端注意] 数据结构变更：直接通过 key 获取
    const user = users[req.params.username];
    res.json(user?.stats || {});
});

// ==================== Socket.IO ====================

// 内存中的房间状态 (用于实时游戏逻辑)
// 注意：持久化的 lobbies.json 主要用于大厅列表展示，实时状态存在内存中
const rooms = new Map();
const SESSIONS = new Map(); // token -> username

// 启动时从 lobbies.json 加载房间到内存 (可选，如果需要重启后恢复房间)
// 目前逻辑是重启后房间清空，lobbies.json 仅作为持久化记录

io.on('connection', (socket) => {
    let username = null;

    socket.on('auth', (user) => { username = user; });

    socket.on('createLobby', async (requestedRoomName) => {
        if (!username) return;

        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        const roomName = requestedRoomName?.trim() || `${username}'s Room`;

        socket.join(roomId);
        
        // 1. 更新内存状态
        // [Refactor] 获取用户昵称
        const users = await readUsers();
        const nickname = users[username]?.name || username;

        const roomData = {
            roomName,
            hostId: socket.id,
            players: new Set([socket.id]),
            playerInfo: new Map([[socket.id, { username, name: nickname }]]), // Store full info
            settings: { mode: 'classic' }
        };
        rooms.set(roomId, roomData);

        // 2. 更新持久化存储 (lobbies.json)
        const lobbies = await readLobbies();
        lobbies[roomId] = {
            id: roomId,
            name: roomName,
            host: username,
            players: [username], // Keep simple list for persistence or update if needed
            settings: { mode: 'classic' },
            status: 'waiting'
        };
        await writeLobbies(lobbies);

        socket.emit('lobbyCreated', { roomId, roomName });
        io.to(roomId).emit('playersUpdate', Array.from(roomData.playerInfo.values()));
    });

    socket.on('joinLobby', async (roomId) => {
        if (!username) return;
        const upperId = roomId.toUpperCase();
        const room = rooms.get(upperId);

        if (!room || room.players.size >= 4) {
            return socket.emit('joinError', 'Room not found or full');
        }

        // [Refactor] 获取用户昵称
        const users = await readUsers();
        const nickname = users[username]?.name || username;

        // 在 socket.join(upperId) 之前，清理房间中可能已存在的相同 username（比如刷新重连的旧 socket）
        for (const [sid, info] of room.playerInfo.entries()) {
            if (info.username === username) {
                room.playerInfo.delete(sid);
                room.players.delete(sid);
                // （也可以尝试通知旧 socket）但我们只清理数据结构即可
            }
        }

        socket.join(upperId);
        room.players.add(socket.id);
        room.playerInfo.set(socket.id, { username, name: nickname });

        // 更新持久化存储（仅在不存在时加入）
        const lobbies = await readLobbies();
        if (lobbies[upperId]) {
            if (!lobbies[upperId].players.includes(username)) {
                lobbies[upperId].players.push(username);
                await writeLobbies(lobbies);
            }
        }

        io.to(upperId).emit('playersUpdate', Array.from(room.playerInfo.values()));
        socket.emit('joinedLobby', { roomId: upperId, roomName: room.roomName });
        socket.emit('modeSet', room.settings.mode);

        // [新增] 如果房间游戏已经开始，立即发送当前状态给新加入的玩家
        if (room.state && room.state.board) {
            // 发送游戏开始信号（带上当前的棋盘和揭开状态）
            socket.emit('gameStarted', {
                board: room.state.board,
                revealed: room.state.revealed,
                flagged: room.state.flagged,
                roomId: upperId,
                mode: room.settings.mode,
                startTime: room.state.startTime
            });

            // 如果游戏其实已经结束了（比如看着残局），也发送结束状态
            if (room.state.gameOver) {
                 socket.emit('gameOver', { 
                    winner: room.state.winner,
                    bomb: room.state.bombPos, 
                    board: room.state.board, // 确保传回 board
                    revealed: room.state.revealed
                });
            }
        }
    });

    socket.on('setMode', async ({ roomId, mode }) => {
        const room = rooms.get(roomId);
        if (room && room.hostId === socket.id && MODES[mode]) {
            room.settings.mode = mode;
            
            // 更新持久化存储
            const lobbies = await readLobbies();
            if (lobbies[roomId]) {
                lobbies[roomId].settings.mode = mode;
                await writeLobbies(lobbies);
            }

            io.to(roomId).emit('modeSet', mode);
        }
    });

    socket.on('startGame', (roomId) => {
        const room = rooms.get(roomId);
        if (room && room.hostId === socket.id) {
            const { w, h, m } = MODES[room.settings.mode];
            const board = generateBoard(w, h, m);
            const revealed = Array(h).fill().map(() => Array(w).fill(false));
            const flagged = Array(h).fill().map(() => Array(w).fill(0));

            room.state = {
                board,
                revealed,
                flagged,
                signals: [],
                startTime: Date.now(),
                gameOver: false
            };

            io.to(roomId).emit('gameStarted', {
                board,
                revealed,
                flagged,
                roomId,
                mode: room.settings.mode,
                startTime: room.state.startTime
            });
        }
    });

    socket.on('restartGame', (roomId) => {
        const room = rooms.get(roomId);
        // 只有房主可以重置，或者允许任何人重置(看你需求，这里暂定房主)
        // 为了方便测试，暂时允许房间内任何人触发，或者你可以加上 && room.hostId === socket.id
        if (room) {
            // 关键：重置服务器端的游戏结束状态
            room.state.gameOver = false;
            room.state.winner = null;
            
            // 重置盘面状态 (清空已翻开和旗子，但保留 board 炸弹位置不变)
            const h = room.state.board.length;
            const w = room.state.board[0].length;
            room.state.revealed = Array(h).fill().map(() => Array(w).fill(false));
            room.state.flagged = Array(h).fill().map(() => Array(w).fill(0));
            room.state.startTime = Date.now();

            // 通知所有客户端游戏已重置
            io.to(roomId).emit('gameRestarted', { 
                startTime: room.state.startTime,
                revealed: room.state.revealed,
                flagged: room.state.flagged
            });
        }
    });

    // =====================================================================================
    // [新增功能开发区] 待前端/全栈同学实现的交互逻辑
    // 目标：实现 README 中描述的实时协作、信号系统、自定义模式及胜负判定
    // =====================================================================================

    // 1. 处理点击翻开格子 (Gameplay - Reveal)
    // 前端调用: socket.emit('revealTile', { roomId, r, c })
    socket.on('revealTile', async ({ roomId, r, c }) => {
        const room = rooms.get(roomId);
        if (!room || !room.state || room.state.gameOver) return;

        const board = room.state.board;
        const revealed = room.state.revealed;
        const flagged = room.state.flagged;

        // TODO 1: 获取 room.state.board[r][c] 的值

        if (revealed[r][c] || flagged[r][c])  return;

        // TODO 2: 如果是雷 (-1):
        //    - 设置 room.state.gameOver = true
        //    - 更新统计数据 (stats) 记录失败
        //    - 广播 'gameOver' 事件: io.to(roomId).emit('gameOver', { winner: false, bomb: {r, c} })

        if (board[r][c] === -1) {
            room.state.gameOver = true;
            room.state.winner = false;
            room.state.bombPos = { r, c };
            
            // Show all mines to all the players
            for (let y = 0; y < board.length; y++) {
                for (let x = 0; x < board[0].length; x++) {
                    if (board[y][x] === -1) revealed[y][x] = true;
                }
            }

            io.to(roomId).emit('gameOver', { 
                winner: false, 
                bomb: { r, c },
                board: room.state.board,
                revealed: room.state.revealed
            });
            return;
        }

        // TODO 3: 如果是数字 (>0):
        //    - 仅更新 room.state.revealed[r][c] = true
        //    - 广播 'boardUpdate' 事件: io.to(roomId).emit('boardUpdate', { revealed: room.state.revealed })
        
        // TODO 4: 如果是空白 (0):
        //    - 执行 Flood Fill 算法，递归翻开周围所有空白及边缘数字
        //    - 更新 room.state.revealed
        //    - 广播 'boardUpdate'

        if (board[r][c] === 0) {
            const stack = [[c, r]];
            while (stack.length) {
                const [x, y] = stack.pop();
                if (x < 0 || x >= board[0].length || y < 0 || y >= board.length) continue;
                if (revealed[y][x] || flagged[y][x]) continue;

                revealed[y][x] = true;

                if (board[y][x] === 0) {
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (dx === 0 && dy === 0) continue;
                            stack.push([x + dx, y + dy]);
                        }
                    }
                }
            }
        } else {
            revealed[r][c] = true;
        }
        
        // TODO 5: 检查胜利条件 (所有非雷格子都已翻开)
        //    - 若胜利: 更新统计数据, 广播 'gameOver' { winner: true }

        let win = true;
        for (let y = 0; y < board.length; y++) {
            for (let x = 0; x < board[y].length; x++) {
                if (board[y][x] !== -1 && !revealed[y][x]) {
                    win = false;
                    break;
                }
            }
            if (!win) break;
        }

        if (win) {
            room.state.gameOver = true;
            room.state.winner = true;
            io.to(roomId).emit('gameOver', { 
                winner: true,
                time: Date.now() - room.state.startTime
            });
        }

        // Broadcast the updated revealed state
        io.to(roomId).emit('boardUpdate', {
            revealed: room.state.revealed,
            flagged: room.state.flagged
        });
    });

    // 2. 处理插旗/标记 (Gameplay - Flag)
    // 前端调用: socket.emit('toggleFlag', { roomId, r, c })
    socket.on('toggleFlag', ({ roomId, r, c, state }) => {
        const room = rooms.get(roomId);
        if (!room || !room.state || room.state.gameOver) return;

        // TODO: 切换 room.state.flagged[r][c] 的状态
        // TODO: 广播 'flagUpdate' 事件: io.to(roomId).emit('flagUpdate', { r, c, isFlagged: ... })

        room.state.flagged[r][c] = state;

        // 广播更新 (注意这里事件名改为了 flagSet，或者保持 flagUpdate 但带上具体值)
        io.to(roomId).emit('flagUpdate', {
            r, c,
            state: state // 发送具体的 0, 1, 2
        });

        // 更新剩余雷数 (只统计状态为 1 的旗子)
        const flags = room.state.flagged.flat().filter(f => f === 1).length;
        io.to(roomId).emit('minesLeftUpdate', room.state.mines - flags);
    });

    // 3. 鼠标拖拽信号系统 (Gameplay - Signals)
    // 前端调用: socket.emit('sendSignal', { roomId, type, r, c })
    // type: 'help' (左), 'onMyWay' (右), 'avoid' (上), 'question' (下)
    socket.on('sendSignal', ({ roomId, type, r, c }) => {
        // 直接广播给房间内其他人，用于显示临时特效
        socket.to(roomId).emit('signalReceived', { 
            type, r, c, 
            fromUser: socket.username 
        });
    });

    // 4. 自定义难度设置 (Lobby - Custom Mode)
    // 前端调用: socket.emit('setCustomMode', { roomId, w, h, m })
    socket.on('setCustomMode', ({ roomId, w, h, m }) => {
        const room = rooms.get(roomId);
        if (room && room.hostId === socket.id) {
            // TODO: 校验参数范围 (例如 w: 5-50, h: 5-30)
            // TODO: 更新 room.settings.mode = 'custom'
            // TODO: 更新 room.settings.customParams = { w, h, m }
            // TODO: 广播模式变更
        }
    });

    // 5. 作弊功能开关 (Cheating)
    // 前端调用: socket.emit('toggleCheat', { roomId, enable })
    socket.on('toggleCheat', ({ roomId, enable }) => {
        // TODO: 记录房间作弊状态，可能会影响最终统计 (如不计入排行榜)
    });

    // =====================================================================================
    // [新增功能开发区结束]
    // =====================================================================================

    socket.on('disconnect', async () => {
        console.log(`${username || 'Someone'} disconnected`);
        
        for (const [roomId, room] of rooms.entries()) {
            if (room.players.has(socket.id)) {
                // 1. 从内存移除
                room.players.delete(socket.id);
                room.playerInfo.delete(socket.id);

                // 更新持久化存储：安全地移除所有与该 socket 对应的 username
                const lobbies = await readLobbies();
                if (lobbies[roomId]) {
                    // 获取要删除的 username（优先从 room.playerInfo 中读取）
                    const leavingUser = room.playerInfo.get(socket.id)?.username || username;
                    if (leavingUser) {
                        lobbies[roomId].players = (lobbies[roomId].players || []).filter(u => u !== leavingUser);
                    }
                    if (room.players.size === 0) {
                        rooms.delete(roomId);
                        delete lobbies[roomId];
                        await writeLobbies(lobbies);
                        return;
                    } else {
                        await writeLobbies(lobbies);
                    }
                }

                // 3. 更新房间名单
                io.to(roomId).emit('playersUpdate', {
                    players: Array.from(room.playerInfo.values()), // 每一项形如 { username, name }
                    hostUsername: room.playerInfo.get(room.hostId)?.username || null
                });

                // 4. 房主离开处理
                if (room.hostId === socket.id) {
                    room.hostId = null; // 无法再开始游戏
                }
                break;
            }
        }
    });
});

// ==================== 工具函数 ====================

function generateBoard(width, height, numMines) {
    const board = Array.from({ length: height }, () => Array(width).fill(0));

    // 放雷
    let placed = 0;
    while (placed < numMines) {
        const r = Math.floor(Math.random() * height);
        const c = Math.floor(Math.random() * width);
        if (board[r][c] !== -1) {
            board[r][c] = -1;
            placed++;
        }
    }

    // 计算数字
    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            if (board[r][c] === -1) continue;
            let count = 0;
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (dr === 0 && dc === 0) continue;
                    const nr = r + dr, nc = c + dc;
                    if (nr >= 0 && nr < height && nc >= 0 && nc < width && board[nr][nc] === -1) count++;
                }
            }
            board[r][c] = count;
        }
    }
    return board;
}

// ==================== 启动服务器 ====================

server.listen(8000, () => {
    console.log('Multisweeper 服务器启动成功! http://localhost:8000');
});

// 优雅退出：清空房间数据
const cleanup = () => {
    console.log('\n正在关闭服务器，清理房间数据...');
    try {
        fs.writeFileSync('db/lobbies.json', '{}');
        console.log('Lobbies 已清空。');
    } catch (e) {
        console.error('清理失败:', e);
    }
    process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);