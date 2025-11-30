# Multisweeper

Multisweeper is a real-time multiplayer Minesweeper game built with Node.js, Express, and Socket.IO. It transforms the classic solitary puzzle into a collaborative experience where players can join rooms, solve boards together, and communicate via visual signals. The project features a robust lobby system, user authentication, persistent statistics, and a responsive canvas-based game rendering engine.

## Quick Start

1.  **Install dependencies:**
    ```bash
    npm install
    ```

2.  **Start the server:**
    ```bash
    npm run go
    ```

3.  **Play:**
    Open your browser and navigate to `http://localhost:8000`.

## Game Manual

### 1. Game Front Page (Lobby)
The entry point to the game, designed for ease of use.
- **Authentication**: Persistent login system. Username tracks unique statistics.
- **Lobby System**: Create or join lobbies via URL.
- **Game Modes**:
    - **Classic**: 8x8 (10 mines)
    - **Simple**: 9x9 (10 mines)
    - **Medium**: 16x16 (40 mines)
    - **Expert**: 30x16 (99 mines)
    - **Custom**: User-defined dimensions (Max 50x30) and mine count.
- **Features**:
    - **Theme Selection**: Choose visual themes (Classic, Desert, Space).
    - **Statistics**: Dashboard showing wins, win rate, streaks, etc.
    - **Settings**: Volume control, timer toggle, auto-reveal options.

### 2. Gameplay
Real-time collaboration on a shared grid.
- **Mechanics**:
    - **Left-Click**: Reveal tile. (Safe tiles flood-fill).
    - **Right-Click**: Flag a suspected mine.
    - **Right-Click + Drag**: Send a visual signal to teammates.
        - ➡️ **Right**: "On my way"
        - ⬅️ **Left**: "Help me"
        - ⬆️ **Up**: "Don't do it"
        - ⬇️ **Down**: "Confused / Question"
- **Rules**:
    - Numbers indicate mines in the surrounding 3x3 area.
    - Clicking a mine ends the game for **everyone**.
    - Win by revealing all non-mine tiles.

### 3. Game Over
- **Win**: Fireworks animation, leaderboard update, "Congratulations" message.
- **Lose**: Mine explosion animation, "GAME OVER" message.
- **Post-Game**: Options to restart the same board or return to lobby.

### 4. Cheat Mode
Optional assistance features (Toggled via 'C' key).
- **Auto-Flag**: Automatically marks mines.
*Note: Cheat mode availability depends on server settings.*

## Project Structure

```text
Multisweeper/
├── core/ ........................... Game Logic (Framework Agnostic)
│   ├── board.js .................... Grid management & visibility state
│   ├── game.js ..................... Central controller (Rules, Loop, Actions)
│   ├── solver.js ................... Ambiguity detector (Prevents 50/50 guesses)
│   ├── tile.js ..................... Tile type definitions (Empty, Mine, Number)
│   └── *.test.js ................... Unit tests for core logic
├── public/ ......................... Frontend Assets & Logic
│   ├── assets/ ..................... Images, Icons & Spritesheets
│   ├── sounds/ ..................... Audio effects (Explosions, UI)
│   ├── front.js .................... Lobby client logic (Auth, Socket, UI)
│   ├── game.html ................... Game page (Canvas rendering engine)
│   ├── index.html .................. Entry point (Login Modal & Lobby UI)
│   ├── side-menu.html .............. Partial for Settings, Rules, & About
│   └── style.css ................... Global styling (Earth/Rust Theme)
├── db/ ............................. Data Storage
│   └── users.json .................. JSON DB for users & statistics
├── server-game.js .................. Server Entry (Express + Socket.IO setup)
├── package.json .................... Project dependencies & scripts
├── biome.json ...................... Linter/Formatter config
└── README.md ....................... Project Documentation
```

## License

For Academic use only
