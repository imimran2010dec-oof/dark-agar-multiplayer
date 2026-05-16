const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});

const PORT = 3000;
const WORLD_WIDTH = 5000;
const WORLD_HEIGHT = 5000;
const MAX_FOOD = 750; // Increased food density for more active early game scaling

app.use(express.static(__dirname + '/public'));

let players = {};
let roomFoods = { normal: [], zombie: [] };

let zombieTimer = 120;
let zombieInterval = null;
let zombieGameInProgress = false;

function spawnFood(room) {
    roomFoods[room].push({
        id: Math.random().toString(36).substring(2, 9),
        x: Math.random() * WORLD_WIDTH,
        y: Math.random() * WORLD_HEIGHT,
        radius: 6,
        color: `hsl(${Math.random() * 360}, 85%, 60%)` // Vibrant neon spectrum colors
    });
}

// Populate arenas
for (let i = 0; i < MAX_FOOD; i++) {
    spawnFood("normal");
    spawnFood("zombie");
}

function startZombieMatch() {
    let zombieRoomPlayers = Object.values(players).filter(p => p.room === "zombie");
    if (zombieRoomPlayers.length === 0) return;

    zombieGameInProgress = true;
    zombieTimer = 120;

    zombieRoomPlayers.forEach(p => {
        p.isZombie = false;
        p.radius = 24; 
    });

    let zombieCount = Math.max(1, Math.floor(zombieRoomPlayers.length / 2));
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
        let humanAlive = activeZombiePlayers.some(p => !p.isZombie);

        if (zombieTimer <= 0 || !humanAlive || !zombieAlive) {
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
    let humanAlive = activeZombiePlayers.some(p => !p.isZombie);

    if (zombieTimer <= 0 && humanAlive) {
        activeZombiePlayers.forEach(p => {
            if (!p.isZombie) {
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
            room: selectedRoom
        };
        
        socket.emit('init', { worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT, currentMode: selectedRoom });

        if (selectedRoom === "zombie" && !zombieGameInProgress) {
            startZombieMatch();
        }
    });

    socket.on('sendChat', (msg) => {
        let p = players[socket.id];
        if (p && msg.trim().length > 0) {
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
        if (players[socket.id]) {
            players[socket.id].mouseX = data.mouseX;
            players[socket.id].mouseY = data.mouseY;
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
    });
});

// Central Engine Frame Updates (60Hz Grid Sync)
setInterval(() => {
    let deadPlayers = [];

    Object.keys(players).forEach(id => {
        let p = players[id];
        if (!p || deadPlayers.includes(id)) return;
        
        let currentRoom = p.room;
        let dx = p.mouseX;
        let dy = p.mouseY;
        let dist = Math.hypot(dx, dy);
        
        // Physics Formula Improvement: Enhanced exponential velocity friction curves
        let baseSpeed = p.isZombie ? 7.5 : 6.0; 
        let speed = Math.max(1.8, baseSpeed * Math.sqrt(24 / p.radius));

        if (dist > 5) {
            // Apply fluid vector dampening based on mouse target proximity offsets
            let targetX = (dx / dist) * speed;
            let targetY = (dy / dist) * speed;
            
            // Linear velocity interpolation smoothing out network jitters
            p.x += targetX;
            p.y += targetY;
        }

        // Strict Map Boundaries Elastic Deflection Guardrails
        p.x = Math.max(p.radius, Math.min(WORLD_WIDTH - p.radius, p.x));
        p.y = Math.max(p.radius, Math.min(WORLD_HEIGHT - p.radius, p.y));

        // Food Collision Calculations
        let foods = roomFoods[currentRoom] || [];
        for (let i = foods.length - 1; i >= 0; i--) {
            if (Math.hypot(p.x - foods[i].x, p.y - foods[i].y) < p.radius) {
                // Proportional Mass Expansion Optimization
                let playerArea = Math.PI * p.radius * p.radius;
                let foodArea = Math.PI * foods[i].radius * foods[i].radius;
                p.radius = Math.sqrt((playerArea + foodArea) / Math.PI);
                
                foods.splice(i, 1);
                spawnFood(currentRoom); 
            }
        }

        // Inter-Entity Player Contact Assertions
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
                        io.to(id).emit('killIndicator', { x: other.x, y: other.y, text: "➕ INFECTED!" });
                    }
                }
            } else {
                // Size Requirement: Attacking cell must be at least 15% larger in surface diameter
                if (p.radius > other.radius * 1.15 && pDist < p.radius - (other.radius / 3)) {
                    let playerArea = Math.PI * p.radius * p.radius;
                    let targetArea = Math.PI * other.radius * other.radius;
                    p.radius = Math.sqrt((playerArea + targetArea) / Math.PI);

                    io.to(id).emit('earnCoins', 1);
                    io.to(id).emit('killIndicator', { x: other.x, y: other.y, text: "🪙 +1 COIN" });

                    io.to(otherId).emit('died');
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