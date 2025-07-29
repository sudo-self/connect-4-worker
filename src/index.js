export default {
  async fetch(request, env, ctx) {
	const url = new URL(request.url);

	// html
	if (url.pathname === "/") {
	  return new Response(getHTML(), {
		headers: { "Content-Type": "text/html; charset=utf-8" },
	  });
	}

	// icons
	if (url.pathname === "/favicon.ico") {
	  return fetch("https://c4.jessejesse.workers.dev/favicon.ico");
	}
	if (url.pathname === "/favicon.png") {
	  return fetch("https://c4.jessejesse.workers.dev/favicon.png");
	}
	if (url.pathname === "/apple-touch-icon.png") {
	  return fetch("https://c4.jessejesse.workers.dev/apple-touch-icon.png");
	}


	if (url.pathname === "/create") {
	  const id = env.ROOM.idFromName(crypto.randomUUID());
	  return new Response(JSON.stringify({ roomId: id.toString() }), {
		headers: { "Content-Type": "application/json" },
	  });
	}


	if (url.pathname.startsWith("/room/")) {
	  const roomId = url.pathname.split("/room/")[1];
	  const id = env.ROOM.idFromString(roomId);
	  const stub = env.ROOM.get(id);
	  return stub.fetch(request);
	}

	return new Response("Not Found", { status: 404 });
  },
};


export class Room {
  constructor(state, env) {
	this.state = state;
	this.env = env;
	this.clients = new Map();
	this.board = Array.from({ length: 6 }, () => Array(7).fill(0));
	this.turn = 1;
	this.winner = null;
	this.playerNames = {};
	this.playerColors = {};
	this.maxPlayers = 2;
	this.lastActivity = Date.now();
	this.gameStarted = false;
	this.pingIntervals = new Map();
  }

  async fetch(request) {
	if (request.headers.get("Upgrade") !== "websocket") {
	  return new Response("Expected WebSocket", { status: 400 });
	}

	const [client, server] = Object.values(new WebSocketPair());
	server.accept();

	let player = 1;
	while (this.clients.has(player) && player <= this.maxPlayers) player++;
	if (player > this.maxPlayers) {
	  server.send(JSON.stringify({ type: "error", message: "Room full" }));
	  server.close(1000, "Room full");
	  return new Response(null, { status: 101, webSocket: client });
	}

	this.clients.set(player, server);
	this.lastActivity = Date.now();

	if (!this.playerNames[player]) {
	  this.playerNames[player] = `Player ${player}`;
	  this.playerColors[player] = player;
	}

	if (this.clients.size === this.maxPlayers && !this.gameStarted) {
	  this.gameStarted = true;
	  this.turn = 1;
	  this.broadcastUpdate();
	}

	server.send(
	  JSON.stringify({
		type: "init",
		player,
		board: this.board,
		turn: this.turn,
		names: this.playerNames,
		colors: this.playerColors,
		winner: this.winner,
		gameStarted: this.gameStarted,
	  })
	);

	const pingInterval = setInterval(() => {
	  if (Date.now() - this.lastActivity > 30000) {
		server.close(1001, "Inactivity timeout");
	  } else if (server.readyState === WebSocket.OPEN) {
		server.send(JSON.stringify({ type: "ping" }));
	  }
	}, 10000);
	this.pingIntervals.set(server, pingInterval);

	server.addEventListener("message", (e) => {
	  this.lastActivity = Date.now();
	  const data = JSON.parse(e.data);

	  if (data.type === "name") {
		this.playerNames[player] = data.name || `Player ${player}`;
		this.playerColors[player] = data.color || player;
		this.broadcastNamesAndColors();
	  }

	  if (data.type === "move") {
		if (!this.gameStarted || this.winner) return;
		if (this.turn !== player) return;

		const moved = this.handleMove(data.col, player);
		if (moved) {
		  this.advanceTurn();
		  this.broadcastUpdate();
		}
	  }
	});

	const handleClose = () => {
	  clearInterval(pingInterval);
	  this.pingIntervals.delete(server);
	  this.clients.delete(player);
	  delete this.playerNames[player];
	  delete this.playerColors[player];

	  if (this.clients.size < this.maxPlayers) {
		this.gameStarted = false;
	  }
	  this.broadcastUpdate();
	};

	server.addEventListener("close", handleClose);
	server.addEventListener("error", handleClose);

	return new Response(null, { status: 101, webSocket: client });
  }

  handleMove(col, player) {
	if (col < 0 || col >= 7) return false;
	const row = this.getAvailableRow(col);
	if (row === -1) return false;

	this.board[row][col] = this.playerColors[player];

	if (this.checkWinner(row, col)) {
	  this.winner = player;
	} else if (this.isBoardFull()) {
	  this.winner = 0;
	}
	return true;
  }

  getAvailableRow(col) {
	for (let row = 5; row >= 0; row--) {
	  if (this.board[row][col] === 0) return row;
	}
	return -1;
  }

  advanceTurn() {
	if (this.winner) return;
	const players = Array.from(this.clients.keys()).sort();
	const idx = players.indexOf(this.turn);
	this.turn = players[(idx + 1) % players.length];
  }

  broadcastUpdate() {
	const message = JSON.stringify({
	  type: "update",
	  board: this.board,
	  turn: this.turn,
	  winner: this.winner,
	  names: this.playerNames,
	  colors: this.playerColors,
	  gameStarted: this.gameStarted,
	});
	this.sendToAllClients(message);
  }

  broadcastNamesAndColors() {
	const message = JSON.stringify({
	  type: "names",
	  names: this.playerNames,
	  colors: this.playerColors,
	});
	this.sendToAllClients(message);
  }

  sendToAllClients(message) {
	for (const [, ws] of this.clients.entries()) {
	  if (ws.readyState === WebSocket.OPEN) ws.send(message);
	}
  }

  checkWinner(row, col) {
	const color = this.board[row][col];
	const directions = [
	  [0, 1],
	  [1, 0],
	  [1, 1],
	  [1, -1],
	];
	for (const [dr, dc] of directions) {
	  let count = 1;
	  for (
		let r = row + dr, c = col + dc;
		this.isValid(r, c) && this.board[r][c] === color;
		r += dr, c += dc
	  )
		count++;
	  for (
		let r = row - dr, c = col - dc;
		this.isValid(r, c) && this.board[r][c] === color;
		r -= dr, c -= dc
	  )
		count++;
	  if (count >= 4) return true;
	}
	return false;
  }

  isValid(r, c) {
	return r >= 0 && r < 6 && c >= 0 && c < 7;
  }

  isBoardFull() {
	return this.board.every((row) => row.every((cell) => cell !== 0));
  }
}

function getHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
<title>Connect 4 Multiplayer</title>
<link rel="shortcut icon" href="favicon.ico" />
<link rel="icon" type="image/x-icon" sizes="16x16 32x32" href="favicon.ico">
<link rel="apple-touch-icon" sizes="any" href="apple-touch-icon.png">
<style>
  * { margin:0; padding:0; box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  body {
	font-family: 'Segoe UI', Roboto, sans-serif;
	background: linear-gradient(135deg, #4e54c8, #8f94fb);
	min-height:100vh; display:flex; flex-direction:column; align-items:center;
	padding:10px; color:white;
  }

  .splash {
	position:fixed; inset:0; background:rgba(0,0,0,0.85);
	display:flex; flex-direction:column; justify-content:center; align-items:center;
	z-index:10;
	animation: fadeIn 0.5s ease-out;
  }
  .splash h1 { font-size:2.7rem; margin-bottom:20px; text-shadow:0 0 8px #000; }
  .splash input {
	padding:12px; margin-bottom:20px; border:none; border-radius:12px;
	font-size:1rem; width:230px; text-align:center;
	outline:none; box-shadow:0 3px 10px rgba(0,0,0,0.4);
  }
  .splash .color-buttons { display:flex; gap:10px; }
  .splash button {
	padding:14px 20px; font-size:1.1rem; border:none; border-radius:20px;
	cursor:pointer; width:150px; transition: all 0.3s ease;
  }
  .splash button:hover { transform:scale(1.05); }
  .redBtn { background:#ff6b6b; color:white; }
  .yellowBtn { background:#ffd93d; color:black; }

  .game-header { text-align:center; margin:10px 0; }
  h2 { font-size:2rem; text-shadow:0 2px 6px rgba(0,0,0,0.5); }
  #statusText { font-size:1.2rem; margin-top:5px; min-height:1.5rem; }

  .board-container {
	background: rgba(0,0,0,0.35); padding:10px; border-radius:20px;
	box-shadow:0 12px 30px rgba(0,0,0,0.4); width:100%; max-width:700px;
  }
  .board {
	display:grid; grid-template-columns:repeat(7,1fr); gap:6px;
	background:#1a1a2e; padding:10px; border-radius:15px; 
  }
  .column { cursor:pointer; display:flex; flex-direction:column; }
  .cell {
	width:100%; aspect-ratio:1/1; background:#0f3460;
	border-radius:50%; position:relative; margin:2px; overflow:hidden;
  }
  .cell.red::before, .cell.yellow::before {
	content:''; position:absolute; inset:15%; border-radius:50%;
	box-shadow:0 0 10px currentColor;
  }
  .cell.red::before { background:#ff6b6b; color:#ff6b6b; }
  .cell.yellow::before { background:#ffd93d; color:#ffd93d; }

  .reset-btn {
	margin-top:10px; padding:12px 22px; font-size:1rem;
	background:linear-gradient(45deg,#ff6b6b,#ffd93d); border:none;
	border-radius:30px; color:white; cursor:pointer;
	width:100%; max-width:320px; transition: transform 0.2s;
  }
  .reset-btn:hover { transform: scale(1.05); }

  .connection-status {
	position:fixed; top:10px; right:10px; padding:6px 12px; border-radius:15px;
	font-size:0.8rem; background:rgba(0,0,0,0.5);
  }
  .connection-status.connected { background:rgba(40,167,69,0.8); }
  .connection-status.disconnected { background:rgba(220,53,69,0.8); }

  footer { margin-top:auto; padding:8px; font-size:0.9rem; color:rgba(255,255,255,0.8); }

  @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }
  @media (max-width:600px) {
	.splash .color-buttons { flex-direction:column; width:100%; }
	.splash button { width:100%; }
  }
</style>
</head>
<body>
  <div class="splash" id="splash">
	<h1>Connect 4</h1>
	<input id="nameInput" placeholder="Enter your name" maxlength="12"/>
	<div class="color-buttons">
	  <button class="redBtn" data-color="1">Red</button>
	  <button class="yellowBtn" data-color="2">Yellow</button>
	</div>
  </div>
  <div class="connection-status disconnected" id="connectionStatus">Disconnected</div>
  <div class="game-header">
	<h2>Connect 4</h2>
	<p id="statusText">Loading...</p>
  </div>
  <div class="board-container" id="boardContainer">
	<div class="board" id="board"></div>
  </div>
  <button class="reset-btn" id="inviteBtn">send invite</button>

  <script>
	const ROWS = 6, COLS = 7;
	let player = null, turn = null, ws = null, board = [];
	let names = {}, colors = {};
	let winner = null;
	let myColor = null;
	let myName = null;
	let moveLocked = false;
	let gameStarted = false;
	let reconnectAttempts = 0;
	const MAX_RECONNECT_ATTEMPTS = 5;
	const RECONNECT_DELAY = 2000;

	document.querySelectorAll("#splash button").forEach(btn => {
	  btn.addEventListener("click", () => {
		myColor = parseInt(btn.dataset.color);
		myName = document.getElementById("nameInput").value.trim() || "Player";
		if (myName.length > 12) myName = myName.substring(0, 12);
		document.getElementById("splash").style.display = "none";
		init();
	  });
	});

	function createBoardElement() {
	  const boardEl = document.getElementById("board");
	  boardEl.innerHTML = "";
	  for (let col = 0; col < COLS; col++) {
		const column = document.createElement("div");
		column.className = "column";
		column.dataset.col = col;
		column.addEventListener("click", () => makeMove(col));
		column.addEventListener("touchstart", (e) => {
		  e.preventDefault();
		  makeMove(col);
		}, { passive: false });
		for (let row = 0; row < ROWS; row++) {
		  const cell = document.createElement("div");
		  cell.className = "cell";
		  cell.dataset.row = row;
		  cell.dataset.col = col;
		  column.appendChild(cell);
		}
		boardEl.appendChild(column);
	  }
	}

	function renderBoard() {
	  for (let row = 0; row < ROWS; row++) {
		for (let col = 0; col < COLS; col++) {
		  const cell = document.querySelector(\`[data-row="\${row}"][data-col="\${col}"]\`);
		  cell.classList.remove("red","yellow");
		  if (board[row][col] === 1) cell.classList.add("red");
		  if (board[row][col] === 2) cell.classList.add("yellow");
		}
	  }
	  updateStatus();
	}

	function updateStatus() {
	  const status = document.getElementById("statusText");
	  if (!gameStarted) {
		status.textContent = "Waiting for opponent...";
		return;
	  }
	  if (winner) {
		status.textContent = \`\${names[winner]} wins!\`;
		return;
	  }
	  if (turn === player) {
		status.textContent = \`Your turn (\${names[player]})\`;
	  } else {
		status.textContent = \`\${names[turn]}'s turn\`;
	  }
	}

	function makeMove(col) {
	  if (!gameStarted || winner || turn !== player || moveLocked) return;
	  moveLocked = true;
	  try {
		ws.send(JSON.stringify({ type: "move", col }));
	  } catch (error) {
		console.error("Error sending move:", error);
		moveLocked = false;
	  }
	}

	async function init() {
	  createBoardElement();
	  const urlParams = new URLSearchParams(window.location.search);
	  const roomId = urlParams.get("room");

	  if (roomId) {
		connectWebSocket(roomId);
	  } else {
		try {
		  const res = await fetch("/create");
		  const data = await res.json();
		  const newUrl = \`\${window.location.origin}/?room=\${data.roomId}\`;
		  window.history.replaceState({}, "", newUrl);
		  connectWebSocket(data.roomId);
		} catch (error) {
		  console.error("Error creating room:", error);
		  document.getElementById("statusText").textContent = "Failed to create game. Please refresh.";
		}
	  }
	}

	function connectWebSocket(roomId) {
	  updateConnectionStatus(false);
	  const wsUrl = \`\${location.origin.replace("http","ws")}/room/\${roomId}\`;
	  ws = new WebSocket(wsUrl);
	  reconnectAttempts = 0;

	  ws.onopen = () => {
		updateConnectionStatus(true);
		document.getElementById("statusText").textContent = "Connecting...";
	  };
	  
	  ws.onerror = (error) => {
		console.error("WebSocket error:", error);
		updateConnectionStatus(false);
		document.getElementById("statusText").textContent = "Connection error. Trying to reconnect...";
		attemptReconnect(roomId);
	  };
	  
	  ws.onclose = (event) => {
		console.log("WebSocket connection closed:", event.code, event.reason);
		updateConnectionStatus(false);
		if (event.code !== 1000) {
		  document.getElementById("statusText").textContent = "Disconnected. Reconnecting...";
		  attemptReconnect(roomId);
		}
	  };
	  
	  ws.onmessage = (e) => {
		try {
		  const data = JSON.parse(e.data);

		  if (data.type === "init") {
			player = data.player;
			board = data.board;
			turn = data.turn;
			names = data.names || names;
			colors = data.colors || colors;
			winner = data.winner;
			gameStarted = data.gameStarted;
			ws.send(JSON.stringify({ type: "name", name: myName, color: myColor }));
			renderBoard();
			moveLocked = false;
			updateConnectionStatus(true);
		  }

		  if (data.type === "update") {
			board = data.board;
			turn = data.turn;
			names = data.names || names;
			colors = data.colors || colors;
			winner = data.winner;
			gameStarted = data.gameStarted;
			renderBoard();
			moveLocked = (turn !== player || winner);
		  }

		  if (data.type === "names") {
			names = data.names;
			colors = data.colors;
			updateStatus();
		  }
		} catch (error) {
		  console.error("Error processing message:", error);
		}
	  };

	
	  const pingInterval = setInterval(() => {
		if (ws.readyState === WebSocket.OPEN) {
		  try {
			ws.send(JSON.stringify({ type: "ping" }));
		  } catch (error) {
			clearInterval(pingInterval);
		  }
		}
	  }, 15000);

	  window.addEventListener("beforeunload", () => {
		clearInterval(pingInterval);
		if (ws && ws.readyState === WebSocket.OPEN) {
		  ws.close(1000, "User left");
		}
	  });
	}

	function attemptReconnect(roomId) {
	  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
		document.getElementById("statusText").textContent = "Failed to reconnect. Please refresh the page.";
		return;
	  }
	  
	  reconnectAttempts++;
	  setTimeout(() => {
		connectWebSocket(roomId);
	  }, RECONNECT_DELAY * reconnectAttempts);
	}

	function updateConnectionStatus(connected) {
	  const statusElement = document.getElementById("connectionStatus");
	  statusElement.textContent = connected ? "Connected" : "Disconnected";
	  statusElement.className = connected ? "connection-status connected" : "connection-status disconnected";
	}

	document.getElementById("inviteBtn").addEventListener("click", async () => {
	  try {
		if (navigator.share) {
		  await navigator.share({
			title: "Connect 4 Multiplayer",
			text: "Join my Connect 4 game!",
			url: window.location.href,
		  });
		} else {
		  await navigator.clipboard.writeText(window.location.href);
		  alert("Invite link copied to clipboard!");
		}
	  } catch (err) {
		console.error("Sharing failed:", err);
	  }
	});

	
	document.addEventListener("visibilitychange", () => {
	  if (document.visibilityState === "visible") {
		const urlParams = new URLSearchParams(window.location.search);
		const roomId = urlParams.get("room");
		if (roomId && (!ws || ws.readyState !== WebSocket.OPEN)) {
		  connectWebSocket(roomId);
		}
	  }
	});
  </script>

  <footer>c4.JesseJesse.workers.dev</footer>
</body>
</html>`;
}
