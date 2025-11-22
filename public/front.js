// Utility function
const $ = (id) => document.getElementById(id);

let socket = null;  // 关键：不要在顶部连接！
let username = null;
let nickname = null;
let currentRoom = null;
let isHost = false;

// DOM ready
document.addEventListener('DOMContentLoaded', async () => {
	const storedUser = localStorage.getItem('username');
	const storedToken = localStorage.getItem('token');
	const storedNickname = localStorage.getItem('nickname');

	if (storedUser && storedToken) {
		// [Refactor] Verify session with server
		try {
			const res = await fetch('/verify', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username: storedUser, token: storedToken })
			});
			const data = await res.json();
            
			if (data.success) {
				username = storedUser;
				nickname = storedNickname || storedUser;
				showMain();
				return;
			}
		} catch (e) {
			console.error('Session check failed:', e);
		}
	}

	// If verification failed or no token, clear and show login
	localStorage.removeItem('username');
	localStorage.removeItem('token');
	localStorage.removeItem('nickname');
	$('loginModal').style.display = 'flex';
	$('registerBtn')?.addEventListener('click', handleRegister);
	$('loginBtn')?.addEventListener('click', handleLogin);
});

// ================== Login and Registration ==================
async function handleRegister() {
	const u = $('username').value.trim();
	const n = $('nickname').value.trim();
	const p = $('password').value;
	if (!u || !p) return msg('Please fill in username and password', '#f66');

	// [Refactor] 注册逻辑：后端现在使用对象存储
	// POST /register { username, password, name } -> { success: true/false, name }
	const res = await fetch('/register', { 
		method: 'POST', 
		headers: { 'Content-Type': 'application/json' }, 
		body: JSON.stringify({ username: u, password: p, name: n || u }) 
	});
	const data = await res.json();
	if (data.success) {
		localStorage.setItem('nickname', n || u);
	}
	msg(data.success ? 'Registration successful! Please log in' : (data.msg || 'Registration failed'), data.success ? '#6f6' : '#f66');
}

async function handleLogin() {
	const u = $('username').value.trim();
	const p = $('password').value;
	if (!u || !p) return msg('Please fill in username and password', '#f66');

	// [Refactor] 登录逻辑：后端现在使用对象存储，但 API 接口保持不变
	// POST /login { username, password } -> { success: true, username: ..., name: ... }
	const res = await fetch('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
	const data = await res.json();

	if (data.success) {
		username = u;
		nickname = data.name || u;
		localStorage.setItem('username', u);
		localStorage.setItem('token', data.token); // [Refactor] Save token
		localStorage.setItem('nickname', nickname);
		showMain();  // 登录成功 → 进入大厅
	} else {
		msg(data.msg || 'Incorrect username or password', '#f66');
	}
}

function msg(text, color) {
	const el = $('loginMsg');
	el.textContent = text;
	el.style.color = color;
}

// ================== 主界面显示与所有事件绑定 ==================
function showMain() {
	$('loginModal').style.display = 'none';
	$('mainPage').style.display = 'block';
	$('welcomeUser').textContent = nickname || username;

	// 关键修复：每次进入大厅都重新连接 socket！
	if (!socket || !socket.connected) {
		socket = io();
		socket.emit('auth', username);
		setupSocketEvents();  // 重新绑定所有事件
	}

	loadStats();
	loadTheme();
	initGameplaySettings();
	bindLobbyEvents();
	bindLogout();
}

function bindLogout() {
	$('logoutBtn').onclick = () => {
		localStorage.removeItem('username');
        localStorage.removeItem('token');
		location.reload();
	};
}

function bindLobbyEvents() {
	$('createLobbyBtn').onclick = () => {
		const roomName = $('roomNameInput').value.trim() || `${username}'s Room`;
		socket.emit('createLobby', roomName);
	};

	$('joinLobbyBtn').onclick = () => {
		const id = $('roomInput').value.trim().toUpperCase();
		if (!id) return alert('Please enter Room ID');
		socket.emit('joinLobby', id);
	};

	$('copyRoomBtn').onclick = () => {
		navigator.clipboard.writeText($('currentRoomId').textContent);
		const btn = $('copyRoomBtn');
		const old = btn.textContent;
		btn.textContent = 'Copied!';
		setTimeout(() => btn.textContent = old, 1500);
	};

	$('modeSelect').onchange = (e) => {
		if (isHost && currentRoom) {
			socket.emit('setMode', { roomId: currentRoom, mode: e.target.value });
		}
	};

	$('startGameBtn').onclick = () => {
		if (isHost && currentRoom) {
			socket.emit('startGame', currentRoom);
		}
	};
}

// 所有 socket 事件集中绑定，防止重复绑定
function setupSocketEvents() {
	// 先清除旧监听（防止重复）
	socket.off('lobbyCreated');
	socket.off('joinedLobby');
	socket.off('playersUpdate');
	socket.off('modeSet');
	socket.off('joinError');

	socket.on('lobbyCreated', (data) => {
		currentRoom = data.roomId;
		isHost = true;
		$('currentRoomName').textContent = data.roomName || `${username}'s Room`;
		$('currentRoomId').textContent = data.roomId;
		$('roomInfo').style.display = 'block';
		$('hostControls').style.display = 'block';
	});

	socket.on('joinedLobby', (data) => {
		currentRoom = data.roomId;
		isHost = false;
		$('currentRoomName').textContent = data.roomName || 'Room';
		$('currentRoomId').textContent = data.roomId;
		$('roomInfo').style.display = 'block';
		$('hostControls').style.display = 'none';
	});

	socket.on('playersUpdate', (players) => {
		const list = $('playersList');
		list.innerHTML = '';
		players.forEach(p => {
            // [Refactor] p 现在是对象 { username, name }
			const li = document.createElement('li');
			li.innerHTML = `${p.name} ${p.username === username ? '<span style="color:#0af">(You)</span>' : ''}`;
			list.appendChild(li);
		});
	});

	socket.on('modeSet', (mode) => {
		$('modeSelect').value = mode;
	});

	socket.on('joinError', (msg) => {
		alert('Join failed: ' + msg);
	});

    // =====================================================================================
    // [Refactor] 新增游戏交互逻辑监听
    // 对应 Server 端的新增功能开发区
    // =====================================================================================
	// TODOs referred to the server.js
}

// ================== Stats, Theme, Settings (保持不变) ==================
async function loadStats() {
	try {
		// [Refactor] 获取统计数据：后端现在直接通过 key 获取用户对象
		// GET /stats/:username -> { simple: {...}, classic: {...} }
		const res = await fetch(`/stats/${username}`);
		const stats = await res.json();
		const div = $('statsDashboard');
		let html = '<table><tr><th>Game Mode</th><th>Total Games</th><th>Wins</th><th>Win Rate</th><th>Fastest Time</th></tr>';
		
		// [Refactor] 确保 stats 是对象且不为空
		if (stats && Object.keys(stats).length > 0) {
			for (const [mode, s] of Object.entries(stats)) {
				const rate = s.games ? (s.wins / s.games * 100).toFixed(1) : 0;
				const best = s.bestTime === Infinity || s.bestTime === null ? '-' : (s.bestTime / 1000).toFixed(1) + 's';
				html += `<tr><td>${mode.charAt(0).toUpperCase() + mode.slice(1)}</td><td>${s.games}</td><td>${s.wins}</td><td>${rate}%</td><td>${best}</td></tr>`;
			}
			div.innerHTML = html + '</table>';
		} else {
			div.textContent = 'No stats available yet.';
		}
	} catch (e) {
		console.error('Load stats error:', e);
		$('statsDashboard').textContent = 'Error loading stats';
	}
}

function loadTheme() {
	const saved = localStorage.getItem('theme') || 'classic';
	document.documentElement.setAttribute('data-theme', saved);
	const select = $('themeSelect');
	if (select) select.value = saved;
}

$('themeSelect')?.addEventListener('change', (e) => {
	const theme = e.target.value;
	document.documentElement.setAttribute('data-theme', theme);
	localStorage.setItem('theme', theme);
});

function initGameplaySettings() {
	if (window.gameplaySettingsInitialized) return;
	window.gameplaySettingsInitialized = true;

	const autoReveal = localStorage.getItem('autoReveal') === 'true';
	const showTimer = localStorage.getItem('showTimer') === 'true';
	const volume = localStorage.getItem('volume') || '70';

	$('autoReveal').checked = autoReveal;
	$('showTimer').checked = showTimer;
	$('volumeSlider').value = volume;
	$('volumeValue').textContent = volume + '%';

	$('autoReveal').onchange = e => localStorage.setItem('autoReveal', e.target.checked);
	$('showTimer').onchange = e => localStorage.setItem('showTimer', e.target.checked);
	$('volumeSlider').oninput = e => {
		const val = e.target.value;
		$('volumeValue').textContent = val + '%';
		localStorage.setItem('volume', val);
	};
}