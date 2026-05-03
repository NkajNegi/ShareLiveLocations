let map, socket, currentUser;
let trackedUserId = null;
const markers = {};
const userListEl = document.getElementById('user-list');

// Initialize Map
function initMap() {
    map = L.map('map', {
        zoomControl: false
    }).setView([0, 0], 2);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '©OpenStreetMap, ©CartoDB'
    }).addTo(map);

    L.control.zoom({
        position: 'bottomright'
    }).addTo(map);

    // Stop tracking if user manually moves the map
    map.on('movestart', (e) => {
        if (e.hard) return; // Ignore programmatic moves
        // We only stop tracking if the move was triggered by user interaction
        // Leaflet doesn't easily distinguish 'user' vs 'programmatic' in movestart
        // so we check if the action was a drag or zoom via other means if possible.
    });

    // Better way: stop tracking on drag or zoom
    map.on('dragstart zoomstart', () => {
        if (trackedUserId) {
            console.log(`Stopped tracking ${trackedUserId}`);
            trackedUserId = null;
            document.querySelectorAll('.user-item').forEach(el => el.classList.remove('tracking'));
        }
    });
}

// UI Toggles
function showRegister() {
    document.getElementById('login-card').classList.add('hidden');
    document.getElementById('register-card').classList.remove('hidden');
}

function showLogin() {
    document.getElementById('register-card').classList.add('hidden');
    document.getElementById('login-card').classList.remove('hidden');
}

async function handleRegister() {
    const username = document.getElementById('reg-username').value;
    const password = document.getElementById('reg-password').value;
    const errorEl = document.getElementById('reg-error');

    if (!username || !password) {
        errorEl.innerText = "Please fill all fields";
        errorEl.classList.remove('hidden');
        return;
    }

    try {
        const res = await fetch('/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok) {
            alert('Account created! You can now login.');
            showLogin();
        } else {
            errorEl.innerText = data.error || 'Registration failed';
            errorEl.classList.remove('hidden');
        }
    } catch (err) {
        errorEl.innerText = "Connection failed";
        errorEl.classList.remove('hidden');
    }
}

async function handleLogin() {
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');

    if (!username || !password) {
        errorEl.innerText = "Please fill all fields";
        errorEl.classList.remove('hidden');
        return;
    }

    try {
        const res = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('username', data.username);
            startApp(data.token, data.username);
        } else {
            errorEl.innerText = data.error || 'Login failed';
            errorEl.classList.remove('hidden');
        }
    } catch (err) {
        errorEl.innerText = "Login failed";
        errorEl.classList.remove('hidden');
    }
}

function handleLogout() {
    localStorage.clear();
    location.reload();
}

function createMarkerIcon(isSelf) {
    return L.divIcon({
        className: 'custom-div-icon',
        html: `<div class="custom-marker ${isSelf ? 'self' : ''}"></div>`,
        iconSize: [30, 42],
        iconAnchor: [15, 42]
    });
}

function updateUserList() {
    userListEl.innerHTML = '';
    Object.keys(markers).forEach(uId => {
        const isSelf = uId === currentUser;
        const item = document.createElement('div');
        item.className = `user-item ${isSelf ? 'self' : ''} ${trackedUserId === uId ? 'tracking' : ''}`;
        item.onclick = () => {
            trackedUserId = uId;
            const latLng = markers[uId].marker.getLatLng();
            map.flyTo(latLng, 15, { duration: 1 });
            markers[uId].marker.openPopup();
            updateUserList(); // Refresh to show tracking style
        };

        const initial = uId.charAt(0).toUpperCase();
        item.innerHTML = `
            <div class="user-avatar" style="background: ${isSelf ? 'var(--primary)' : '#64748b'}">${initial}</div>
            <div class="user-info">
                <div class="user-name">${uId} ${isSelf ? '(You)' : ''}</div>
                <div class="user-status">
                    <div class="status-dot"></div>
                    ${trackedUserId === uId ? 'Following...' : 'Online'}
                </div>
            </div>
        `;
        userListEl.appendChild(item);
    });
}

function handleLocationUpdate(data) {
    const { userId, latitude, longitude } = data;
    if (!latitude || !longitude) return;

    if (markers[userId]) {
        markers[userId].marker.setLatLng([latitude, longitude]);
        markers[userId].lastUpdate = Date.now();
        
        // Follow if tracked
        if (userId === trackedUserId) {
            map.panTo([latitude, longitude]);
        }
    } else {
        const isSelf = userId === currentUser;
        const marker = L.marker([latitude, longitude], {
            icon: createMarkerIcon(isSelf)
        }).addTo(map)
          .bindPopup(`<b>${userId}</b>${isSelf ? ' (You)' : ''}`);

        markers[userId] = { marker, lastUpdate: Date.now() };
        updateUserList();
    }
}

function startApp(token, username) {
    currentUser = username;
    document.getElementById('auth-container').classList.add('hidden');
    document.getElementById('sidebar').classList.remove('hidden');

    socket = io({
        auth: { token }
    });

    socket.on('connect', () => {
        console.log('Connected to real-time network');
        startTracking();
    });

    socket.on('initial_locations', (locations) => {
        Object.values(locations).forEach(data => {
            handleLocationUpdate(data);
        });
        
        // Focus on SELF initially if available
        if (locations[currentUser]) {
            const { latitude, longitude } = locations[currentUser];
            map.setView([latitude, longitude], 13);
            trackedUserId = currentUser;
            updateUserList();
        } else if (Object.keys(locations).length > 0) {
            // Otherwise focus on first available
            const firstUser = Object.values(locations)[0];
            map.setView([firstUser.latitude, firstUser.longitude], 13);
        }
    });

    socket.on('location_update', (data) => {
        handleLocationUpdate(data);
    });

    socket.on('user_offline', (data) => {
        const { userId } = data;
        if (markers[userId]) {
            map.removeLayer(markers[userId].marker);
            delete markers[userId];
            if (trackedUserId === userId) trackedUserId = null;
            updateUserList();
        }
    });

    // Cleanup stale markers
    setInterval(() => {
        const now = Date.now();
        let changed = false;
        Object.keys(markers).forEach(uId => {
            if (uId !== currentUser && (now - markers[uId].lastUpdate > 30000)) {
                map.removeLayer(markers[uId].marker);
                delete markers[uId];
                if (trackedUserId === uId) trackedUserId = null;
                changed = true;
            }
        });
        if (changed) updateUserList();
    }, 10000);
}

function startTracking() {
    if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition((position) => {
            const { latitude, longitude } = position.coords;
            socket.emit('update_location', { latitude, longitude });
        }, (err) => {
            console.error('Geolocation Error:', err);
        }, {
            enableHighAccuracy: true,
            maximumAge: 5000,
            timeout: 5000
        });
    }
}

window.onload = () => {
    initMap();
    const token = localStorage.getItem('token');
    const username = localStorage.getItem('username');
    if (token && username) {
        startApp(token, username);
    }
};