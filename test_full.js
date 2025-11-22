const axios = require('axios');
const { io } = require('socket.io-client');
const { spawn } = require('child_process');

const BASE_URL = 'http://localhost:8000';
let serverProcess;

// 延时函数
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function startServer() {
    console.log('>>> Starting Server...');
    serverProcess = spawn('node', ['server.js'], { stdio: 'inherit', shell: true });
    
    // Wait for server to be ready
    // Since we use inherit, we can't grep stdout easily, so we just wait a bit
    await sleep(3000);
}

async function stopServer() {
    if (serverProcess) {
        console.log('>>> Stopping Server...');
        // On Windows, killing the shell might not kill the node process if not careful, 
        // but usually tree-kill is needed. For simple test, we try .kill()
        serverProcess.kill();
        // Force kill if needed
        try {
             process.kill(serverProcess.pid);
        } catch(e) {}
    }
}

async function testRestApi() {
    console.log('\n=== Testing REST API ===');
    const username = `user_${Date.now()}`;
    const password = 'password123';

    try {
        // 1. Register
        console.log(`[1] Registering user: ${username}`);
        const regRes = await axios.post(`${BASE_URL}/register`, { username, password });
        console.log('Response:', regRes.data);
        if (!regRes.data.success) throw new Error('Registration failed');

        // 2. Login
        console.log(`[2] Logging in user: ${username}`);
        const loginRes = await axios.post(`${BASE_URL}/login`, { username, password });
        console.log('Response:', loginRes.data);
        if (!loginRes.data.success) throw new Error('Login failed');

        // 3. Stats
        console.log(`[3] Getting stats for: ${username}`);
        const statsRes = await axios.get(`${BASE_URL}/stats/${username}`);
        console.log('Stats retrieved:', Object.keys(statsRes.data).length > 0 ? 'OK' : 'Empty');

        return username;
    } catch (error) {
        console.error('REST API Test Failed:', error.message);
        if (error.response) console.error('Data:', error.response.data);
        throw error;
    }
}

async function testSocketFlow(username1) {
    console.log('\n=== Testing Socket.IO Flow ===');
    const username2 = `user2_${Date.now()}`;
    
    // Register user 2 first
    await axios.post(`${BASE_URL}/register`, { username: username2, password: 'password123' });

    return new Promise((resolve, reject) => {
        // Client 1
        const socket1 = io(BASE_URL);
        // Client 2
        const socket2 = io(BASE_URL);

        let roomId = null;

        socket1.on('connect', () => {
            console.log('[Socket 1] Connected');
            socket1.emit('auth', username1);
            
            // Create Lobby
            setTimeout(() => {
                console.log('[Socket 1] Creating Lobby...');
                socket1.emit('createLobby', 'Test Room');
            }, 500);
        });

        socket1.on('lobbyCreated', (data) => {
            console.log('[Socket 1] Lobby Created:', data);
            roomId = data.roomId;

            // Client 2 joins after lobby is created
            setTimeout(() => {
                console.log('[Socket 2] Connecting and Joining...');
                socket2.emit('auth', username2);
                socket2.emit('joinLobby', roomId);
            }, 500);
        });

        socket1.on('playersUpdate', (players) => {
            console.log(`[Socket 1] Players Update: ${JSON.stringify(players)}`);
            
            // Check if both players are in
            if (players.includes(username1) && players.includes(username2)) {
                console.log('>>> Both players joined successfully!');
                
                // Test Disconnect Logic
                console.log('[Socket 2] Disconnecting to test list update...');
                socket2.disconnect();
            }
        });

        // Listen for updates on socket 1 to confirm socket 2 left
        let playersCountHistory = [];
        socket1.on('playersUpdate', (players) => {
            playersCountHistory.push(players.length);
            // We expect sequence: [1] (create) -> [2] (join) -> [1] (disconnect)
            // Or just check if we saw 2 and now see 1
            const sawTwo = playersCountHistory.some(c => c === 2);
            if (sawTwo && players.length === 1) {
                console.log('>>> Player list updated correctly after disconnect!');
                console.log('All tests passed!');
                socket1.disconnect();
                resolve();
            }
        });

        socket2.on('joinedLobby', (data) => {
            console.log('[Socket 2] Joined Lobby:', data);
        });

        // Timeout protection
        setTimeout(() => {
            console.error('Test Timed Out');
            socket1.disconnect();
            socket2.disconnect();
            reject(new Error('Timeout'));
        }, 10000);
    });
}

async function run() {
    await startServer();
    try {
        const user1 = await testRestApi();
        await testSocketFlow(user1);
    } catch (e) {
        console.error('Test Failed');
    } finally {
        await stopServer();
        process.exit(0);
    }
}

run();
