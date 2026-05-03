require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { initDb, query } = require('./db');
const { producer, consumerRealtime, consumerPersistence, initKafka } = require('./kafka');

const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per window
  message: { error: 'Too many requests from this IP, please try again after 15 minutes' }
});

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

app.post('/register', authLimiter, async (req, res) => {
  const { username, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await query('INSERT INTO users (username, password) VALUES ($1, $2)', [username, hashedPassword]);
    res.status(201).json({ message: 'User registered successfully' });
  } catch (err) {
    if (err.code === '23505') { // Unique constraint violation
      return res.status(400).json({ error: 'Username already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/login', authLimiter, async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];
    if (user && await bcrypt.compare(password, user.password)) {
      const token = jwt.sign({ userId: user.username }, JWT_SECRET, { expiresIn: '1h' });
      res.json({ token, username: user.username });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Socket.IO Authentication Middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error("Authentication error: Token missing"));
  }
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return next(new Error("Authentication error: Invalid token"));
    socket.userId = decoded.userId;
    next();
  });
});

const TOPIC = 'location_updates';
const userLocations = {}; // In-memory cache for latest positions
const userLastUpdateTime = {}; // For Socket.IO rate limiting

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.userId} (Socket: ${socket.id})`);

  // Send currently known locations to the new user
  socket.emit('initial_locations', userLocations);

  socket.on('update_location', async (data) => {
    const now = Date.now();
    const lastUpdate = userLastUpdateTime[socket.userId] || 0;
    
    // Rate limit: Allow 1 update per second maximum (1000ms)
    if (now - lastUpdate < 1000) {
      return; // Ignore updates that are too frequent
    }
    userLastUpdateTime[socket.userId] = now;

    const payload = {
      userId: socket.userId,
      latitude: data.latitude,
      longitude: data.longitude,
      timestamp: new Date().toISOString()
    };

    // Update local cache immediately for faster syncing
    userLocations[socket.userId] = payload;

    try {
      await producer.send({
        topic: TOPIC,
        messages: [{ value: JSON.stringify(payload) }],
      });
    } catch (err) {
      console.error('Failed to publish to Kafka', err);
    }
  });

  socket.on('disconnect', async () => {
    console.log(`User disconnected: ${socket.userId}`);
    delete userLocations[socket.userId];
    delete userLastUpdateTime[socket.userId];
    
    const offlinePayload = {
      userId: socket.userId,
      type: 'user_offline',
      timestamp: new Date().toISOString()
    };
    try {
      await producer.send({
        topic: TOPIC,
        messages: [{ value: JSON.stringify(offlinePayload) }],
      });
    } catch (err) {
      console.error('Failed to publish offline event to Kafka', err);
    }
  });
});

// Consumer Group A: Real-Time Broadcasting
const startRealtimeConsumer = async () => {
  await consumerRealtime.subscribe({ topic: TOPIC, fromBeginning: false });
  await consumerRealtime.run({
    eachMessage: async ({ message }) => {
      try {
        const data = JSON.parse(message.value.toString());
        if (data.type === 'user_offline') {
          delete userLocations[data.userId];
          io.emit('user_offline', data);
        } else {
          userLocations[data.userId] = data; // Update cache from Kafka stream
          io.emit('location_update', data);
        }
      } catch (err) {
        console.error('Error in realtime consumer:', err);
      }
    },
  });
};

// Consumer Group B: Persistence
const startPersistenceConsumer = async () => {
  await consumerPersistence.subscribe({ topic: TOPIC, fromBeginning: false });
  await consumerPersistence.run({
    eachMessage: async ({ message }) => {
      const data = JSON.parse(message.value.toString());
      if (data.type === 'user_offline') return; // Don't persist offline events in location history

      const { userId, latitude, longitude, timestamp } = data;
      try {
        await query(
          'INSERT INTO location_history (user_id, latitude, longitude, timestamp) VALUES ($1, $2, $3, $4)',
          [userId, latitude, longitude, timestamp]
        );
      } catch (err) {
        console.error('Failed to persist location update', err);
      }
    },
  });
};

const startServer = async () => {
  await initDb();
  await initKafka();
  
  startRealtimeConsumer().catch(console.error);
  startPersistenceConsumer().catch(console.error);

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

startServer().catch(err => {
  console.error('Server failed to start', err);
  process.exit(1);
});
