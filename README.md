# Live Location Tracker

## Project Overview
A real-time location tracking application that allows authenticated users to share and view each other's live locations on a shared interactive map. The application utilizes a modern event-driven architecture, leveraging WebSockets for real-time communication and Apache Kafka for asynchronous event stream processing and data persistence.

## Tech Stack
*   **Frontend:** HTML5, CSS3 (Vanilla), JavaScript, [Leaflet.js](https://leafletjs.com/) (Maps), OpenStreetMap (Tiles).
*   **Backend:** [Node.js](https://nodejs.org/), Express.js.
*   **Real-time Communication:** [Socket.IO](https://socket.io/).
*   **Message Broker:** [Apache Kafka](https://kafka.apache.org/) (via `kafkajs`).
*   **Database:** [PostgreSQL](https://www.postgresql.org/) (via `pg`).
*   **Authentication:** JWT (JSON Web Tokens), `bcryptjs`.
*   **Infrastructure/Containers:** Docker & Docker Compose (for local Kafka, Zookeeper, and PostgreSQL).

## Setup Steps

### 1. Prerequisites
Ensure you have the following installed on your machine:
*   [Node.js](https://nodejs.org/) (v16+)
*   [Docker Desktop](https://www.docker.com/products/docker-desktop/)
*   Git

### 2. Local Installation
Clone the repository and install dependencies:
```bash
npm install
```

### 3. Start Infrastructure (Docker)
Start the local PostgreSQL database, Kafka, and Zookeeper containers:
```bash
docker-compose up -d
```

### 4. Run the Application
Start the Node.js server in development mode. The database tables and Kafka topics will be initialized automatically.
```bash
npm run dev
```

Open `http://localhost:3000` in your web browser.

## Environment Variables
Create a `.env` file in the root directory. Below are the supported environment variables:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | Port for the Node server to run on. | `3000` |
| `DB_USER` | Postgres username (used if DATABASE_URL is absent). | `user` |
| `DB_PASSWORD` | Postgres password. | `password` |
| `DB_NAME` | Postgres database name. | `location_db` |
| `DB_HOST` | Postgres host. | `localhost` |
| `DB_PORT` | Postgres port. | `5432` |
| `KAFKA_BROKER` | Kafka bootstrap server address. | `localhost:9092` |
| `KAFKA_SASL_USERNAME`| Kafka SASL Username (for production e.g., Upstash). | - |
| `KAFKA_SASL_PASSWORD`| Kafka SASL Password. | - |
| `JWT_SECRET` | Secret key used to sign JSON Web Tokens. | `supersecretkey` |

## OIDC Auth Setup
Currently, the application implements its own authentication flow using local PostgreSQL storage and JWT. 

**To migrate to an OIDC provider (like Auth0, Okta, or Keycloak):**
1.  **Frontend:** Replace the local Login/Signup cards with the provider's SDK (e.g., `@auth0/auth0-spa-js`). Redirect the user to the provider's login page and retrieve the `id_token` or `access_token` upon successful redirect.
2.  **Backend Middleware:** Replace the current local JWT verification in `server.js` (inside `io.use()`) with an OIDC token verification library like `jwks-rsa`. It will fetch the public keys from your OIDC provider to validate the incoming token.
3.  **Database:** Modify the `users` table to reference the external `sub` (subject identifier) provided by OIDC instead of maintaining local passwords.

## Socket Event Flow
1.  **Connection (`connection`):** Client connects providing a JWT in the `auth` payload. The server validates the token.
2.  **Initial State (`initial_locations`):** Server immediately emits an `initial_locations` event to the newly connected client, containing a dictionary of the last known coordinates of all active users.
3.  **Location Update (`update_location`):** The client's browser Geolocation API triggers and emits `update_location` with `latitude` and `longitude`. The server forwards this payload to the Kafka producer.
4.  **Broadcast (`location_update`):** The Realtime Kafka Consumer reads the new coordinate payload and triggers `io.emit('location_update')` to broadcast it to all connected sockets.
5.  **Disconnection (`disconnect`):** The server detects the dropped socket and publishes a `user_offline` event to Kafka, which is then broadcasted to clients to remove the marker from the map.

## Kafka Event Flow
The architecture uses a single topic `location_updates` and two independent consumer groups.

*   **Producer (`producer`):** The Express server publishes standard location payloads and offline events into the `location_updates` topic.
*   **Consumer Group A (`group-realtime`):** Dedicated to real-time WebSocket broadcasting. It listens to the topic and triggers `io.emit` to instantly push coordinates to live users. It updates an in-memory cache to sync new users quickly.
*   **Consumer Group B (`group-persistence`):** Dedicated to data storage. It listens to the topic and asynchronously executes `INSERT INTO location_history` queries to the PostgreSQL database, ignoring temporary events like `user_offline`.


## Assumptions and Limitations
*   **HTTPS Requirement:** The browser's `navigator.geolocation` API requires a secure context (HTTPS) to function outside of `localhost`. For production deployment, SSL/TLS must be configured (e.g., via a reverse proxy like Nginx or a PaaS like Render).
*   **In-Memory State:** The Node.js server maintains an in-memory dictionary of `userLocations` for quick syncing. This prevents the backend from scaling horizontally to multiple instances without adding a shared state store (like Redis) and a Socket.IO Redis Adapter.
*   **Historical Playback:** While all coordinate data is persisted accurately to PostgreSQL, there is currently no frontend UI to view historical location playback. 
*   **Leaflet Tiles:** The application utilizes public carto maps. High traffic may result in rate-limiting from the tile provider. For enterprise scaling, a commercial map token (e.g., Mapbox, MapTiler) is recommended.
