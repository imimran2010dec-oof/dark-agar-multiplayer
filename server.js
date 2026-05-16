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
const BOTS_PER_LOBBY = 10; 

app.use(express.static(__dirname + '/public'));

let players = {};
let roomFoods = { normal: [], zombie: [] };

let zombieTimer = 120;
let zombieInterval = null;
let zombieGameInProgress = false;

// REALISTIC GAMER TAG MATRIX BANK
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

function spawnFood(room) {
    roomFoods[room].push({
        id: Math.random().toString(36).substring(2, 9),
        x: Math.random() * WORLD_WIDTH,
        y: Math.random() * WORLD_HEIGHT,
        radius: 6,
        color: `hsl(${Math.random() * 360}, 85%, 60%)`
    });
}

for (let i = 0; i < MAX_FOOD; i++) {
    spawnFood("normal");
    spawnFood("zombie");
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
                x: Math.random() * (WORLD_WIDTH - 200) + 100,
                y: Math.random() * (WORLD_HEIGHT - 200) + 100,
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

maintainBotCount("normal");
maintainBotCount("zombie");

function startZombieMatch() {
    let zombieRoomPlayers = Object.values(players).filter(p => p.room === "zombie");
    if (zombieRoomPlayers.length === 0) return;

    zombieGameInProgress = true;
    zombieTimer = 120;

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

    io.to("zombie").emit('zombieModeStarted', { duration: zombieTimer });

    if (zombieInterval) clearInterval(zombieInterval);
    zombieInterval = setInterval(() => {
        zombieTimer--;
        
        let activeZombiePlayers = Object.values(players).filter(p => p.room === "zombie");
        let zombieAlive = activeZombiePlayers.some(p => p.isZombie);
        let humanAlive = activeZombiePlayers.some(p => !p.isZombie && !p.isBot); 

        if (zombieTimer <= 0 || !zombieAlive || (!humanAlive && Object.values(players).filter(p => !p.isBot && p.room === "zombie").length > 0)) {
            endZombieMatch();
        } else {
            io.to("zombie").emit('timerUpdate', zombieTimer);
        }
    }, 1000);
}

function endZombieMatch() {
    clearInterval(zombieInterval);
    zombieGameInProgress = false;

    let activeZombiePlayers = Object.values(players).filter(p => p.room === "zombie");
    let humanAlive = activeZombiePlayers.some(p => !p.isZombie && !p.isBot);

    if (zombieTimer <= 0 && humanAlive) {
        activeZombiePlayers.forEach(p => {
            if (!p.isZombie && !p.isBot) {
                io.to(p.id).emit('earnCoins', 20);
            }
        });
    }

    io.to("zombie").emit('zombieModeEnded');
    
    activeZombiePlayers.forEach(p => {
        p.isZombie = false;
        p.color = p.baseColor;
        p.radius = 24;
    });
}

io.on('connection', (socket) => {
    socket.on('joinGame', (data) => {
        let selectedRoom = data.room || "normal";
        socket.join(selectedRoom);

        players[socket.id] = {
            id: socket.id,
            name: data.name.trim().substring(0, 12) || "Unnamed Cell",
            color: data.color || "#3498db",
            baseColor: data.color || "#3498db", 
            x: Math.random() * (WORLD_WIDTH - 200) + 100,
            y: Math.random() * (WORLD_HEIGHT - 200) + 100,
            radius: 24,
            mouseX: 0,
            mouseY: 0,
            isZombie: false,
            room: selectedRoom,
            isBot: false
        };
        
        socket.emit('init', { worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT, currentMode: selectedRoom });

        if (selectedRoom === "zombie" && !zombieGameInProgress) {
            startZombieMatch();
        }
    });

    socket.on('sendChat', (msg) => {
        let p = players[socket.id];
        if (p && !p.isBot && msg.trim().length > 0) {
            let cleanMsg = msg.substring(0, 60).replace(/</g, "&lt;");
            io.to(p.room).emit('receiveChat', { name: p.name, text: cleanMsg, isZombie: p.isZombie });
        }
    });

    socket.on('leaveGame', () => {
        if (players[socket.id]) {
            let room = players[socket.id].room;
            socket.leave(room);
            delete players[socket.id];
        }
    });

    socket.on('updateInput', (data) => {
        if (players[socket.id] && !players[socket.id].isBot) {
            players[socket.id].mouseX = data.mouseX;
            players[socket.id].mouseY = data.mouseY;
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
    });
});

// Central Engine Physics Tick Loop (60Hz)
setInterval(() => {
    let deadPlayers = [];

    maintainBotCount("normal");
    maintainBotCount("zombie");

    Object.keys(players).forEach(id => {
        let p = players[id];
        if (!p || deadPlayers.includes(id)) return;
        
        let currentRoom = p.room;

        // BOT TRAJECTORY DECISION ALGORITHMS
        if (p.isBot) {
            p.changeDirTimer--;
            if (p.changeDirTimer <= 0) {
                p.mouseX = Math.random() * 400 - 200;
                p.mouseY = Math.random() * 400 - 200;
                p.changeDirTimer = Math.random() * 120 + 60;
            }
            
            if (Math.random() < 0.0005) {
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

        // Food Processing Loop (With AI Reset Trigger at 300)
        let foods = roomFoods[currentRoom] || [];
        for (let i = foods.length - 1; i >= 0; i--) {
            if (Math.hypot(p.x - foods[i].x, p.y - foods[i].y) < p.radius) {
                
                let playerArea = Math.PI * p.radius * p.radius;
                let foodArea = Math.PI * foods[i].radius * foods[i].radius;
                let nextRadius = Math.sqrt((playerArea + foodArea) / Math.PI);

                // Check if the cell is a bot and if eating this food pushes it over 300 size
                if (p.isBot && nextRadius >= 300) {
                    p.radius = 24; // Pop back to basic size
                    p.x = Math.random() * (WORLD_WIDTH - 200) + 100; // Warp location
                    p.y = Math.random() * (WORLD_HEIGHT - 200) + 100;
                    
                    foods.splice(i, 1);
                    spawnFood(currentRoom);
                } else {
                    p.radius = nextRadius;
                    foods.splice(i, 1);
                    spawnFood(currentRoom); 
                }
            }
        }

        // Cell Contact Collision Matrix
        Object.keys(players).forEach(otherId => {
            if (id === otherId || deadPlayers.includes(otherId) || deadPlayers.includes(id)) return;
            
            let other = players[otherId];
            if (!other || other.room !== currentRoom) return; 

            let pDist = Math.hypot(p.x - other.x, p.y - other.y);

            if (currentRoom === "zombie") {
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

                    // Check if a human eating a bot (or vice-versa) creates a size over 300
                    if (p.isBot && nextRadius >= 300) {
                        p.radius = 24;
                        p.x = Math.random() * (WORLD_WIDTH - 200) + 100;
                        p.y = Math.random() * (WORLD_HEIGHT - 200) + 100;
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

    ["normal", "zombie"].forEach(roomName => {
        let roomPlayers = {};
        Object.keys(players).forEach(id => {
            if (players[id].room === roomName) roomPlayers[id] = players[id];
        });

        io.to(roomName).emit('gameUpdate', { 
            players: roomPlayers, 
            foods: roomFoods[roomName], 
            currentMode: roomName, 
            zombieTimer: zombieTimer 
        });
    });

}, 1000 / 60);

http.listen(PORT, '0.0.0.0', () => console.log(`Game Server actively running on port ${PORT}`));