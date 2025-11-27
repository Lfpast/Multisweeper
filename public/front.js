// front.js - Final, clean, English-only, zero null-safe version

const $ = (id) => document.getElementById(id);

let socket = null;
let username = null;
let nickname = null;
let currentRoom = null;
let isHost = false;

let currentRoomHost = null; // [新增] 记录当前房主的 username

const MODES = {
  simple:  { w: 9,  h: 9,  m: 10 },
  classic: { w: 8,  h: 8,  m: 10 },
  medium:  { w: 16, h: 16, m: 40 },
  expert:  { w: 30, h: 16, m: 99 }
};

let gameState = {
  board: null,
  revealed: null,
  flagged: null,
  width: 0,
  height: 0,
  mines: 0,
  mode: 'classic',
  startTime: null,
  timerInterval: null,
  tileSize: 32,
  cheatLevel: 0
};

document.addEventListener('DOMContentLoaded', () => {
  // --- Check login session ------------------------------------------------
  const storedUser = localStorage.getItem('username');
  const storedToken = localStorage.getItem('token');
  const storedNick  = localStorage.getItem('nickname');

  if (storedUser && storedToken) {
    fetch('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: storedUser, token: storedToken })
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        username = storedUser;
        nickname = storedNick || storedUser;
        initMainPage();
      } else {
        showLoginModal();
      }
    })
    .catch(() => showLoginModal());
  } else {
    showLoginModal();
  }
});


function showLoginModal() {
  localStorage.clear();
  const modal = $('loginModal');
  if (modal) modal.style.display = 'flex';

  // Safe binding – only if elements exist
  const regBtn = $('registerBtn');
  const logBtn = $('loginBtn');
  if (regBtn) regBtn.onclick = handleRegister;
  if (logBtn) logBtn.onclick = handleLogin;
}

function showMessage(text, color = '#f66') {
  const el = $('loginMsg');
  if (!el) return;
  el.textContent = text;
  el.style.color = color;
  el.style.opacity = '1';
  setTimeout(() => el.style.opacity = '0', 4000);
}

async function handleRegister() {
  const u = $('username')?.value.trim();
  const n = $('nickname')?.value.trim() || u;
  const p = $('password')?.value;
  if (!u || !n || !p) return showMessage('Username/Nickname/Password are required');

  const res = await fetch('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p, name: n })
  });
  const data = await res.json();
  showMessage(data.success ? 'Registered! Please log in' : data.msg || 'Failed',
              data.success ? '#6f6' : '#f66');
}

async function handleLogin() {
  const u = $('username')?.value.trim();
  const n = $('nickname')?.value.trim() || u;
  const p = $('password')?.value;
  if (!u || !n || !p) return showMessage('Username/Nickname/Password are required');

  const res = await fetch('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p })
  });
  const data = await res.json();

  if (data.success) {
    username = u;
    nickname = data.name || u;
    localStorage.setItem('username', u);
    localStorage.setItem('token', data.token);
    localStorage.setItem('nickname', nickname);
    initMainPage();
  } else {
    showMessage(data.msg || 'Login failed');
  }
}

// [新增] 加载统计数据的函数
function loadStats() {
    if (!username) return;
    fetch(`/stats/${username}`) // 注意：这里使用了 URL 参数风格，请确认 server.js 是 /stats/:username 还是 POST /stats
        .then(r => r.json())
        .then(data => {
            $('statGamesPlayed').textContent = data.games || 0; // 注意 server 返回字段可能是 games 不是 gamesPlayed
            $('statGamesWon').textContent    = data.wins || 0;
            
            // 计算胜率
            const games = data.games || 0;
            const wins = data.wins || 0;
            const rate = games > 0 ? Math.round((wins / games) * 100) : 0;
            $('statWinRate').textContent = rate + '%';
            
            // 最佳时间
            const best = data.bestTime;
            $('statBestTime').textContent = (best === null || best === Infinity) ? '--:--' : (best/1000).toFixed(1) + 's';
            
            // 总时间 (假设后端没存 totalTime，这里暂时显示 0 或移除)
            $('statTotalTime').textContent = '--'; 
        })
        .catch(console.error);
}

function initMainPage() {
  $('loginModal').style.display = 'none';
  $('mainPage').style.display = 'block';
  $('welcomeUser').textContent = nickname;

  loadTheme();
  loadStats(); // [新增] 加载统计数据
  connectSocket();

  // All buttons in the lobby
  $('logoutBtn').onclick = () => { localStorage.clear(); location.reload(); };

  $('createLobbyBtn').onclick = () => {
    const inputName = $('roomNameInput').value.trim();
    // 如果输入为空，主动使用 Nickname 生成房间名
    const finalName = inputName || `${nickname}'s Room`;
    socket.emit('createLobby', finalName);
  };

  
$('joinLobbyBtn').onclick = () => {
  const roomId = $('roomInput').value.trim();
  if (!roomId) return alert('Enter Room ID');
  // 修改处：事件名改为 joinLobby，且只传 ID（根据 server.js 的定义）
  socket.emit('joinLobby', roomId); 
};

  $('copyRoomBtn').onclick = () => {
    if (currentRoom) {
      navigator.clipboard.writeText(currentRoom);
      alert('Copied: ' + currentRoom);
    }
  };

  // [新增] 游戏界面内的复制按钮逻辑
  const copyGameBtn = $('copyGameRoomBtn');
  if (copyGameBtn) {
    copyGameBtn.onclick = () => {
      if (currentRoom) {
        navigator.clipboard.writeText(currentRoom);
        // 可以加个简单的提示，或者只是 alert
        const originalText = copyGameBtn.textContent;
        copyGameBtn.textContent = "Copied!";
        setTimeout(() => copyGameBtn.textContent = originalText, 1000);
      }
    };
  }

  $('modeSelect').onchange = e => {
    if (isHost) socket.emit('setMode', { roomId: currentRoom, mode: e.target.value });
  };

  $('startGameBtn').onclick = () => {
    if (isHost) socket.emit('startGame', currentRoom);
  };

  // --- Volume slider real-time display ---
  const volumeSlider = $('volumeSlider');
  const volumeValue  = $('volumeValue');

  if (volumeSlider && volumeValue) {
    volumeValue.textContent = volumeSlider.value + '%';

    volumeSlider.addEventListener('input', () => {
      volumeValue.textContent = volumeSlider.value + '%';
      localStorage.setItem('volume', volumeSlider.value);
    });

    const saved = localStorage.getItem('volume');
    if (saved) {
      volumeSlider.value = saved;
      volumeValue.textContent = saved + '%';
    }
  }
  const themeSelect = $('themeSelect');
  if (themeSelect) {
    themeSelect.onchange = () => {
      const newTheme = themeSelect.value; 
      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('theme', newTheme);
    };
  }
  loadTheme();

  document.querySelectorAll('input[type=checkbox]').forEach(cb => {
    const key = cb.id;
    const saved = localStorage.getItem(key);
    if (saved !== null) cb.checked = saved === 'true';
    
    cb.onchange = () => {
      localStorage.setItem(key, cb.checked);
    };
  });
}

function connectSocket() {
  socket = io();
  socket.on('connect', () => socket.emit('auth', username));

  socket.on('lobbyCreated', ({ roomId, roomName }) => {
    currentRoom = roomId;
    isHost = true;
    currentRoom
    $('hostControls').style.display = 'block';
    $('roomInfo').style.display = 'block';
    $('currentRoomName').textContent = roomName || `${nickname}'s Room`;
    $('currentRoomId').textContent = roomId;
  });

  socket.on('joinedLobby', ({ roomId, roomName }) => {
    currentRoom = roomId;
    $('roomInfo').style.display = 'block';
    $('currentRoomName').textContent = roomName;
    $('currentRoomId').textContent = roomId;
    $('gameRoomName').textContent = roomName || `${nickname}'s Room`;
    $('gameRoomID').textContent = roomId;
    
    // 给用户一个反馈，比如按钮变灰或显示 "Waiting for game data..."
    $('joinLobbyBtn').textContent = 'Joined! Waiting...';
  });

  socket.on('joinError', (msg) => {
    alert('Error joining room: ' + msg);
  });

  socket.on('playersUpdate', payload => {
    // 兼容后端历史发法（array）或新发法（object）
    const players = Array.isArray(payload) ? payload : (payload.players || []);
    const hostUsername = payload.hostUsername || null;

    // 按 username 去重（保留最后一次出现的 info）
    const unique = Array.from(new Map(players.map(p => [p.username, p])).values());

    // 渲染大厅/游戏玩家列表（示例选择元素 id：playersList / gamePlayersList）
    const lobbyList = document.getElementById('playersList');
    if (lobbyList) {
      lobbyList.innerHTML = '';
      unique.forEach(p => {
        const li = document.createElement('li');
        let label = `${p.name}`; // 只显示昵称
        // 本玩家添加 (You)
        if (p.username === username) label += ' (You)';
        // 房主标注
        if (p.username === hostUsername) label += (p.username === username ? ' (Room Owner)' : ' (Room Owner)');
        li.textContent = label;
        // 给自己加一个样式
        if (p.username === username) li.classList.add('me');
        if (p.username === hostUsername) li.classList.add('host');
        lobbyList.appendChild(li);
      });
    }

    // 游戏面板玩家列表（同上）
    const gameList = document.getElementById('gamePlayersList');
    if (gameList) {
      gameList.innerHTML = '';
      unique.forEach(p => {
        const li = document.createElement('li');
        let label = `${p.name}`;
        if (p.username === username) label += ' (You)';
        if (p.username === hostUsername) label += (p.username === username ? ' (Room Owner)' : ' (Room Owner)');
        li.textContent = label;
        if (p.username === username) li.classList.add('me');
        if (p.username === hostUsername) li.classList.add('host');
        gameList.appendChild(li);
      });
    }

    // 如果需要记录当前房主在前端，用一个全局变量（便于 Leave Room 按钮显示 Close Room）
    currentRoomHost = hostUsername; // （在文件顶部声明 var currentRoomHost = null;）
  });

  socket.on('modeSet', mode => {
    $('modeSelect').value = mode;
    gameState.mode = mode;
  });

  // [修改] 将 gameStarted 逻辑独立出来，不要嵌套其他 socket.on
  socket.on('gameStarted', ({ board, revealed, flagged, mode, startTime }) => {
    const cfg = MODES[mode] || MODES.classic;
    
    // 初始化游戏状态
    gameState = {
      ...gameState, // 保留部分配置
      board, revealed, flagged,
      width: cfg.w, height: cfg.h, mines: cfg.m,
      mode, startTime: startTime || Date.now(),
      firstClick: true,
      gameOver: false,       // 确保重置
      animating: false,      // 确保重置
      cheatLevel: 0,         // [修改] 开始新游戏时强制关闭作弊
      timerInterval: null    // 先占位
    };

    // 清除旧定时器并开启新的
    if (gameState.timerInterval) clearInterval(gameState.timerInterval);
    gameState.timerInterval = setInterval(updateTimer, 1000);

    // UI 更新
    gameState.mines = cfg.m;
    updateMinesLeft();  ;
    if (localStorage.getItem('showTimer') !== 'false') {
      $('timerDisplay').style.display = 'block';
    }
    
    // [重要] 这里必须调用，确保非房主加入时能跳转页面并初始化 Canvas
    showGamePage(); 
    initCanvas(); // 确保 Canvas 尺寸被重新计算
    drawBoard();

    // 更新信息栏
    $('gameRoomName').textContent = $('currentRoomName').textContent || "Room";
    $('gameRoomID').textContent = currentRoom;
    updateMinesLeft();
  });

  // [修改] 将 gameRestarted 移到最外层！防止重复绑定
  socket.on('gameRestarted', ({ startTime, revealed, flagged }) => {
    gameState.gameOver = false;
    gameState.animating = false;
    gameState.cheatLevel = 0; // [修改] 重启时关闭作弊
    
    gameState.startTime = startTime;
    gameState.revealed = revealed;
    gameState.flagged = flagged;
    gameState.firstClick = true;
      
    if (gameState.timerInterval) clearInterval(gameState.timerInterval);
    gameState.timerInterval = setInterval(updateTimer, 1000);
    $('gameTimer').textContent = "00:00";
      
    $('overModal').style.display = 'none';
      
    drawBoard();
    updateMinesLeft();
  });

  // [修改] boardUpdate 保持不变
  socket.on('boardUpdate', ({ revealed, flagged }) => {
    // 直接覆盖本地状态
    gameState.revealed = revealed;
    gameState.flagged = flagged;
    
    // 强制重绘
    drawBoard();
    
    // 更新剩余雷数显示
    updateMinesLeft();
  });

  // [修改] flagUpdate 保持不变
  socket.on('flagUpdate', ({ r, c, state }) => {
    gameState.flagged[r][c] = state;
    drawBoard();
    updateMinesLeft();
  });

  socket.on('minesLeftUpdate', count => {
    $('minesLeft').textContent = count;
  });

  socket.on('gameOver', data => {
    if (gameState.gameOver) return; 
    gameState.gameOver = true;
    gameState.cheatLevel = 0; // [修改] 游戏结束强制关闭作弊显示
    drawBoard(); // 重绘一次以去除作弊透视效果
    
    clearInterval(gameState.timerInterval);
    loadStats(); // [新增] 游戏结束时刷新统计数据 

    if (data.winner) {
        fireworksAnim(3000);
        setTimeout(() => {
            $('overTitle').textContent = 'Win!';
            $('overMessage').textContent = `All mines cleared in ${$('gameTimer').textContent}!`;
            showOverModal(data); 
        }, 3000);
    } else {
        const startR = (data.bomb && typeof data.bomb.r === 'number') ? data.bomb.r : Math.floor(gameState.height/2);
        const startC = (data.bomb && typeof data.bomb.c === 'number') ? data.bomb.c : Math.floor(gameState.width/2);
          
        if (!gameState.animating) {
            gameState.animating = true;
            rippleExplosion(startC, startR, () => {
                $('overTitle').textContent = 'Game Over!';
                $('overMessage').textContent = 'You hit a mine!';
                showOverModal(data);
                gameState.animating = false; 
            });
        }
    }
  });

  socket.on('signalReceived', ({ type, r, c, fromUser }) => {
    drawSignal(type, c, r);
  });

  socket.on('joinSuccess', (data) => {
    currentRoom = data.room;
    showGamePage();
    // 更新玩家列表等
  });
  socket.on('joinError', (msg) => {
    alert(msg); // 如'Room not found'
  });

  // server announces room closed
  socket.on('roomClosed', payload => {
    const msg = (payload && payload.message) ? payload.message : 'Room Owner Close the Game';
    const modal = $('roomClosedModal');
    if (modal) {
      $('roomClosedMsg').textContent = msg;
      modal.style.display = 'block';
      $('backToLobbyBtn').onclick = () => {
        modal.style.display = 'none';
        // go back to main page: clear local currentRoom and show main page
        currentRoom = null;
        isHost = false;
        currentRoomHost = null;
        $('gamePage').style.display = 'none';
        $('mainPage').style.display = 'block';
        updateMainPageButtons();
      };
    }
  });

}

function updatePlayers(players) {
  const list = $('gamePlayersList');
  list.innerHTML = '';
  players.forEach(p => {
    const li = document.createElement('li');
    li.textContent = p.name;
    list.appendChild(li);
  });
}

// -------------------------- Game logic (client-side) --------------------------
// function getTile(e) {
//   const canvas = $('boardCanvas');
//   const rect = canvas.getBoundingClientRect();
  
//   // 更加精确的坐标计算
//   // e.clientX - rect.left 是鼠标在 Canvas 元素内的像素位置
//   // 不需要再乘比例系数，因为我们现在让 canvas.width 等于 style.width
//   const x = Math.floor((e.clientX - rect.left) / gameState.tileSize);
//   const y = Math.floor((e.clientY - rect.top)  / gameState.tileSize);
//   return {x, y};
// }

function bindCanvasEvents(canvas) {
  // 清除旧的事件监听 (虽然 canvas重建后没有旧的，但为了保险)
  canvas.onclick = null;
  canvas.oncontextmenu = null;
  canvas.onmousedown = null;
  canvas.onmouseup = null;

  // 1. 左键点击：揭开
  canvas.onclick = e => {
    // 基础检查
    if (!gameState.board || gameState.gameOver) return;
    
    const { x, y } = getTile(e);
    
    // 越界检查
    if (x < 0 || x >= gameState.width || y < 0 || y >= gameState.height) return;

    let flagVal = gameState.flagged?.[y]?.[x];
    // 把 false/undefined 视作 0
    if (flagVal === false || flagVal === undefined) flagVal = 0;
    if (gameState.revealed[y][x] || flagVal !== 0) return;

    // 发送揭开指令
    socket.emit('revealTile', { roomId: currentRoom, r: y, c: x });
  };

  // 2. 右键点击：插旗/问号
  canvas.oncontextmenu = e => {
    e.preventDefault();
    if (!gameState.board || gameState.gameOver) return;

    const { x, y } = getTile(e);
    if (x < 0 || x >= gameState.width || y < 0 || y >= gameState.height) return;
    if (gameState.revealed[y][x]) return; // 已揭开不能插旗

    const currentVal = gameState.flagged[y][x];
    const nextVal = (currentVal + 1) % 3; // 0->1->2->0 循环

    // 可以在这里加个简单的音效触发(如果未来需要)
    socket.emit('toggleFlag', { roomId: currentRoom, r: y, c: x, state: nextVal });
  };

  // 3. 中键拖拽：发信号 (保持原有逻辑，优化坐标获取)
  let isDragging = false;
  let dragStart = null;

  canvas.onmousedown = e => {
    if (e.button === 1) { // 中键
      e.preventDefault();
      isDragging = true;
      dragStart = getTile(e);
    }
  };

  canvas.onmouseup = e => {
    if (isDragging && e.button === 1) {
      e.preventDefault();
      const end = getTile(e);
      const dx = end.x - dragStart.x;
      const dy = end.y - dragStart.y;
      
      let type = 'question';
      if (Math.abs(dx) > Math.abs(dy)) type = dx > 0 ? 'onMyWay' : 'help';
      else type = dy > 0 ? 'question' : 'avoid';

      socket.emit('sendSignal', { roomId: currentRoom, type, r: dragStart.y, c: dragStart.x });
      isDragging = false;
    }
  };
}

function initCanvas() {
  const canvas = $('boardCanvas');
  if (!canvas) return;

  // 我们希望 Canvas 最大占据屏幕宽度的 65% (留给右侧信息栏)，高度的 85%
  const maxW = window.innerWidth * 0.65; 
  const maxH = window.innerHeight * 0.85;

  // 计算两种限制下的最大格子大小，取较小值，保证完全放入屏幕
  const tileW = Math.floor(maxW / gameState.width);
  const tileH = Math.floor(maxH / gameState.height);
  
  // 设置最小值(比如20px)防止太小看不清，设置最大值(比如60px)防止太大
  gameState.tileSize = Math.min(60, Math.max(20, Math.min(tileW, tileH)));

  // 关键：动态设置 canvas 像素尺寸（解决半个格子 + 点击偏移）
  canvas.width  = gameState.width  * gameState.tileSize;
  canvas.height = gameState.height * gameState.tileSize;

  // 可选：让 canvas 视觉上居中且不超大（推荐）
  canvas.style.maxWidth = "none";
  canvas.style.maxHeight = "none";
  canvas.style.width = `${canvas.width}px`;
  canvas.style.height = `${canvas.height}px`;

    // update global getTile so all handlers use the correct scaling
  window.getTile = (e) => {
    const rect = canvas.getBoundingClientRect();
    // map CSS coords to canvas pixel coords (handles CSS scaling/HiDPI)
    const px = (e.clientX - rect.left) * (canvas.width  / rect.width);
    const py = (e.clientY - rect.top)  * (canvas.height / rect.height);
    const x = Math.floor(px / gameState.tileSize);
    const y = Math.floor(py / gameState.tileSize);
    return { x, y };
  };  

  bindCanvasEvents(canvas);
}

function performReveal(r, c) {
  if (gameState.board[r][c] === -1) {
    gameState.revealed.forEach(row => row.fill(true));
    drawBoard();
    endGame(false);
    return;
  }

  const stack = [[c, r]];
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || x >= gameState.width || y < 0 || y >= gameState.height) continue;
    if (gameState.revealed[y][x]) continue;
    gameState.revealed[y][x] = true;
    if (gameState.board[y][x] === 0) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          stack.push([x + dx, y + dy]);
        }
      }
    }
  }
  drawBoard();
  if (checkWin()) endGame(true);
}

function countFlags() {
  let n = 0;
  for (let row of gameState.flagged) for (let f of row) if (f === 1) n++;
  return n;
}

function checkWin() {
  for (let y = 0; y < gameState.height; y++) {
    for (let x = 0; x < gameState.width; x++) {
      if (gameState.board[y][x] !== -1 && !gameState.revealed[y][x]) return false;
    }
  }
  return true;
}

function endGame(won) {
  clearInterval(gameState.timerInterval);
  $('overModal').style.display = 'flex';
  $('overTitle').textContent   = won ? 'Victory!' : 'Game Over!';
  $('overMessage').textContent = won ? `Time: ${$('gameTimer').textContent}` : 'You hit a mine';

  $('restartOverBtn').onclick = () => location.reload();
  $('backToLobbyBtn').onclick = () => location.reload();
}

function drawBoard() {
  const canvas = $('boardCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const ts = gameState.tileSize;

  // 动态设置 canvas 大小，避免出现“半个格子”
  canvas.width = gameState.width * ts;
  canvas.height = gameState.height * ts;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 新增：提前判断是否胜利（修复 won 未定义）
  const isWon = checkWin();  // 使用你已有的 checkWin() 函数

  for (let y = 0; y < gameState.height; y++) {
    for (let x = 0; x < gameState.width; x++) {
      const v = gameState.board[y][x];
      const r = gameState.revealed[y][x];
      const f = gameState.flagged[y][x];

      // 绘制格子背景
      ctx.fillStyle = r ? '#ddd' : '#bbb';
      ctx.fillRect(x*ts, y*ts, ts, ts);
      ctx.strokeStyle = '#888';
      ctx.strokeRect(x*ts, y*ts, ts, ts);

      // 绘制已翻开的雷
      if (r && v === -1) {
        ctx.fillStyle = '#000000'; // 黑色主体
        ctx.beginPath();
        // 绘制八角星形（齿轮状）
        const centerX = x * ts + ts / 2;
        const centerY = y * ts + ts / 2;
        const outerRadius = ts / 2.5; // 外径
        const innerRadius = ts / 4;   // 内径
        for (let i = 0; i < 8; i++) {
          const angle = (Math.PI * 2 / 8) * i;
          const outerX = centerX + Math.cos(angle) * outerRadius;
          const outerY = centerY + Math.sin(angle) * outerRadius;
          const innerAngle = angle + (Math.PI / 8);
          const innerX = centerX + Math.cos(innerAngle) * innerRadius;
          const innerY = centerY + Math.sin(innerAngle) * innerRadius;
          if (i === 0) ctx.moveTo(outerX, outerY);
          else ctx.lineTo(outerX, outerY);
          ctx.lineTo(innerX, innerY);
        }
        ctx.closePath();
        ctx.fill();

        // 中心白色圆点
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(centerX, centerY, ts / 8, 0, Math.PI * 2);
        ctx.fill();
      } 
      // 绘制数字
      else if (r && v > 0) {
        ctx.save();
        const cols = ['', 'blue', 'green', 'red', 'navy', 'maroon', 'teal', 'black', 'gray'];
        ctx.fillStyle = cols[v] || 'black';
        // use dynamic font size relative to tile size and center the text
        ctx.font = `bold ${Math.floor(ts * 0.6)}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(v), x * ts + ts / 2, y * ts + ts / 2);
        ctx.restore();
      } 
      // 绘制旗帜
      else if (f === 1) { // red flag
        ctx.save();
        // shorter, nicer pole
        const poleWidth  = Math.max(2, Math.round(ts * 0.06));
        const poleHeight = Math.round(ts * 0.44); // shorter than full height
        const poleX = x * ts + Math.round(ts * 0.62); // slightly to the right
        const poleY = y * ts + Math.round(ts * 0.18); // start a bit down from top

        // pole
        ctx.fillStyle = '#222';
        ctx.fillRect(poleX, poleY, poleWidth, poleHeight);

        // flag (triangle)
        ctx.fillStyle = '#c00';
        ctx.beginPath();
        ctx.moveTo(poleX + poleWidth, poleY + Math.round(poleHeight * 0.12));
        ctx.lineTo(poleX + Math.round(ts * 0.26), poleY + Math.round(poleHeight * 0.25));
        ctx.lineTo(poleX + poleWidth, poleY + Math.round(poleHeight * 0.38));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      else if (f === 2) { // 状态2：白色问号
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold ' + (ts * 0.8) + 'px Arial'; // 动态字体大小
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', x*ts + ts/2, y*ts + ts/2);
        // 恢复对齐默认值，防止影响其他绘制
        ctx.textAlign = 'left'; 
        ctx.textBaseline = 'alphabetic';
      }

      // 作弊模式等级 3 - 在未翻开格子上显示内容（半透明）
      if (!r && gameState.cheatLevel === 3) {
        ctx.globalAlpha = 0.35;
        if (v === -1) {
          ctx.fillStyle = '#000000'; // 黑色主体
          ctx.beginPath();
          // 绘制八角星形（齿轮状）
          const centerX = x * ts + ts / 2;
          const centerY = y * ts + ts / 2;
          const outerRadius = ts / 2.5; // 外径
          const innerRadius = ts / 4;   // 内径
          for (let i = 0; i < 8; i++) {
            const angle = (Math.PI * 2 / 8) * i;
            const outerX = centerX + Math.cos(angle) * outerRadius;
            const outerY = centerY + Math.sin(angle) * outerRadius;
            const innerAngle = angle + (Math.PI / 8);
            const innerX = centerX + Math.cos(innerAngle) * innerRadius;
            const innerY = centerY + Math.sin(innerAngle) * innerRadius;
            if (i === 0) ctx.moveTo(outerX, outerY);
            else ctx.lineTo(outerX, outerY);
            ctx.lineTo(innerX, innerY);
          }
          ctx.closePath();
          ctx.fill();

          // 中心白色圆点
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(centerX, centerY, ts / 8, 0, Math.PI * 2);
          ctx.fill();
        } else if (v > 0) {
          // 修复错位：居中数字
          const cols = ['', 'blue', 'green', 'red', 'navy', 'maroon', 'teal', 'black', 'gray'];
          ctx.fillStyle = cols[v] || '#9c27b0'; // 紫色或原色
          ctx.font = 'bold ' + Math.floor(ts * 0.5) + 'px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(v, x*ts + ts/2, y*ts + ts/2);
        }
        ctx.globalAlpha = 1.0;
        // 恢复默认对齐（防止影响其他绘制）
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
      }
    }
  }

  // 胜利烟花效果（只触发一次）
  if (isWon && !gameState.winEffectPlayed) {
    gameState.winEffectPlayed = true;  // 防止重复播放
    // playSound('win');  // 等你加音效时再打开

    let particles = [];
    class Particle {
      constructor() {
        this.x = canvas.width / 2;
        this.y = canvas.height / 2;
        this.vx = Math.random() * 12 - 6;
        this.vy = Math.random() * 12 - 6;
        this.life = 100;
      }
      update() { this.x += this.vx; this.y += this.vy; this.life -= 1; }
      draw() {
        ctx.globalAlpha = this.life / 100;
        ctx.fillStyle = `hsl(${Math.random()*360},100%,50%)`;
        ctx.fillRect(this.x - 3, this.y - 3, 6, 6);
      }
    }

    for (let i = 0; i < 150; i++) particles.push(new Particle());

    const anim = () => {
      ctx.fillStyle = 'rgba(0,0,0,0.05)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      particles = particles.filter(p => p.life > 0);
      particles.forEach(p => { p.update(); p.draw(); });
      if (particles.length > 0) requestAnimationFrame(anim);
    };
    anim();
  }
}

function drawSignal(type, x, y) {
  const canvas = $('boardCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const ts = gameState.tileSize;
  const map = {
    help: 'Help!',
    onMyWay: 'Walking',
    avoid: 'Warning',
    question: 'Question'
  };

  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = 'yellow';
  ctx.fillRect(x * ts, y * ts, ts, ts);
  ctx.fillStyle = 'red';
  ctx.font = 'bold 16px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(map[type] || '?', x * ts + ts/2, y * ts + ts/2 + 6);
  ctx.restore();

  setTimeout(drawBoard, 2000); // 2秒后清除
}

function floodReveal(y, x) {
  const stack = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx < 0 || cx >= gameState.width || cy < 0 || cy >= gameState.height) continue;
    if (gameState.revealed[cy][cx]) continue;
    gameState.revealed[cy][cx] = true;

    const val = gameState.board[cy][cx];
    if (val === 0) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          stack.push([cx + dx, cy + dy]);
        }
      }
    }
  }
}

function updateTimer() {
  const sec = Math.floor((Date.now() - gameState.startTime) / 1000);
  const m = String(Math.floor(sec/60)).padStart(2,'0');
  const s = String(sec%60).padStart(2,'0');
  $('gameTimer').textContent = `${m}:${s}`;
}

function showGamePage() {
  loadTheme();
  $('mainPage').style.display = 'none';
  $('gamePage').style.display = 'block';

  $('backToLobbyBtn').onclick = () => {
    $('gamePage').style.display = 'none';
    $('mainPage').style.display = 'block';
    loadTheme(); // 重载主题
  };

  $('leaveGameBtn').onclick = () => {
    if (isHost) {
      const m = $('ownerCloseModal');
      if (!m) {
        // fallback: behave like normal leave
        $('gamePage').style.display = 'none';
        $('mainPage').style.display = 'block';
        updateMainPageButtons();
        return;
      }
      m.style.display = 'block';

      $('continueBtn').onclick = () => { m.style.display = 'none'; };
      $('cancelCloseBtn').onclick = () => { m.style.display = 'none'; };

      $('closeRoomBtn').onclick = () => {
        // request server to close the room
        socket.emit('closeRoom', { roomId: currentRoom });
        m.style.display = 'none';
        // owner returns to main
        currentRoom = null;
        isHost = false;
        currentRoomHost = null;
        $('gamePage').style.display = 'none';
        $('mainPage').style.display = 'block';
        updateMainPageButtons();
      };
    } else {
      // normal player leave
      socket.emit('leaveRoom', { roomId: currentRoom });
      currentRoom = null;
      $('gamePage').style.display = 'none';
      $('mainPage').style.display = 'block';
      updateMainPageButtons();
    }
  };


  const canvas = $('boardCanvas');
  const ctx = canvas.getContext('2d');

  // 防止中键滚轮滚动页面
  canvas.onwheel = e => e.preventDefault();
  canvas.onmousedown = e => { if (e.button === 1) e.preventDefault(); };

  // === 其他初始化 ===
  if (gameState.board) {
    initCanvas();
    drawBoard();
    loadTheme();
  }
}

function loadTheme() {
  const t = localStorage.getItem('theme') || 'classic';
  document.documentElement.setAttribute('data-theme', t);
  if ($('themeSelect')) $('themeSelect').value = t;
  if ($('gamePage').style.display === 'block') drawBoard();
}

document.addEventListener('keydown', e => {
  if (e.key === 'c' || e.key === 'C') {
    gameState.cheatLevel = (gameState.cheatLevel + 1) % 4;
    drawBoard();
  }
});

$('restartOverBtn').onclick = () => {
  $('overModal').style.display = 'none';

  // 1. 强制重置状态
  gameState.gameOver = false; 
  gameState.animating = false; 
  gameState.cheatLevel = 0; // [修改] 重启关闭作弊
  
  // 2. 数据清空 (本地先清空，等待服务器同步)
  // 注意：这里需要深拷贝或新建数组，防止引用问题
  if (gameState.height && gameState.width) {
      gameState.revealed = Array.from({length: gameState.height}, () => Array(gameState.width).fill(false));
      gameState.flagged = Array.from({length: gameState.height}, () => Array(gameState.width).fill(0));
  }
  
  // 3. UI 重置
  gameState.startTime = Date.now();
  if (gameState.timerInterval) clearInterval(gameState.timerInterval);
  gameState.timerInterval = setInterval(updateTimer, 1000);
  $('gameTimer').textContent = "00:00";

  drawBoard();
  updateMinesLeft();

  // 4. 发送给服务器
  socket.emit('restartGame', currentRoom);
};


// 如果没有initCanvasEvents，添加一个函数在showGamePage中调用，并在restart中调用
function initCanvasEvents() {
  const canvas = $('boardCanvas');
  canvas.onmousedown = handleMouseDown; // 假设您的鼠标处理函数
  canvas.oncontextmenu = e => e.preventDefault();
  // 其他事件
}

function explosionAnim(startX, startY) {
  const canvas = $('boardCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const ts = gameState.tileSize;
  let radius = 0;
  const anim = () => {
    drawBoard(); // 重绘板
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = 'orange';
    ctx.beginPath();
    ctx.arc(startX*ts + ts/2, startY*ts + ts/2, radius, 0, 2*Math.PI);
    ctx.fill();
    radius += ts / 2; // 扩散速度
    if (radius < Math.max(gameState.width, gameState.height) * ts) {
      requestAnimationFrame(anim);
    } else {
      // 爆炸完显示所有雷
      gameState.revealed.forEach((row, y) => row.forEach((_, x) => {
        if (gameState.board[y][x] === -1) gameState.revealed[y][x] = true;
      }));
      drawBoard();
    }
  };
  anim();
}

// 封装 fireworksAnim
function fireworksAnim(duration = 3000) { // 默认3秒
  const canvas = $('boardCanvas');
  const ctx = canvas.getContext('2d');
  let particles = [];

  class Particle {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      this.speedX = (Math.random() - 0.5) * 10;
      this.speedY = (Math.random() - 0.5) * 10;
      this.life = 255;
      this.color = `hsl(${Math.random() * 360}, 100%, 50%)`;
    }
    update() {
      this.x += this.speedX;
      this.y += this.speedY;
      this.life -= 2;
    }
    draw() {
      ctx.globalAlpha = this.life / 255;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 初始化粒子
  for (let i = 0; i < 100; i++) {
    particles.push(new Particle(canvas.width / 2, canvas.height / 2));
  }

  const startTime = Date.now();
  function anim() {
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    particles = particles.filter(p => p.life > 0);
    particles.forEach(p => { p.update(); p.draw(); });
    if (Date.now() - startTime < duration && particles.length > 0) {
      requestAnimationFrame(anim);
    }
  }
  anim();
}

function updateMinesLeft() {
  const el = document.getElementById('minesLeft');
  if (!el || !gameState.flagged) return;

  // 计算旗子数量 (状态为 1)
  let flags = 0;
  for (let y = 0; y < gameState.height; y++) {
    for (let x = 0; x < gameState.width; x++) {
      if (gameState.flagged[y][x] === 1) flags++;
    }
  }
  
  // 强制显示，防止 DOM 元素内容丢失
  el.style.display = 'inline'; 
  el.textContent = Math.max(0, gameState.mines - flags);
}

function updateMainPageButtons() {
    const startBtn = $('startGameBtn');
    
    // 如果有房间ID，且游戏并未结束 (注意：如果不刷新页面，gameState还保留着)
    if (currentRoom) { 
        startBtn.textContent = 'Continue Game';
        startBtn.style.background = '#e67e22'; 
        
        // 覆盖原本的 onclick (原本是 emit startGame)
        startBtn.onclick = () => {
            showGamePage();
            // 重新获取一下当前状态，防止离开期间有变化
            // (如果没有 syncState 接口，至少前端切回去是能看的)
        };
    } else {
        startBtn.textContent = 'Start Game';
        startBtn.style.background = ''; 
        startBtn.onclick = () => {
            if (isHost) socket.emit('startGame', currentRoom);
        };
    }
}

function rippleExplosion(centerX, centerY, callback) {
    const canvas = $('boardCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const ts = gameState.tileSize;
    
    // 计算最大半径
    const maxRadius = Math.max(gameState.width, gameState.height) * 1.5;
    let radius = 0;
    const speed = 0.5; // 扩散速度（单位：格子）

    function anim() {
        // 如果页面被关闭或重置，停止动画
        if (!gameState.gameOver) return;

        radius += speed;
        
        // 1. 先重绘底图 (这一步是必须的，清除上一帧的红色圆圈)
        drawBoard(); 

        // 2. 优化：只遍历当前圆环附近的区域，而不是全图遍历（或者简单点，保持全遍历但不做重操作）
        // 为了性能，我们尽量减少 stroke/fill 调用次数
        ctx.fillStyle = '#ff4d4d'; 
        
        // 遍历所有格子
        for(let y=0; y<gameState.height; y++) {
            for(let x=0; x<gameState.width; x++) {
                // 如果是雷
                if (gameState.board[y][x] === -1) {
                    const dist = Math.sqrt((x-centerX)**2 + (y-centerY)**2);
                    
                    // 只有当波浪覆盖到这个雷时才画红
                    if (dist < radius) {
                        ctx.fillRect(x*ts, y*ts, ts, ts);
                        
                        // 画个简单的爆炸圈
                        ctx.beginPath();
                        ctx.arc(x*ts + ts/2, y*ts + ts/2, ts/3, 0, Math.PI*2);
                        // 注意：不要在循环里频繁切换 fillStyle，这里为了简单直接画
                        ctx.save();
                        ctx.fillStyle = 'darkred';
                        ctx.fill();
                        ctx.restore();
                    }
                }
            }
        }

        if (radius < maxRadius) {
            requestAnimationFrame(anim);
        } else {
            if(callback) callback();
        }
    }
    anim();
}

function showOverModal(data) {
    $('overModal').style.display = 'flex';
    
    const newGameBtn = $('startNewGameBtn');
    
    // 只有胜利且是房主时，才显示 Start New Game (或者所有人都显示，看需求)
    // 这里假设只有房主能开新局
    if (data.winner && isHost) {
        newGameBtn.style.display = 'inline-block';
        newGameBtn.onclick = () => {
             $('overModal').style.display = 'none';
             // 发送 startGame 会生成新雷
             socket.emit('startGame', currentRoom); 
        };
    } else {
        newGameBtn.style.display = 'none';
    }
}