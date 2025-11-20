# Multisweeper RESTful API Design

## 1. 概述 (Overview)
本 API 遵循 RESTful 标准，用于处理游戏的非实时交互部分。
- **Base URL**: `/api/v1`
- **数据格式**: JSON
- **认证方式**: Session / Token (推荐使用 HTTP-only Cookies)

---

## 2. 用户认证 (Authentication)

### 注册新用户
- **Endpoint**: `POST /auth/register`
- **Body**:
  ```json
  {
    "username": "player1",
    "password": "securePassword123"
  }
  ```
- **Response**: `201 Created` - 返回用户信息（不含密码）

### 登录
- **Endpoint**: `POST /auth/login`
- **Body**:
  ```json
  {
    "username": "player1",
    "password": "securePassword123"
  }
  ```
- **Response**: `200 OK` - 设置 Session Cookie

### 登出
- **Endpoint**: `POST /auth/logout`
- **Response**: `200 OK` - 清除 Session

### 获取当前登录用户信息 (用于前端持久化状态)
- **Endpoint**: `GET /auth/me`
- **Response**: `200 OK`
  ```json
  {
    "id": "u123",
    "username": "player1",
    "isAuthenticated": true
  }
  ```

---

## 3. 用户与统计 (Users & Statistics)

### 获取用户资料
- **Endpoint**: `GET /users/:username`
- **Response**: `200 OK`

### 获取用户详细统计数据
- **Endpoint**: `GET /users/:username/stats`
- **Response**: `200 OK`
  ```json
  {
    "totalGames": 100,
    "wins": 45,
    "winRate": 0.45,
    "totalTimePlayed": 3600, // 秒
    "longestStreak": 5,
    "bestTime": {
      "beginner": 120,
      "expert": 300
    }
  }
  ```

### 更新用户设置 (主题、音量等)
- **Endpoint**: `PUT /users/:username/settings`
- **Body**:
  ```json
  {
    "theme": "dark-mode",
    "volume": 80,
    "autoReveal": true
  }
  ```

---

## 4. 游戏大厅与房间 (Lobbies)
*注意：实际的游戏操作（点击、插旗）将通过 Socket.io 进行，但房间的创建和管理可以通过 REST API 初始化。*

### 创建房间 (Create Lobby)
- **Endpoint**: `POST /lobbies`
- **Body**:
  ```json
  {
    "name": "My Game Room",
    "isPrivate": false,
    "settings": {
      "difficulty": "Expert", // Classic, Simple, Medium, Expert, Custom
      "width": 30,            // 仅 Custom 模式需要
      "height": 16,           // 仅 Custom 模式需要
      "mines": 99             // 仅 Custom 模式需要
    }
  }
  ```
- **Response**: `201 Created`
  ```json
  {
    "lobbyId": "lobby_xyz123",
    "joinUrl": "https://game.com/lobby/lobby_xyz123"
  }
  ```

### 获取房间列表 (用于大厅展示)
- **Endpoint**: `GET /lobbies`
- **Query Params**: `?status=waiting` (只显示等待中的房间)
- **Response**: `200 OK` - 房间列表数组

### 获取特定房间信息
- **Endpoint**: `GET /lobbies/:lobbyId`
- **Response**: `200 OK`
  ```json
  {
    "id": "lobby_xyz123",
    "host": "player1",
    "players": ["player1", "player2"],
    "status": "waiting", // waiting, playing, finished
    "settings": { ... }
  }
  ```

### 修改房间设置 (仅房主)
- **Endpoint**: `PUT /lobbies/:lobbyId`
- **Body**: `{ "settings": { "difficulty": "Simple" } }`

---

## 5. 排行榜 (Leaderboard)

### 获取全球排行榜
- **Endpoint**: `GET /leaderboard`
- **Query Params**:
  - `mode`: `beginner` | `medium` | `expert` (按难度筛选)
  - `sortBy`: `time` | `wins` (按时间或胜场排序)
  - `limit`: `10` (返回前10名)
- **Response**: `200 OK`
  ```json
  [
    { "rank": 1, "username": "speedrunner", "time": 45, "date": "2023-10-01" },
    { "rank": 2, "username": "miner_king", "time": 48, "date": "2023-09-28" }
  ]
  ```

---

## 6. 游戏历史 (Game History)

### 获取用户的对局历史
- **Endpoint**: `GET /users/:username/games`
- **Response**: `200 OK` - 返回该用户参与过的游戏记录列表。

---

## 附录：WebSocket 事件设计 (参考)
虽然这不是 REST API，但为了配合后端开发，建议定义以下 Socket 事件：

- **Client -> Server**:
  - `join_lobby`: 加入房间
  - `start_game`: 开始游戏
  - `reveal_tile`: 点击格子 `{x, y}`
  - `flag_tile`: 插旗 `{x, y}`
  - `signal`: 发送信号 `{type, x, y}` (Help, On my way, etc.)
  
- **Server -> Client**:
  - `player_joined`: 有人加入
  - `game_started`: 游戏开始，下发地图数据
  - `board_update`: 地图更新（谁翻开了哪里）
  - `game_over`: 游戏结束（胜利或踩雷）
