require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const http     = require('http');

const authRoutes            = require('./routes/auth.routes');
const ecoRoutes             = require('./routes/eco.routes');
const binRoutes             = require('./routes/binScanRoutes');
const tierRoutes            = require('./routes/tiersRoutes');
const collectorReportRoutes = require('./routes/collectorReportRoutes');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3000;

// ── WebSocket setup (optional — gracefully skipped if socket.io not installed) ─
let io = null;
try {
  const { Server } = require('socket.io');
  io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });
  app.set('io', io);
  io.on('connection', (socket) => {
    console.log(`WS client connected: ${socket.id}`);
    socket.on('disconnect', () => console.log(`WS client disconnected: ${socket.id}`));
  });
  console.log('WebSocket (socket.io) enabled.');
} catch {
  console.log('socket.io not installed — WebSocket disabled. Run: npm install socket.io');
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',               authRoutes);
app.use('/api/eco',                ecoRoutes);
app.use('/api/bins',               binRoutes);
app.use('/api/tiers',              tierRoutes);
app.use('/api/collector-reports',  collectorReportRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'BE-SMART API is running' });
});

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`BE-SMART API running on port ${PORT}`);
});
