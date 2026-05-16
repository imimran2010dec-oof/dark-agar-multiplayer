const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});

const PORT = 3000;
const WORLD_WIDTH = 5000;
const WORLD_HEIGHT = 5000;
const MAX_FOOD = 600; 

app.use(express.static(__dirname + '/public'));

let players = {};
let roomFoods = {
    normal: [],
    zombie: []
};

let zombieTimer = 120;
let zombieInterval = null;
let zombieGameInProgress = false;

function spawnFood(room) {
    roomFoods[room].push({
        id: Math.random().toString(36).substring(2, 9),
        x: Math.random() * WORLD_WIDTH,
        y: Math.random() * WORLD_HEIGHT,
        radius: 5,
        color: `hsl(${Math.random() * 360}, 100%, 50%)`
    });
}

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
        p.radius = 20; 
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
        p.radius = 20;
    });
}

io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    socket.on('joinGame', (data) => {
        let selectedRoom = data.room || "normal";
        socket.join(selectedRoom);

        players[socket.id] = {
            id: socket.id,
            name: data.name || "Guest",
            color: data.color || "#3498db",
            baseColor: data.color || "#3498db", 
            x: WORLD_WIDTH / 2 + (Math.random() * 200 - 100),
            y: WORLD_HEIGHT / 2 + (Math.random() * 200 - 100),
            radius: 20,
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

    // CHAT MESSAGE PIPELINE LAYER
    socket.on('sendChat', (msg) => {
        let p = players[socket.id];
        if (p && msg.trim().length > 0) {
            // Trim down massive messages to prevent spam layout breaks
            let cleanMsg = msg.substring(0, 60);
            io.to(p.room).emit('receiveChat', { name: p.name, text: cleanMsg, isZombie: p.isZombie });
        }
    });

    socket.on('leaveGame', () => {
        if (players[socket.id]) {
            let room = players[socket.id].room;
            socket.leave(room);
            delete players[socket.id];
            console.log(`Player left room: ${socket.id}`);
        }
    });

    socket.on('updateInput', (data) => {
        if (players[socket.id]) {
            players[socket.id].mouseX = data.mouseX;
            players[socket.id].mouseY = data.mouseY;
        }
    });

    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        delete players[socket.id];
    });
});

setInterval(() => {
    let deadPlayers = [];

    Object.keys(players).forEach(id => {
        let p = players[id];
        if (!p || deadPlayers.includes(id)) return;
        
        let currentRoom = p.room;
        let dx = p.mouseX;
        let dy = p.mouseY;
        let dist = Math.hypot(dx, dy);
        
        let baseSpeed = p.isZombie ? 6 : 5; 
        let speed = Math.max(1.5, baseSpeed * (20 / p.radius));

        if (dist > 10) {
            p.x += (dx / dist) * speed;
            p.y += (dy / dist) * speed;
        }

        p.x = Math.max(p.radius, Math.min(WORLD_WIDTH - p.radius, p.x));
        p.y = Math.max(p.radius, Math.min(WORLD_HEIGHT - p.radius, p.y));

        let foods = roomFoods[currentRoom] || [];
        for (let i = foods.length - 1; i >= 0; i--) {
            if (Math.hypot(p.x - foods[i].x, p.y - foods[i].y) < p.radius) {
                let a1 = Math.PI * p.radius * p.radius;
                let a2 = Math.PI * 5 * 5;
                p.radius = Math.sqrt((a1 + a2) / Math.PI);
                
                foods.splice(i, 1);
                spawnFood(currentRoom); 
            }
        }

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
                        io.to(id).emit('killIndicator', { x: other.x, y: other.y, text: "INFECTED!" });
                    }
                }
            } else {
                if (p.radius > other.radius * 1.15 && pDist < p.radius) {
                    let a1 = Math.PI * p.radius * p.radius;
                    let a2 = Math.PI * other.radius * other.radius;
                    p.radius = Math.sqrt((a1 + a2) / Math.PI);

                    io.to(id).emit('earnCoins', 1);
                    io.to(id).emit('killIndicator', { x: other.x, y: other.y, text: "+1 Coin" });

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