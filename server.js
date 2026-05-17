const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});

const PORT = 3000;
const WORLD_WIDTH = 5000;
const WORLD_HEIGHT = 5000;
const MAX_FOOD = 750; 
const BOTS_PER_LOBBY = 6; 
const MAX_HUMANS_PER_LOBBY = 15; // Once a room hits 15 real players, a new room opens!

app.use(express.static(__dirname + '/public'));

let players = {};
let roomFoods = {}; // Spawns dynamically per room shard
let activeRooms = {}; // Tracks room meta data (timers, game types)

const botNames = [
    "darkhusky54", "iaintnorobot", "shadow_ninja", "skibidi_slayer", "vortex_glider",
    "alpha_omega", "toxic_bubble", "cell_maximus", "glitch_phantom", "nova_striker",
    "hyper_drive", "quantum_core", "cosmic_dust", "vector_reaper", "blob_ross",
    "sir_eats_alot", "matrix_run", "apex_predator", "nebula_knight", "pixel_perfect",
    "cyber_ghost", "giga_chad_cell", "omega_pulse", "lunar_eclipse", "solar_flare"
];

function getRandomColor() {
    const colors = ["#3498db", "#ff3366", "#00ffcc", "#f1c40f", "#9b59b6", "#e67e22"];
    return colors[Math.floor(Math.random() * colors.length)];
}

// Dynamically initializes food array for a brand new room shard
function initRoomAssets(roomName) {
    if (!roomFoods[roomName]) {
        roomFoods[roomName] = [];
        for (let i = 0; i < MAX_FOOD; i++) {
            spawnFood(roomName);
        }
    }
}

function spawnFood(room) {
    if (!roomFoods[room]) roomFoods[room] = [];
    roomFoods[room].push({
        id: Math.random().toString(36).substring(2, 9),
        x: Math.random() * WORLD_WIDTH,
        y: Math.random() * WORLD_HEIGHT,
        radius: 6,
        color: `hsl(${Math.random() * 360}, 85%, 60%)`
    });
}

// SMART SHARD FINDER FUNCTION
function getAvailableRoom(baseMode) {
    let shardIndex = 0;
    while (true) {
        let roomName = `${baseMode}_shard_${shardIndex}`;
        
        // Count how many human players are currently assigned to this specific room shard
        let humanCount = Object.values(players).filter(p => !p.isBot && p.room === roomName).length;
        
        if (humanCount < MAX_HUMANS_PER_LOBBY) {
            // Initialize room metadata if it's a completely new shard
            if (!activeRooms[roomName]) {
                activeRooms[roomName] = {
                    name: roomName,
                    mode: baseMode,
                    zombieTimer: 120,
                    zombieInterval: null,
                    zombieGameInProgress: false
                };
                initRoomAssets(roomName);
            }
            return roomName;
        }
        shardIndex++; // Check the next room index if this one is packed
    }
}

function maintainBotCount(room) {
    let currentBots = Object.values(players).filter(p => p.isBot && p.room === room);
    
    if (currentBots.length < BOTS_PER_LOBBY) {
        let spawnCount = BOTS_PER_LOBBY - currentBots.length;
        for (let i = 0; i < spawnCount; i++) {
            let randomId = 'bot_' + Math.random().toString(36).substring(2, 9);
            let nameSeed = botNames[Math.floor(Math.random() * botNames.length)];
            let suffix = Math.floor(Math.random() * 90 + 10); 
            
            players[randomId] = {
                id: randomId,
                name: Math.random() > 0.4 ? `${nameSeed}${suffix}` : nameSeed,
                color: getRandomColor(),
                baseColor: getRandomColor(),
                x: Math.random() * (WORLD_WIDTH - 400) + 200,
                y: Math.random() * (WORLD_HEIGHT - 400) + 200,
                radius: Math.random() * 10 + 20, 
                mouseX: Math.random() * 200 - 100, 
                mouseY: Math.random() * 200 - 100,
                isZombie: false,
                room: room,
                isBot: true,
                changeDirTimer: Math.random() * 60 
            };
        }
    }
}

function startZombieMatch(roomName) {
    let room = activeRooms[roomName];
    if (!room || room.zombieGameInProgress) return;

    let zombieRoomPlayers = Object.values(players).filter(p => p.room === roomName);
    if (zombieRoomPlayers.length === 0) return;

    room.zombieGameInProgress = true;
    room.zombieTimer = 120;

    zombieRoomPlayers.forEach(p => {
        p.isZombie = false;
        p.radius = 24; 
    });

    let zombieCount = Math.max(1, Math.floor(zombieRoomPlayers.length / 4)); 
    let shuffled = zombieRoomPlayers.sort(() => 0.5 - Math.random());
    
    for (let i = 0; i < zombieCount; i++) {
        shuffled[i].isZombie = true;
        shuffled[i].color = "#2ecc71";
    }

    io.to(roomName).emit('zombieModeStarted', { duration: room.zombieTimer });

    if (room.zombieInterval) clearInterval(room.zombieInterval);
    room.zombieInterval = setInterval(() => {
        room.zombieTimer--;
        
        let activeZombiePlayers = Object.values(players).filter(p => p.room === roomName);
        let zombieAlive = activeZombiePlayers.some(p => p.isZombie);
        let humanAlive = activeZombiePlayers.some(p => !p.isZombie && !p.isBot); 

        if (room.zombieTimer <= 0 || !zombieAlive || !humanAlive || activeZombiePlayers.length === 0) {
            endZombieMatch(roomName);
        } else {
            io.to(roomName).emit('timerUpdate', room.zombieTimer);
        }
    }, 1000);
}

function endZombieMatch(roomName) {
    let room = activeRooms[roomName];
    if (!room) return;

    clearInterval(room.zombieInterval);
    room.zombieGameInProgress = false;

    let activeZombiePlayers = Object.values(players).filter(p => p.room === roomName);
    let humanAlive = activeZombiePlayers.some(p => !p.isZombie && !p.isBot);

    if (room.zombieTimer <= 0 && humanAlive) {
        activeZombiePlayers.forEach(p => {
            if (!p.isZombie && !p.isBot) {
                io.to(p.id).emit('earnCoins', 20);
            }
        });
    }

    io.to(roomName).emit('zombieModeEnded');
    
    activeZombiePlayers.forEach(p => {
        p.isZombie = false;
        p.color = p.baseColor;
        p.radius = 24;
    });
}

io.on('connection', (socket) => {
    socket.on('joinGame', (data) => {
        let baseMode = data.room || "normal"; 
        let dynamicRoom = getAvailableRoom(baseMode); // Find an open shard room assignment!

        socket.join(dynamicRoom);

        players[socket.id] = {
            id: socket.id,
            name: (data.name && data.name.trim().substring(0, 12)) || "Guest Cell",
            color: data.color || "#3498db",
            baseColor: data.color || "#3498db", 
            x: Math.random() * (WORLD_WIDTH - 400) + 200,
            y: Math.random() * (WORLD_HEIGHT - 400) + 200,
            radius: 24,
            mouseX: 0,
            mouseY: 0,
            isZombie: false,
            room: dynamicRoom,
            isBot: false
        };
        
        socket.emit('init', { worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT, currentMode: baseMode });

        if (baseMode === "zombie" && !activeRooms[dynamicRoom].zombieGameInProgress) {
            startZombieMatch(dynamicRoom);
        }
    });

    socket.on('sendChat', (msg) => {
        let p = players[socket.id];
        if (p && !p.isBot && msg && msg.trim().length > 0) {
            let cleanMsg = msg.substring(0, 60).replace(/</g, "&lt;");
            io.to(p.room).emit('receiveChat', { name: p.name, text: cleanMsg, isZombie: p.isZombie });
        }
    });

    socket.on('leaveGame', () => {
        if (players[socket.id]) {
            let room = players[socket.id].room;
            socket.leave(room);
            delete players[socket.id];
            cleanUpEmptyRoom(room);
        }
    });

    socket.on('updateInput', (data) => {
        if (players[socket.id] && !players[socket.id].isBot && data) {
            players[socket.id].mouseX = data.mouseX || 0;
            players[socket.id].mouseY = data.mouseY || 0;
        }
    });

    socket.on('disconnect', () => {
        if (players[socket.id]) {
            let room = players[socket.id].room;
            delete players[socket.id];
            cleanUpEmptyRoom(room);
        }
    });
});

// Cleans up memory arrays when a dynamic room shard becomes totally empty
function cleanUpEmptyRoom(roomName) {
    let realPlayersInRoom = Object.values(players).filter(p => p.room === roomName && !p.isBot).length;
    if (realPlayersInRoom === 0 && activeRooms[roomName]) {
        if (activeRooms[roomName].zombieInterval) clearInterval(activeRooms[roomName].zombieInterval);
        
        // Wipe all bots belonging to this empty ghost shard room
        Object.keys(players).forEach(id => {
            if (players[id].room === roomName && players[id].isBot) {
                delete players[id];
            }
        });

        delete roomFoods[roomName];
        delete activeRooms[roomName];
    }
}

// Global Physics and Broadcaster Tick Loop
setInterval(() => {
    let deadPlayers = [];

    // Run AI maintain updates for all currently active dynamic shards
    Object.keys(activeRooms).forEach(roomName => {
        maintainBotCount(roomName);
    });

    Object.keys(players).forEach(id => {
        let p = players[id];
        if (!p || deadPlayers.includes(id)) return;
        
        let currentRoom = p.room;

        if (p.isBot) {
            p.changeDirTimer--;
            if (p.changeDirTimer <= 0) {
                p.mouseX = Math.random() * 400 - 200;
                p.mouseY = Math.random() * 400 - 200;
                p.changeDirTimer = Math.random() * 90 + 45;
            }
            
            if (Math.random() < 0.001) {
                const phrases = ["gg", "close one!", "wow lag", "team?", "bruh", "nice skin", "out of my way"];
                let randPhrase = phrases[Math.floor(Math.random() * phrases.length)];
                io.to(p.room).emit('receiveChat', { name: p.name, text: randPhrase, isZombie: p.isZombie });
            }
        }

        let dx = p.mouseX;
        let dy = p.mouseY;
        let dist = Math.hypot(dx, dy);
        
        let baseSpeed = p.isZombie ? 7.5 : 6.0; 
        let speed = Math.max(1.8, baseSpeed * Math.sqrt(24 / p.radius));

        if (dist > 5) {
            p.x += (dx / dist) * speed;
            p.y += (dy / dist) * speed;
        }

        p.x = Math.max(p.radius, Math.min(WORLD_WIDTH - p.radius, p.x));
        p.y = Math.max(p.radius, Math.min(WORLD_HEIGHT - p.radius, p.y));

        // Food Processing Loop per specific shard array
        let foods = roomFoods[currentRoom] || [];
        for (let i = foods.length - 1; i >= 0; i--) {
            if (Math.hypot(p.x - foods[i].x, p.y - foods[i].y) < p.radius) {
                
                let playerArea = Math.PI * p.radius * p.radius;
                let foodArea = Math.PI * foods[i].radius * foods[i].radius;
                let nextRadius = Math.sqrt((playerArea + foodArea) / Math.PI);

                if (p.isBot && nextRadius >= 300) {
                    p.radius = 24; 
                    p.x = Math.random() * (WORLD_WIDTH - 400) + 200; 
                    p.y = Math.random() * (WORLD_HEIGHT - 400) + 200;
                    
                    foods.splice(i, 1);
                    spawnFood(currentRoom);
                } else {
                    p.radius = nextRadius;
                    foods.splice(i, 1);
                    spawnFood(currentRoom); 
                }
            }
        }

        // Cell Collision Checks (Only looks at players inside the exact same dynamic shard!)
        Object.keys(players).forEach(otherId => {
            if (id === otherId || deadPlayers.includes(otherId) || deadPlayers.includes(id)) return;
            
            let other = players[otherId];
            if (!other || other.room !== currentRoom) return; 

            let pDist = Math.hypot(p.x - other.x, p.y - other.y);
            let roomMeta = activeRooms[currentRoom];

            if (roomMeta && roomMeta.mode === "zombie") {
                if (pDist < (p.radius + other.radius)) {
                    if (p.isZombie && !other.isZombie) {
                        other.isZombie = true;
                        other.color = "#2ecc71";
                        if (!p.isBot) io.to(id).emit('killIndicator', { x: other.x, y: other.y, text: "➕ INFECTED!" });
                    }
                }
            } else {
                if (p.radius > other.radius * 1.15 && pDist < p.radius - (other.radius / 3)) {
                    let playerArea = Math.PI * p.radius * p.radius;
                    let targetArea = Math.PI * other.radius * other.radius;
                    let nextRadius = Math.sqrt((playerArea + targetArea) / Math.PI);

                    if (p.isBot && nextRadius >= 300) {
                        p.radius = 24;
                        p.x = Math.random() * (WORLD_WIDTH - 400) + 200;
                        p.y = Math.random() * (WORLD_HEIGHT - 400) + 200;
                    } else {
                        p.radius = nextRadius;
                    }

                    if (!p.isBot) {
                        io.to(id).emit('earnCoins', 1);
                        io.to(id).emit('killIndicator', { x: other.x, y: other.y, text: "🪙 +1 COIN" });
                    }

                    if (!other.isBot) {
                        io.to(otherId).emit('died');
                    }
                    deadPlayers.push(otherId);
                }
            }
        });
    });

    deadPlayers.forEach(id => { delete players[id]; });

    // Send isolated, smooth game updates to every single specific dynamic room shard independently
    Object.keys(activeRooms).forEach(roomName => {
        let roomMeta = activeRooms[roomName];
        let roomPlayers = {};
        
        Object.keys(players).forEach(id => {
            if (players[id].room === roomName) roomPlayers[id] = players[id];
        });

        io.to(roomName).emit('gameUpdate', { 
            players: roomPlayers, 
            foods: roomFoods[roomName] || [], 
            currentMode: roomMeta.mode, 
            zombieTimer: roomMeta.zombieTimer 
        });
    });

}, 1000 / 30);

http.listen(PORT, '0.0.0.0', () => console.log(`Auto-Sharding Sharded Game Server running on port ${PORT}`));