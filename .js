// A open endpoint multi-player server
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

io.on('connection', (socket) => {
    socket.emit('message', "Connection Successful!");
});

server.listen(8000, () => {
    console.log("The game server has started...");
});