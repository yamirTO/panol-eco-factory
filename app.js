// ============================================================
//  CONFIGURACIÓN - CONECTADO AL SERVIDOR EN RENDER
// ============================================================
const API_URL = 'https://panol-eco-factory.onrender.com';

// ============================================================
//  USUARIOS LOCALES (para pruebas sin servidor)
// ============================================================
const USUARIOS_LOCALES = {
    admin: { password: 'admin123', rol: 'admin' },
    empleado1: { password: 'empleado123', rol: 'empleado' },
    empleado2: { password: 'empleado123', rol: 'empleado' }
};

// ============================================================
//  VARIABLES GLOBALES
// ============================================================
let token = null;
let currentUser = null;
let items = [];
let movs = [];
let currentTab = 'stock';
let currentTipo = 'SALIDA';
let importData = null;
let isCreatingNewItem = false;
let selectedItemCodigo = null;
let editingItemCodigo = null;
let activeKpiFilter = 'todos';
let pendingRestoreData = null;
let categoriasExpandidas = {};
let pingContador = 0;
let pingInterval = null;

// IMÁGENES TEMPORALES (para edición)
let imagenesTemporales = [];

// CARROUSEL INTERVALS
let carrouselIntervals = {};

// PLANILLAS
let planillas = JSON.parse(localStorage.getItem('panol_planillas')) || [];
let planillasInterval = null;

// ÓRDENES DE TRABAJO
let ordenes = JSON.parse(localStorage.getItem('ot_ordenes_v2')) || [];
let maquinasList = JSON.parse(localStorage.getItem('ot_maquinas')) || ['Torno CNC-12', 'Fresadora', 'Prensa hidráulica', 'Compresor', 'Cinta transportadora'];
let tecnicosList = JSON.parse(localStorage.getItem('ot_tecnicos')) || ['Juan Pérez', 'María Gómez', 'Carlos López', 'Ana Martínez'];
let modulosList = JSON.parse(localStorage.getItem('ot_modulos')) || ['Cabezal', 'Panel de control', 'Motor', 'Bomba hidráulica', 'Sistema eléctrico'];

// ============================================================
//  DOM REFERENCIAS
// ============================================================
const $ = (id) => document.getElementById(id);

// ============================================================
//  FUNCIÓN DE FECHA
// ============================================================
function fechaToMMDDAA(fechaStr) {
    if (!fechaStr) return '';
    if (fechaStr.includes('-')) {
        const partes = fechaStr.split('-');
        if (partes.length === 3) {
            const año = partes[0].slice(-2);
            return partes[1] + '/' + partes[2] + '/' + año;
        }
    }
    return fechaStr;
}

// ============================================================
//  FUNCIONES DE STOCK
// ============================================================
function stockActual(item) {
    return movs.reduce((acc, m) => {
        if (m.codigo !== item.codigo) return acc;
        if (m.tipo === 'ENTRADA' || m.tipo === 'DEVOLUCIÓN') return acc + Number(m.cantidad);
        if (m.tipo === 'SALIDA') return acc - Number(m.cantidad);
        return acc;
    }, item.inicial || 0);
}

function esCritico(item) {
    return item.critico && item.critico.toUpperCase() === 'SI';
}

function estadoItem(actual, minimo, item) {
    if (actual <= 0) return { label: '⛔ Sin stock', color: '#C62828', bg: '#FFCDD2' };
    if (esCritico(item)) return { label: '🔴 Crítico', color: '#C62828', bg: '#FFEBEE' };
    if (actual < minimo) return { label: '🟡 Reponer', color: '#E65100', bg: '#FFF8E1' };
    return { label: '🟢 OK', color: '#2E7D32', bg: '#E8F5E9' };
}

// ============================================================
//  API HELPER - VERSIÓN LOCAL (sin logout automático)
// ============================================================
function apiCall(endpoint, options = {}) {
    if (currentUser && USUARIOS_LOCALES[currentUser.username]) {
        if (endpoint === '/api/items') return Promise.resolve(items);
        if (endpoint === '/api/movimientos') return Promise.resolve(movs);
        if (endpoint === '/api/stats') {
            return Promise.resolve({
                totalItems: items.length,
                sinStock: items.filter(i => stockActual(i) <= 0).length,
                criticos: items.filter(i => esCritico(i)).length,
                totalMovimientos: movs.length,
                categorias: [...new Set(items.map(i => i.categoria || 'Sin categoría'))].length
            });
        }
        if (endpoint === '/api/planillas') return Promise.resolve(planillas);
        if (endpoint.startsWith('/api/planillas/') && options.method === 'DELETE') return Promise.resolve({ success: true });
        if (endpoint === '/api/planillas' && options.method === 'POST') {
            const body = JSON.parse(options.body);
            const nuevaPlanilla = {
                id: Date.now(),
                ...body,
                usuario: currentUser.username,
                timestamp: new Date().toISOString()
            };
            planillas.unshift(nuevaPlanilla);
            localStorage.setItem('panol_planillas', JSON.stringify(planillas));
            return Promise.resolve({ success: true, planilla: nuevaPlanilla });
        }
        if (endpoint === '/api/backup') return Promise.resolve({ items, movimientos: movs, planillas, usuarios: USUARIOS_LOCALES });
        if (endpoint.startsWith('/api/items/') && options.method === 'PUT') {
            const body = JSON.parse(options.body);
            const idx = items.findIndex(i => i.codigo === endpoint.split('/').pop());
            if (idx !== -1) items[idx] = body;
            return Promise.resolve({ success: true });
        }
        return Promise.resolve({ success: true });
    }

    return fetch(`${API_URL}${endpoint}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token,
                ...(options.headers || {})
            }
        })
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                if (data.error === 'Token inválido' || data.error === 'Token no proporcionado') {
                    if (!currentUser || !USUARIOS_LOCALES[currentUser?.username]) {
                        showToast('Sesión expirada. Iniciá sesión nuevamente.', false);
                    }
                }
                throw new Error(data.error);
            }
            return data;
        });
}

// ============================================================
//  AUTENTICACIÓN
// ============================================================
function doLogin() {
    const username = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value.trim();

    if (!username || !password) {
        showLoginError('Ingresá usuario y contraseña');
        return;
    }

    showLoading(true);

    if (USUARIOS_LOCALES[username] && USUARIOS_LOCALES[username].password === password) {
        showLoading(false);
        const data = {
            success: true,
            token: 'token_local_' + username + '_' + Date.now(),
            username: username,
            rol: USUARIOS_LOCALES[username].rol
        };
        token = data.token;
        currentUser = data;
        localStorage.setItem('panol_token', token);
        localStorage.setItem('panol_user', JSON.stringify({ username: data.username, rol: data.rol }));

        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('appScreen').style.display = 'flex';
        document.getElementById('userNameDisplay').textContent = '👤 ' + data.username;
        const rolSpan = document.getElementById('userRolDisplay');
        rolSpan.textContent = data.rol;
        rolSpan.className = 'rol ' + (data.rol === 'admin' ? 'admin-badge' : 'empleado-badge');

        if (data.rol === 'admin') {
            document.getElementById('adminTabBtn').style.display = 'block';
            document.getElementById('planillasRecibidasBtn').style.display = 'block';
            document.getElementById('ordenesBtn').style.display = 'block';
        } else {
            document.getElementById('adminTabBtn').style.display = 'none';
            document.getElementById('planillasRecibidasBtn').style.display = 'none';
            document.getElementById('ordenesBtn').style.display = 'none';
        }

        cargarDatosLocales();
        iniciarPing();
        initPlanillaFecha();
        initOrdenes();
        cargarSelectoresOT();
        showToast('✅ Bienvenido ' + data.username);
        return;
    }

    fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    })
    .then(res => res.json())
    .then(data => {
        showLoading(false);
        if (data.error) {
            showLoginError(data.error);
            return;
        }
        token = data.token;
        currentUser = data;
        localStorage.setItem('panol_token', token);
        localStorage.setItem('panol_user', JSON.stringify({ username: data.username, rol: data.rol }));

        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('appScreen').style.display = 'flex';
        document.getElementById('userNameDisplay').textContent = '👤 ' + data.username;
        const rolSpan = document.getElementById('userRolDisplay');
        rolSpan.textContent = data.rol;
        rolSpan.className = 'rol ' + (data.rol === 'admin' ? 'admin-badge' : 'empleado-badge');

        if (data.rol === 'admin') {
            document.getElementById('adminTabBtn').style.display = 'block';
            document.getElementById('planillasRecibidasBtn').style.display = 'block';
            document.getElementById('ordenesBtn').style.display = 'block';
        } else {
            document.getElementById('adminTabBtn').style.display = 'none';
            document.getElementById('planillasRecibidasBtn').style.display = 'none';
            document.getElementById('ordenesBtn').style.display = 'none';
        }

        loadDataFromServer();
        iniciarPing();
        initPlanillaFecha();
        cargarPlanillasDesdeServidor().then(() => {
            iniciarPollingPlanillas();
        });
        initOrdenes();
        cargarSelectoresOT();
        showToast('✅ Bienvenido ' + data.username);
    })
    .catch(err => {
        showLoading(false);
        showLoginError('Error al conectar con el servidor');
        console.error(err);
    });
}

function doLogout() {
    detenerPollingPlanillas();
    if (token) {
        fetch(`${API_URL}/api/logout`, { method: 'POST', headers: { 'Authorization': token } }).catch(() => {});
    }
    token = null;
    currentUser = null;
    localStorage.removeItem('panol_token');
    localStorage.removeItem('panol_user');
    document.getElementById('appScreen').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('loginPass').value = '';
    document.getElementById('loginError').className = 'login-error';
    detenerPing();
}

function showLoginError(msg) {
    const el = document.getElementById('loginError');
    el.textContent = msg;
    el.className = 'login-error show';
}

function showLoading(show) {
    document.getElementById('loadingOverlay').className = show ? 'loading-overlay show' : 'loading-overlay';
}

// ============================================================
//  CARGAR DATOS LOCALES
// ============================================================
function cargarDatosLocales() {
    const savedItems = localStorage.getItem('panol_items');
    if (savedItems) {
        try {
            items = JSON.parse(savedItems);
        } catch(e) {}
    } else {
        items = [
            { codigo: "PAN-001", descripcion: "Guante de cuero Talle 9", categoria: "EPP", unidad: "Par", minimo: 5, maximo: 20, inicial: 12, ubicacion: "E1-A1", planta: "Planta 1", obs: "", critico: "NO", imagenes: [] },
            { codigo: "PAN-002", descripcion: "Casco de seguridad blanco", categoria: "EPP", unidad: "Unidad", minimo: 3, maximo: 15, inicial: 7, ubicacion: "E1-A2", planta: "Planta 1", obs: "", critico: "NO", imagenes: [] },
            { codigo: "PAN-003", descripcion: "Lente de seguridad claro", categoria: "EPP", unidad: "Unidad", minimo: 10, maximo: 40, inicial: 23, ubicacion: "E1-A3", planta: "Planta 1", obs: "", critico: "NO", imagenes: [] },
            { codigo: "PAN-005", descripcion: "Grasa litio multiuso 500g", categoria: "Lubricantes", unidad: "Kg", minimo: 3, maximo: 10, inicial: 5, ubicacion: "E3-A1", planta: "Planta 1", obs: "", critico: "NO", imagenes: [] },
            { codigo: "PAN-006", descripcion: "Aceite hidráulico ISO 46 20L", categoria: "Lubricantes", unidad: "Bidón", minimo: 1, maximo: 5, inicial: 2, ubicacion: "E3-A2", planta: "Planta 1", obs: "", critico: "SI", imagenes: [] },
            { codigo: "PAN-010", descripcion: "Disco de corte 115mm", categoria: "Abrasivos", unidad: "Unidad", minimo: 20, maximo: 80, inicial: 35, ubicacion: "E5-A1", planta: "Planta 1", obs: "", critico: "NO", imagenes: [] },
            { codigo: "PAN-015", descripcion: "Rodamiento 6205 ZZ", categoria: "Rodamientos", unidad: "Unidad", minimo: 2, maximo: 8, inicial: 1, ubicacion: "E7-A2", planta: "Planta 1", obs: "", critico: "SI", imagenes: [] },
            { codigo: "PAN-016", descripcion: "Filtro hidráulico HF7", categoria: "Filtros", unidad: "Unidad", minimo: 1, maximo: 6, inicial: 3, ubicacion: "E8-A1", planta: "Planta 1", obs: "", critico: "NO", imagenes: [] }
        ];
        localStorage.setItem('panol_items', JSON.stringify(items));
    }

    const savedMovs = localStorage.getItem('panol_movs');
    if (savedMovs) {
        try {
            movs = JSON.parse(savedMovs);
        } catch(e) {}
    }

    renderStock();
    renderHistory();
    renderCategorias();
    updateKPIsLocales();
}

function updateKPIsLocales() {
    document.getElementById('kpiTotal').textContent = items.length;
    document.getElementById('kpiSinStock').textContent = items.filter(i => stockActual(i) <= 0).length;
    document.getElementById('kpiCriticos').textContent = items.filter(i => esCritico(i)).length;
    document.getElementById('kpiCategorias').textContent = [...new Set(items.map(i => i.categoria || 'Sin categoría'))].length;
    document.getElementById('kpiMovs').textContent = movs.length;
}

// ============================================================
//  MANTENER SERVIDOR DESPIERTO (PING)
// ============================================================
function iniciarPing() {
    setTimeout(hacerPing, 2000);
    pingInterval = setInterval(hacerPing, 300000);
}

function detenerPing() {
    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
    }
    document.getElementById('pingStatus').textContent = '⏱ Detenido';
    document.getElementById('pingStatus').className = 'ping-status';
}

function hacerPing() {
    pingContador++;
    if (currentUser && USUARIOS_LOCALES[currentUser.username]) {
        document.getElementById('pingStatus').textContent = `⏱ ${pingContador} ✅ (local)`;
        document.getElementById('pingStatus').className = 'ping-status active';
        return;
    }
    fetch(`${API_URL}/api/items`, {
        headers: { 'Authorization': token || '' },
        signal: AbortSignal.timeout(10000)
    })
    .then(() => {
        const statusEl = document.getElementById('pingStatus');
        statusEl.textContent = `⏱ ${pingContador} ✅`;
        statusEl.className = 'ping-status active';
    })
    .catch(() => {
        const statusEl = document.getElementById('pingStatus');
        statusEl.textContent = `⏱ ${pingContador} ⚠️`;
        statusEl.className = 'ping-status';
    });
}

// ============================================================
//  CARGAR DATOS DEL SERVIDOR
// ============================================================
function loadDataFromServer() {
    showLoading(true);
    Promise.all([
        apiCall('/api/items'),
        apiCall('/api/movimientos'),
        apiCall('/api/stats')
    ])
    .then(([itemsData, movsData, statsData]) => {
        items = itemsData;
        movs = movsData;
        showLoading(false);
        updateKPIsFromStats(statsData);
        renderStock();
        renderHistory();
        renderCategorias();
        document.getElementById('syncStatus').textContent = '●';
        document.getElementById('syncStatus').className = 'sync-status';
        showToast('✅ Datos cargados');
    })
    .catch(err => {
        showLoading(false);
        document.getElementById('syncStatus').textContent = '⚠️';
        document.getElementById('syncStatus').className = 'sync-status error';
        showToast('❌ Error: ' + err.message, false);
    });
}

function updateKPIsFromStats(stats) {
    document.getElementById('kpiTotal').textContent = stats.totalItems || 0;
    document.getElementById('kpiSinStock').textContent = stats.sinStock || 0;
    document.getElementById('kpiCriticos').textContent = stats.criticos || 0;
    document.getElementById('kpiCategorias').textContent = stats.categorias || 0;
    document.getElementById('kpiMovs').textContent = stats.totalMovimientos || 0;
}

// ============================================================
//  TABS
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const tab = this.dataset.tab;
            switchTab(tab);
        });
    });

    document.querySelectorAll('.kpi-card').forEach(card => {
        card.addEventListener('click', function() {
            const filter = this.dataset.filter;
            if (filter) filterByKPI(filter);
            const tab = this.dataset.tab;
            if (tab) switchTab(tab);
        });
    });
});

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const section = document.getElementById(tab + 'Section');
    if (section) section.classList.add('active');

    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.tab-btn[data-tab="${tab}"]`)?.classList.add('active');

    if (tab === 'stock') renderStock();
    if (tab === 'historial') renderHistory();
    if (tab === 'movimiento') updateNewItemVisibility();
    if (tab === 'editar') resetEditForm();
    if (tab === 'categorias') renderCategorias();
    if (tab === 'planilla') initPlanillaFecha();
    if (tab === 'planillasRecibidas' && currentUser?.rol === 'admin') {
        renderPlanillasRecibidas();
        if (!planillasInterval) iniciarPollingPlanillas();
    }
    if (tab === 'ordenes' && currentUser?.rol === 'admin') {
        initOrdenes();
        cargarSelectoresOT();
        renderTablaOT();
    }
}

function showToast(msg, success = true) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = 'toast show ' + (success ? 'toast-success' : 'toast-error');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => toast.classList.remove('show'), 3500);
}

function filterByKPI(filter) {
    activeKpiFilter = filter;
    switchTab('stock');
    const searchInput = document.querySelector('.search-input');
    const categorySelect = document.querySelector('.category-select');
    if (searchInput) searchInput.value = '';
    if (categorySelect) categorySelect.value = 'Todas';
    renderStock();
}

// ============================================================
//  🔥 RENDER STOCK - TARJETAS CON CARROUSEL AUTOMÁTICO 🔥
// ============================================================
function renderStock() {
    Object.values(carrouselIntervals).forEach(clearInterval);
    carrouselIntervals = {};

    const searchInput = document.querySelector('.search-input');
    const catSelect = document.querySelector('.category-select');
    const q = searchInput?.value.toLowerCase() || '';
    const cat = catSelect?.value || 'Todas';

    const categorias = ['Todas', ...new Set(items.map(i => i.categoria || 'Sin categoría'))];
    if (catSelect) {
        catSelect.innerHTML = categorias.map(c => `<option ${c === cat ? 'selected' : ''}>${c}</option>`).join('');
    }

    let filtrados = items.filter(i => {
        const matchQ = !q || i.codigo.toLowerCase().includes(q) || i.descripcion.toLowerCase().includes(q);
        const matchC = cat === 'Todas' || (i.categoria || 'Sin categoría') === cat;
        return matchQ && matchC;
    });

    if (activeKpiFilter === 'sinstock') filtrados = filtrados.filter(i => stockActual(i) <= 0);
    else if (activeKpiFilter === 'criticos') filtrados = filtrados.filter(i => esCritico(i));

    const container = document.getElementById('stockCardsContainer');
    if (!container) return;
    container.innerHTML = '';

    if (filtrados.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-title">Sin resultados</div></div>';
        return;
    }

    filtrados.forEach((item) => {
        const actual = stockActual(item);
        const e = estadoItem(actual, item.minimo, item);

        const todasImagenes = [];
        if (item.imagenes && item.imagenes.length > 0) {
            todasImagenes.push(...item.imagenes);
        } else if (item.imagen) {
            todasImagenes.push(item.imagen);
        }

        const card = document.createElement('div');
        card.className = 'stock-card';
        card.onclick = () => editItemFromTable(item.codigo);
        card.title = 'Click para ver';

        const imgContainer = document.createElement('div');
        imgContainer.className = 'card-img-container';

        if (todasImagenes.length > 0) {
            const img = document.createElement('img');
            img.src = todasImagenes[0];
            img.alt = item.descripcion;
            img.className = 'card-img';
            img.loading = 'lazy';
            imgContainer.appendChild(img);

            if (todasImagenes.length > 1) {
                const badge = document.createElement('span');
                badge.className = 'card-img-badge';
                badge.textContent = `${todasImagenes.length} fotos`;
                imgContainer.appendChild(badge);
            }

            if (todasImagenes.length > 1) {
                const dotsContainer = document.createElement('div');
                dotsContainer.className = 'card-dots';
                todasImagenes.forEach((_, idx) => {
                    const dot = document.createElement('span');
                    dot.className = 'card-dot' + (idx === 0 ? ' active' : '');
                    dotsContainer.appendChild(dot);
                });
                imgContainer.appendChild(dotsContainer);

                let currentIdx = 0;
                const intervalId = setInterval(() => {
                    currentIdx = (currentIdx + 1) % todasImagenes.length;
                    img.src = todasImagenes[currentIdx];
                    const dots = dotsContainer.querySelectorAll('.card-dot');
                    dots.forEach((d, i) => d.classList.toggle('active', i === currentIdx));
                }, 3000);
                carrouselIntervals[item.codigo] = intervalId;
            }
        } else {
            const placeholder = document.createElement('span');
            placeholder.className = 'card-img-placeholder';
            placeholder.textContent = '📦';
            imgContainer.appendChild(placeholder);
        }

        card.appendChild(imgContainer);

        const info = document.createElement('div');
        info.className = 'card-info';
        info.innerHTML = `
            <div class="card-descripcion">${item.descripcion}</div>
            <div class="card-codigo">${item.codigo}</div>
            <div class="card-stock" style="color: ${actual <= item.minimo ? e.color : 'var(--verdeM)'}">
                Stock: ${actual} ${item.unidad || 'u.'}
            </div>
            <span class="badge" style="background:${e.bg};color:${e.color};border:1px solid ${e.color}33;margin-top:4px;">${e.label}</span>
        `;
        card.appendChild(info);
        container.appendChild(card);
    });
}

function filterStock() { activeKpiFilter = 'todos'; renderStock(); }

function editItemFromTable(codigo) {
    switchTab('editar');
    loadItemForEdit(codigo);
}

// ============================================================
//  EDITAR / VER COMPONENTE (ADMIN Y EMPLEADO)
// ============================================================
function searchItemToEdit() {
    const val = document.getElementById('editSearchInput').value.trim().toUpperCase();
    const suggestions = document.getElementById('editSuggestions');
    if (!val) { suggestions.classList.remove('show'); return; }
    if (val.length >= 2) {
        const results = items.filter(i =>
            i.codigo.toLowerCase().includes(val.toLowerCase()) ||
            i.descripcion.toLowerCase().includes(val.toLowerCase())
        ).slice(0, 8);
        if (results.length > 0) {
            suggestions.innerHTML = results.map(s =>
                `<div class="suggestion-item" onclick="loadItemForEdit('${s.codigo}')"><span><strong style="color:var(--verde);">${s.codigo}</strong> ${s.descripcion}</span></div>`
            ).join('');
            suggestions.classList.add('show');
        } else {
            suggestions.classList.remove('show');
        }
    } else {
        suggestions.classList.remove('show');
    }
}

function loadItemForEdit(codigo) {
    const item = items.find(i => i.codigo === codigo);
    if (!item) return;

    editingItemCodigo = codigo;
    const esAdmin = currentUser?.rol === 'admin';

    // Buscar índice para navegación
    const searchInput = document.getElementById('editSearchInput').value.trim();
    let itemsFiltrados = items;
    if (searchInput && !searchInput.includes(' - ')) {
        const q = searchInput.toLowerCase();
        itemsFiltrados = items.filter(i =>
            i.codigo.toLowerCase().includes(q) ||
            i.descripcion.toLowerCase().includes(q)
        );
    }

    const currentIndex = itemsFiltrados.findIndex(i => i.codigo === codigo);
    const totalItems = itemsFiltrados.length;
    const tieneAnterior = currentIndex > 0;
    const tieneSiguiente = currentIndex < totalItems - 1;
    const itemAnterior = tieneAnterior ? itemsFiltrados[currentIndex - 1] : null;
    const itemSiguiente = tieneSiguiente ? itemsFiltrados[currentIndex + 1] : null;

    document.getElementById('editSearchInput').value = item.codigo + ' - ' + item.descripcion;
    document.getElementById('editSuggestions').classList.remove('show');
    document.getElementById('editItemName').textContent = item.descripcion;
    document.getElementById('editItemStock').textContent = stockActual(item);
    document.getElementById('editItemUnit').textContent = item.unidad || 'unidades';
    document.getElementById('editCodigo').value = item.codigo;
    document.getElementById('editDescripcion').value = item.descripcion;
    document.getElementById('editCategoria').value = item.categoria || '';
    document.getElementById('editUnidad').value = item.unidad || 'Unidad';
    document.getElementById('editInicial').value = item.inicial;
    document.getElementById('editMinimo').value = item.minimo;
    document.getElementById('editMaximo').value = item.maximo;
    document.getElementById('editUbicacion').value = item.ubicacion || '';
    document.getElementById('editPlanta').value = item.planta || '';
    document.getElementById('editCritico').value = item.critico || 'NO';
    document.getElementById('editObs').value = item.obs || '';

    // Deshabilitar/habilitar según rol
    const inputs = document.querySelectorAll('#editFormContainer .form-input');
    inputs.forEach(input => {
        if (input.id === 'editSearchInput') return;
        input.disabled = !esAdmin;
        input.readOnly = !esAdmin;
    });

    // Botones guardar/cancelar
    const btnGroup = document.querySelector('#editFormContainer .btn-group');
    if (btnGroup) btnGroup.style.display = esAdmin ? 'flex' : 'none';

    // Título según rol
    const itemInfoName = document.querySelector('#editFormContainer .item-info-name');
    if (itemInfoName) {
        itemInfoName.innerHTML = esAdmin
            ? `✏️ Editando: <span id="editItemName">${item.descripcion}</span>`
            : `👁️ Viendo: <span id="editItemName">${item.descripcion}</span>`;
    }

    // Navegación
    actualizarNavegacionEdicion(itemAnterior, itemSiguiente, tieneAnterior, tieneSiguiente);

    // Imágenes
    renderImagenesGrid(item.imagenes || []);

    const uploadArea = document.getElementById('editImagenesUpload');
    if (uploadArea) uploadArea.style.display = esAdmin ? 'block' : 'none';

    if (!esAdmin) {
        setTimeout(() => {
            document.querySelectorAll('.btn-eliminar-imagen').forEach(b => b.style.display = 'none');
        }, 100);
    }

    document.getElementById('editFormContainer').style.display = 'block';
}

// ============================================================
//  NAVEGACIÓN ENTRE COMPONENTES
// ============================================================
function actualizarNavegacionEdicion(itemAnterior, itemSiguiente, tieneAnterior, tieneSiguiente) {
    let navContainer = document.getElementById('editNavContainer');

    if (!navContainer) {
        navContainer = document.createElement('div');
        navContainer.id = 'editNavContainer';
        navContainer.className = 'edit-nav-container';
        const itemInfo = document.querySelector('#editFormContainer .item-info');
        if (itemInfo) {
            itemInfo.after(navContainer);
        } else {
            const formContainer = document.getElementById('editFormContainer');
            formContainer.insertBefore(navContainer, formContainer.firstChild);
        }
    }

    if (!tieneAnterior && !tieneSiguiente) {
        navContainer.style.display = 'none';
        return;
    }

    navContainer.style.display = 'flex';
    navContainer.innerHTML = `
        <button class="edit-nav-btn prev" onclick="navegarComponente('${itemAnterior?.codigo || ''}')"
                ${!tieneAnterior ? 'disabled' : ''}
                title="${itemAnterior ? 'Anterior: ' + itemAnterior.descripcion : 'No hay anterior'}">
            ◀ Anterior
        </button>
        <span class="edit-nav-counter">
            <strong>${editingItemCodigo}</strong>
        </span>
        <button class="edit-nav-btn next" onclick="navegarComponente('${itemSiguiente?.codigo || ''}')"
                ${!tieneSiguiente ? 'disabled' : ''}
                title="${itemSiguiente ? 'Siguiente: ' + itemSiguiente.descripcion : 'No hay siguiente'}">
            Siguiente ▶
        </button>
    `;
}

function navegarComponente(codigo) {
    if (!codigo) return;
    const formContainer = document.getElementById('editFormContainer');
    formContainer.style.opacity = '0';
    formContainer.style.transform = 'translateX(20px)';
    formContainer.style.transition = 'all 0.15s ease';
    setTimeout(() => {
        loadItemForEdit(codigo);
        formContainer.style.opacity = '1';
        formContainer.style.transform = 'translateX(0)';
    }, 150);
}

function cerrarVistaComponente() {
    editingItemCodigo = null;
    imagenesTemporales = [];
    document.getElementById('editSearchInput').value = '';
    document.getElementById('editSuggestions').classList.remove('show');
    document.getElementById('editFormContainer').style.display = 'none';
    const navContainer = document.getElementById('editNavContainer');
    if (navContainer) navContainer.remove();
}

function saveEdit() {
    if (currentUser?.rol !== 'admin') {
        showToast('Solo administradores pueden editar', false);
        return;
    }
    if (!editingItemCodigo) {
        showToast('Seleccioná un ítem para editar', false);
        return;
    }

    const newCodigo = document.getElementById('editCodigo').value.trim();
    const newDescripcion = document.getElementById('editDescripcion').value.trim();
    if (!newCodigo || !newDescripcion) {
        showToast('Código y descripción son obligatorios', false);
        return;
    }

    if (newCodigo !== editingItemCodigo && items.find(i => i.codigo === newCodigo)) {
        showToast('El código ' + newCodigo + ' ya existe', false);
        return;
    }

    let criticoVal = document.getElementById('editCritico').value.trim().toUpperCase();
    if (!['SI', 'NO'].includes(criticoVal)) criticoVal = 'NO';

    const updatedItem = {
        codigo: newCodigo,
        descripcion: newDescripcion,
        categoria: document.getElementById('editCategoria').value.trim() || 'Sin categoría',
        unidad: document.getElementById('editUnidad').value,
        inicial: Number(document.getElementById('editInicial').value) || 0,
        minimo: Number(document.getElementById('editMinimo').value) || 1,
        maximo: Number(document.getElementById('editMaximo').value) || 10,
        ubicacion: document.getElementById('editUbicacion').value.trim(),
        planta: document.getElementById('editPlanta').value.trim(),
        critico: criticoVal,
        obs: document.getElementById('editObs').value.trim()
    };

    if (imagenesTemporales.length > 0) {
        updatedItem.imagenes = [...imagenesTemporales];
        updatedItem.imagen = imagenesTemporales[0];
    } else {
        updatedItem.imagenes = [];
        updatedItem.imagen = null;
    }

    showLoading(true);

    if (currentUser && USUARIOS_LOCALES[currentUser.username]) {
        const idx = items.findIndex(i => i.codigo === editingItemCodigo);
        if (idx !== -1) items[idx] = updatedItem;
        editingItemCodigo = newCodigo;
        localStorage.setItem('panol_items', JSON.stringify(items));
        showLoading(false);
        showToast('✅ Ítem actualizado correctamente (local)');
        loadItemForEdit(newCodigo);
        renderStock();
        renderCategorias();
        return;
    }

    apiCall(`/api/items/${editingItemCodigo}`, {
            method: 'PUT',
            body: JSON.stringify(updatedItem)
        })
        .then(() => {
            const idx = items.findIndex(i => i.codigo === editingItemCodigo);
            if (idx !== -1) items[idx] = updatedItem;
            editingItemCodigo = newCodigo;
            showLoading(false);
            showToast('✅ Ítem actualizado correctamente');
            loadItemForEdit(newCodigo);
            renderStock();
            renderCategorias();
        })
        .catch(err => {
            showLoading(false);
            showToast('❌ Error: ' + err.message, false);
        });
}

function cancelEdit() {
    cerrarVistaComponente();
}

function resetEditForm() {
    cancelEdit();
}

// ============================================================
//  FUNCIONES PARA MÚLTIPLES IMÁGENES
// ============================================================
function renderImagenesGrid(imagenes) {
    const grid = document.getElementById('editImagenesGrid');
    const infoEl = document.getElementById('editImagenesInfo');
    imagenesTemporales = [...imagenes];
    grid.innerHTML = '';
    if (imagenes.length > 0) {
        infoEl.textContent = `📸 ${imagenes.length} imagen(es) cargada(s) · ${calcularPesoImagenes(imagenes)}`;
    } else {
        infoEl.textContent = '📸 Sin imágenes';
    }
    if (imagenes.length === 0) {
        grid.innerHTML = `<div class="imagenes-empty"><span class="empty-img-icon">📷</span><span style="font-size:12px;font-weight:600;">Sin imágenes</span><span style="font-size:10px;color:var(--sub);">Agregá fotos del componente</span></div>`;
        return;
    }
    imagenes.forEach((imgData, index) => {
        const card = document.createElement('div');
        card.className = 'imagen-card';
        card.innerHTML = `
            <span class="imagen-index">#${index + 1}</span>
            <button class="btn-eliminar-imagen" onclick="event.stopPropagation(); eliminarImagenIndividual(${index})" title="Eliminar">×</button>
            <button class="btn-preview-imagen" onclick="event.stopPropagation(); abrirVisorImagen(${index})" title="Ver">🔍</button>
            <img src="${imgData}" alt="Imagen ${index + 1}" loading="lazy">
        `;
        card.addEventListener('click', () => abrirVisorImagen(index));
        grid.appendChild(card);
    });
}

function calcularPesoImagenes(imagenes) {
    let totalBytes = 0;
    imagenes.forEach(img => { if (img.startsWith('data:image')) { const b = img.split(',')[1] || ''; totalBytes += Math.round((b.length * 3) / 4); } });
    if (totalBytes < 1024) return totalBytes + ' B';
    if (totalBytes < 1048576) return (totalBytes / 1024).toFixed(1) + ' KB';
    return (totalBytes / 1048576).toFixed(2) + ' MB';
}

function cargarMultiplesImagenes(event) {
    const files = Array.from(event.target.files);
    if (!files.length) return;
    if (imagenesTemporales.length + files.length > 5) { showToast('⚠️ Máximo 5 imágenes', false); return; }
    let cargadas = 0, errores = 0;
    files.forEach(file => {
        if (file.size > 5 * 1024 * 1024) { errores++; return; }
        if (!file.type.startsWith('image/')) { errores++; return; }
        const reader = new FileReader();
        reader.onload = function(e) {
            imagenesTemporales.push(e.target.result);
            cargadas++;
            if (cargadas + errores === files.length) {
                renderImagenesGrid(imagenesTemporales);
                if (cargadas > 0) showToast(`✅ ${cargadas} imagen(es) agregadas`);
                if (errores > 0) showToast(`⚠️ ${errores} archivo(s) rechazados`, false);
            }
        };
        reader.onerror = function() { errores++; if (cargadas + errores === files.length) { renderImagenesGrid(imagenesTemporales); showToast('⚠️ Error', false); } };
        reader.readAsDataURL(file);
    });
    event.target.value = '';
}

function tomarMultiplesFotos() {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment'; input.multiple = false;
        input.onchange = function(e) { if (e.target.files && e.target.files[0]) { cargarMultiplesImagenes({ target: { files: [e.target.files[0]] } }); } input.remove(); };
        input.click();
    } else { document.getElementById('editMultipleImages').click(); }
}

function eliminarImagenIndividual(index) {
    if (!confirm(`¿Eliminar la imagen #${index + 1}?`)) return;
    imagenesTemporales.splice(index, 1);
    renderImagenesGrid(imagenesTemporales);
    showToast('🗑️ Imagen eliminada');
}

function abrirVisorImagen(index) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-imagen-overlay';
    overlay.id = 'modalVisorImagen';
    overlay.innerHTML = `
        <div class="modal-imagen-content">
            <button class="modal-imagen-close" onclick="cerrarVisorImagen()">×</button>
            <img src="${imagenesTemporales[index]}" alt="Imagen ${index + 1}">
            <div class="modal-imagen-nav">
                <button onclick="navegarVisorImagen(${index - 1})" ${index === 0 ? 'disabled' : ''}>◀ Anterior</button>
                <span class="modal-imagen-counter">${index + 1} / ${imagenesTemporales.length}</span>
                <button onclick="navegarVisorImagen(${index + 1})" ${index === imagenesTemporales.length - 1 ? 'disabled' : ''}>Siguiente ▶</button>
            </div>
        </div>`;
    overlay.addEventListener('click', function(e) { if (e.target === overlay) cerrarVisorImagen(); });
    const escHandler = function(e) { if (e.key === 'Escape') { cerrarVisorImagen(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
}

function cerrarVisorImagen() {
    const overlay = document.getElementById('modalVisorImagen');
    if (overlay) { overlay.style.animation = 'fadeOut 0.2s ease forwards'; setTimeout(() => { overlay.remove(); document.body.style.overflow = ''; }, 200); }
}

function navegarVisorImagen(newIndex) {
    if (newIndex < 0 || newIndex >= imagenesTemporales.length) return;
    cerrarVisorImagen();
    setTimeout(() => abrirVisorImagen(newIndex), 100);
}

// ============================================================
//  MOVIMIENTOS
// ============================================================
function setTipo(tipo, btn) {
    currentTipo = tipo;
    document.querySelectorAll('.type-btn').forEach(b => b.className = 'type-btn');
    let activeClass = tipo === 'SALIDA' ? 'active-salida' :
        (tipo === 'ENTRADA' || tipo === 'DEVOLUCIÓN') ? 'active-entrada' : 'active-ajuste';
    btn.classList.add(activeClass);
    document.getElementById('submitBtn').textContent = 'Registrar ' + tipo + ' →';
    document.getElementById('submitBtn').style.background = tipo === 'SALIDA' ? 'var(--rojo)' :
        (tipo === 'ENTRADA' || tipo === 'DEVOLUCIÓN') ? 'var(--verdeM)' : 'var(--gris)';
    updateNewItemVisibility();
    if (tipo !== 'ENTRADA') hideNewItemForm();
}

function updateNewItemVisibility() {
    document.getElementById('toggleNewItem').style.display = (currentTipo === 'ENTRADA' && currentTab === 'movimiento') ? 'flex' : 'none';
}

function toggleNewItemForm() {
    if (currentUser?.rol !== 'admin') { showToast('Solo administradores pueden crear nuevos ítems', false); return; }
    isCreatingNewItem = !isCreatingNewItem;
    const form = document.getElementById('newItemForm');
    const codigoGroup = document.getElementById('codigoExistenteGroup');
    const itemInfo = document.getElementById('itemInfo');
    const toggleIcon = document.getElementById('toggleNewItemIcon');
    const toggleText = document.getElementById('toggleNewItemText');
    if (isCreatingNewItem) {
        form.classList.add('show');
        codigoGroup.style.opacity = '0.5';
        codigoGroup.style.pointerEvents = 'none';
        itemInfo.classList.remove('show');
        document.getElementById('suggestions').classList.remove('show');
        toggleIcon.textContent = '➖';
        toggleText.textContent = 'Seleccionar ítem existente';
        selectedItemCodigo = null;
        document.getElementById('codigoInput').value = '';
    } else {
        hideNewItemForm();
    }
}

function hideNewItemForm() {
    isCreatingNewItem = false;
    document.getElementById('newItemForm').classList.remove('show');
    document.getElementById('codigoExistenteGroup').style.opacity = '1';
    document.getElementById('codigoExistenteGroup').style.pointerEvents = 'auto';
    document.getElementById('toggleNewItemIcon').textContent = '➕';
    document.getElementById('toggleNewItemText').textContent = 'Crear nuevo ítem';
    ['newCodigo', 'newDescripcion', 'newCategoria', 'newUbicacion', 'newPlanta', 'newCritico'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    const newInicial = document.getElementById('newInicial'); if (newInicial) newInicial.value = '0';
    const newMinimo = document.getElementById('newMinimo'); if (newMinimo) newMinimo.value = '1';
    const newMaximo = document.getElementById('newMaximo'); if (newMaximo) newMaximo.value = '10';
}

function searchItem() {
    if (isCreatingNewItem) return;
    const val = document.getElementById('codigoInput').value.trim().toUpperCase();
    const suggestions = document.getElementById('suggestions');
    const itemInfo = document.getElementById('itemInfo');
    if (!val) { suggestions.classList.remove('show'); itemInfo.classList.remove('show'); selectedItemCodigo = null; return; }
    const itemExacto = items.find(i => i.codigo === val);
    if (itemExacto) {
        suggestions.classList.remove('show');
        mostrarInfoItem(itemExacto);
        selectedItemCodigo = itemExacto.codigo;
    } else if (val.length >= 2) {
        const results = items.filter(i => i.codigo.toLowerCase().includes(val.toLowerCase()) || i.descripcion.toLowerCase().includes(val.toLowerCase())).slice(0, 6);
        if (results.length > 0) {
            suggestions.innerHTML = results.map(s => `<div class="suggestion-item" onclick="selectItem('${s.codigo}')"><span><strong style="color:var(--verde);">${s.codigo}</strong> ${s.descripcion}</span><span>Stock: ${stockActual(s)}</span></div>`).join('');
            if (currentTipo === 'ENTRADA' && currentUser?.rol === 'admin') suggestions.innerHTML += `<div class="suggestion-item new-item" onclick="toggleNewItemForm();document.getElementById('newCodigo').value='${val}';document.getElementById('suggestions').classList.remove('show');"><span>🆕 Crear: ${val}</span></div>`;
            suggestions.classList.add('show'); itemInfo.classList.remove('show'); selectedItemCodigo = null;
        } else {
            suggestions.classList.remove('show'); itemInfo.classList.remove('show');
            if (currentTipo === 'ENTRADA' && val.length >= 2 && currentUser?.rol === 'admin') {
                suggestions.innerHTML = `<div class="suggestion-item new-item" onclick="toggleNewItemForm();document.getElementById('newCodigo').value='${val}';document.getElementById('suggestions').classList.remove('show');"><span>🆕 Crear: ${val}</span></div>`;
                suggestions.classList.add('show');
            }
        }
    }
}

function mostrarInfoItem(item) {
    document.getElementById('itemInfoDesc').textContent = item.descripcion;
    document.getElementById('itemInfoDetails').textContent = (item.categoria || '') + (item.ubicacion ? ' · ' + item.ubicacion : '') + (item.planta ? ' · ' + item.planta : '') + ' · Crítico: ' + (item.critico || 'NO');
    document.getElementById('itemInfoStock').textContent = stockActual(item);
    document.getElementById('itemInfoUnit').textContent = (item.unidad || 'unidades') + ' actuales';
    document.getElementById('itemInfo').classList.add('show');
}

function selectItem(codigo) { document.getElementById('codigoInput').value = codigo; document.getElementById('suggestions').classList.remove('show'); const item = items.find(i => i.codigo === codigo); if (item) { mostrarInfoItem(item); selectedItemCodigo = codigo; hideNewItemForm(); } document.getElementById('cantidadInput').focus(); }
function clearItemSelection() { document.getElementById('codigoInput').value = ''; document.getElementById('itemInfo').classList.remove('show'); document.getElementById('suggestions').classList.remove('show'); selectedItemCodigo = null; hideNewItemForm(); document.getElementById('codigoInput').focus(); }

function registrarMovimiento() {
    const cantidad = Number(document.getElementById('cantidadInput').value);
    const responsable = document.getElementById('responsableInput').value.trim() || currentUser?.username || '';
    const ot = document.getElementById('otInput').value.trim();
    const sector = document.getElementById('sectorInput').value.trim();
    const obs = document.getElementById('obsInput').value.trim();
    if (!cantidad || cantidad <= 0) { showToast('Ingresá una cantidad válida', false); return; }

    let codigo, descripcion, categoria, unidad, minimo, maximo, ubicacion, planta, critico;

    if (isCreatingNewItem) {
        if (currentUser?.rol !== 'admin') { showToast('Solo administradores pueden crear nuevos ítems', false); return; }
        const newCodigo = document.getElementById('newCodigo').value.trim();
        const newDescripcion = document.getElementById('newDescripcion').value.trim();
        if (!newCodigo) { showToast('Ingresá el código', false); return; }
        if (!newDescripcion) { showToast('Ingresá la descripción', false); return; }
        if (items.find(i => i.codigo === newCodigo)) { showToast('El código ya existe', false); return; }
        codigo = newCodigo; descripcion = newDescripcion;
        categoria = document.getElementById('newCategoria').value.trim() || 'Sin categoría';
        unidad = document.getElementById('newUnidad').value;
        minimo = Number(document.getElementById('newMinimo').value) || 1;
        maximo = Number(document.getElementById('newMaximo').value) || 10;
        ubicacion = document.getElementById('newUbicacion').value.trim();
        planta = document.getElementById('newPlanta').value.trim() || 'Planta 1';
        critico = document.getElementById('newCritico').value.trim().toUpperCase() || 'NO';
        if (!['SI', 'NO'].includes(critico)) critico = 'NO';
        showLoading(true);
        if (currentUser && USUARIOS_LOCALES[currentUser.username]) {
            items.push({ codigo, descripcion, categoria, unidad, inicial: Number(document.getElementById('newInicial').value) || 0, minimo, maximo, ubicacion, planta, critico, obs: '', imagenes: [] });
            localStorage.setItem('panol_items', JSON.stringify(items));
            movs.unshift({ id: Date.now(), fecha: new Date().toLocaleDateString('es-AR'), hora: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }), tipo: currentTipo, codigo, descripcion, cantidad: cantidad, responsable: responsable || currentUser.username, ot, sector, obs, usuario: currentUser.username });
            localStorage.setItem('panol_movs', JSON.stringify(movs));
            showLoading(false); limpiarFormularioMovimiento();
            showToast('✓ ' + currentTipo + ' registrada — ' + descripcion);
            renderStock(); renderHistory(); renderCategorias(); updateKPIsLocales();
            return;
        }
        apiCall('/api/items', { method: 'POST', body: JSON.stringify({ codigo, descripcion, categoria, unidad, inicial: Number(document.getElementById('newInicial').value) || 0, minimo, maximo, ubicacion, planta, critico, obs: '' }) })
            .then(() => registrarMovimientoEnServidor(codigo, descripcion, cantidad, responsable, ot, sector, obs, categoria, unidad, minimo, maximo, ubicacion, planta, critico))
            .then(() => { showLoading(false); limpiarFormularioMovimiento(); showToast('✓ ' + currentTipo + ' registrada — ' + descripcion); loadDataFromServer(); })
            .catch(err => { showLoading(false); showToast('❌ Error: ' + err.message, false); });
        return;
    }

    if (!selectedItemCodigo) { const val = document.getElementById('codigoInput').value.trim(); const item = items.find(i => i.codigo === val); if (!item) { showToast('Seleccioná un ítem', false); return; } selectedItemCodigo = item.codigo; }
    const item = items.find(i => i.codigo === selectedItemCodigo);
    if (!item) { showToast('Ítem no encontrado', false); return; }
    codigo = item.codigo; descripcion = item.descripcion;
    if (currentTipo === 'SALIDA' && cantidad > stockActual(item)) { showToast('Stock insuficiente. Actual: ' + stockActual(item), false); return; }
    showLoading(true);
    if (currentUser && USUARIOS_LOCALES[currentUser.username]) {
        movs.unshift({ id: Date.now(), fecha: new Date().toLocaleDateString('es-AR'), hora: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }), tipo: currentTipo, codigo, descripcion, cantidad: cantidad, responsable: responsable || currentUser.username, ot, sector, obs, usuario: currentUser.username });
        localStorage.setItem('panol_movs', JSON.stringify(movs));
        showLoading(false); limpiarFormularioMovimiento();
        showToast('✓ ' + currentTipo + ' registrada — ' + descripcion);
        renderStock(); renderHistory(); renderCategorias(); updateKPIsLocales();
        return;
    }
    registrarMovimientoEnServidor(codigo, descripcion, cantidad, responsable, ot, sector, obs)
        .then(() => { showLoading(false); limpiarFormularioMovimiento(); showToast('✓ ' + currentTipo + ' registrada — ' + descripcion); loadDataFromServer(); })
        .catch(err => { showLoading(false); showToast('❌ Error: ' + err.message, false); });
}

function registrarMovimientoEnServidor(codigo, descripcion, cantidad, responsable, ot, sector, obs, categoria, unidad, minimo, maximo, ubicacion, planta, critico) {
    const body = { codigo, descripcion, tipo: currentTipo, cantidad, responsable, ot, sector, obs };
    if (categoria) body.categoria = categoria; if (unidad) body.unidad = unidad; if (minimo) body.minimo = minimo; if (maximo) body.maximo = maximo; if (ubicacion) body.ubicacion = ubicacion; if (planta) body.planta = planta; if (critico) body.critico = critico;
    return apiCall('/api/movimiento', { method: 'POST', body: JSON.stringify(body) });
}

function limpiarFormularioMovimiento() { ['codigoInput', 'cantidadInput', 'otInput', 'obsInput'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; }); document.getElementById('itemInfo').classList.remove('show'); selectedItemCodigo = null; hideNewItemForm(); }

// ============================================================
//  RENDER HISTORY
// ============================================================
function renderHistory() {
    const container = document.getElementById('historyList');
    if (!movs.length) { container.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">Sin movimientos</div></div>`; return; }
    container.innerHTML = movs.slice(0, 100).map(m => {
        const isEntrada = m.tipo === 'ENTRADA' || m.tipo === 'DEVOLUCIÓN';
        return `<div class="history-card" style="border-left:4px solid ${isEntrada?'var(--verdeM)':m.tipo==='SALIDA'?'var(--rojo)':'var(--gris)'};"><span class="history-date">${m.fecha}</span><span class="history-type" style="color:${isEntrada?'var(--verdeM)':'var(--rojo)'};">${m.tipo}</span><div><div class="history-desc">${m.descripcion}</div></div><span class="history-qty" style="color:${m.tipo==='SALIDA'?'var(--rojo)':'var(--verdeM)'};">${m.tipo==='SALIDA'?'-':'+'}${m.cantidad}</span></div>`;
    }).join('');
}

// ============================================================
//  RENDER CATEGORÍAS - CON IMAGEN Y DATOS COMPLETOS
// ============================================================
function renderCategorias() {
    const container = document.getElementById('categoriasList');
    const categorias = [...new Set(items.map(i => i.categoria || 'Sin categoría'))].sort();
    if (!categorias.length) { container.innerHTML = `<div class="empty-state"><div class="empty-icon">📂</div><div class="empty-title">Sin categorías</div></div>`; return; }

    let html = '';
    categorias.forEach(cat => {
        const itemsCat = items.filter(i => (i.categoria || 'Sin categoría') === cat);
        const isOpen = categoriasExpandidas[cat] || false;
        html += `<div class="categoria-item"><div class="categoria-header" onclick="toggleCategoria('${cat}')"><span class="categoria-toggle ${isOpen ? 'open' : ''}">${isOpen ? '✕' : '+'}</span><span class="categoria-nombre">${cat}</span><span class="categoria-cantidad">${itemsCat.length} ítems</span></div><div class="categoria-items ${isOpen ? 'open' : ''}">`;

        itemsCat.forEach(item => {
            const actual = stockActual(item);
            const e = estadoItem(actual, item.minimo, item);
            let imagenHtml = '';
            if (item.imagenes && item.imagenes.length > 0) {
                imagenHtml = `<img src="${item.imagenes[0]}" alt="${item.descripcion}" class="cat-item-img">`;
            } else if (item.imagen) {
                imagenHtml = `<img src="${item.imagen}" alt="${item.descripcion}" class="cat-item-img">`;
            } else {
                imagenHtml = `<span class="cat-item-img-placeholder">📦</span>`;
            }
            html += `<div class="categoria-subitem" onclick="editItemFromTable('${item.codigo}')" title="Click para ver">
                <div class="cat-item-img-col">${imagenHtml}</div>
                <div class="cat-item-info">
                    <div class="cat-item-header">
                        <span class="cat-item-codigo">${item.codigo}</span>
                        <span class="cat-item-descripcion">${item.descripcion}</span>
                        <span class="badge cat-item-badge" style="background:${e.bg};color:${e.color};border:1px solid ${e.color}33;">${e.label}</span>
                    </div>
                    <div class="cat-item-detalles">
                        <span class="cat-item-stock" style="color: ${actual <= item.minimo ? e.color : 'var(--verdeM)'}">Stock: <strong>${actual}</strong> ${item.unidad || 'u.'}</span>
                        <span class="cat-item-separador">·</span>
                        <span>Mín: <strong>${item.minimo}</strong></span>
                        <span class="cat-item-separador">·</span>
                        <span>Máx: <strong>${item.maximo}</strong></span>
                        ${item.ubicacion ? `<span class="cat-item-separador">·</span><span>📌 ${item.ubicacion}</span>` : ''}
                    </div>
                </div>
            </div>`;
        });
        html += `</div></div>`;
    });
    container.innerHTML = html;
}

function toggleCategoria(categoria) { categoriasExpandidas[categoria] = !categoriasExpandidas[categoria]; renderCategorias(); }

// ============================================================
//  ADMIN - PLANTILLA EXCEL / EXPORTAR / BACKUP / IMPORT
// ============================================================
function descargarPlantilla() {
    const wb = XLSX.utils.book_new();
    const data = [['Código', 'Descripción', 'Categoría', 'Unidad', 'Stock Inicial', 'Stock Mínimo', 'Stock Máximo', 'Ubicación', 'Planta', 'Crítico', 'Observaciones'], ['PAN-001', 'Ejemplo de producto', 'EPP', 'Unidad', 10, 5, 20, 'E1-A1', 'Planta 1', 'NO', '']];
    const ws = XLSX.utils.aoa_to_sheet(data); XLSX.utils.book_append_sheet(wb, ws, 'Ítems');
    ws['!cols'] = [{ wch: 15 }, { wch: 30 }, { wch: 15 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 30 }];
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }); const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'plantilla_stock_panol.xlsx';
    document.body.appendChild(link); link.click(); document.body.removeChild(link); setTimeout(() => URL.revokeObjectURL(link.href), 100);
    showToast('✅ Plantilla descargada');
}

function exportarDatos() { if (currentUser?.rol !== 'admin') { showToast('Solo administradores pueden exportar', false); return; } downloadBackup(); }

async function downloadBackup() {
    if (currentUser?.rol !== 'admin') { showToast('Solo administradores pueden descargar backups', false); return; }
    showLoading(true);
    try {
        let data;
        if (currentUser && USUARIOS_LOCALES[currentUser.username]) { data = { items, movimientos: movs, planillas, usuarios: USUARIOS_LOCALES }; showLoading(false); }
        else { data = await apiCall('/api/backup'); showLoading(false); }
        const wb = XLSX.utils.book_new();
        const itemsData = data.items.map(item => ({ 'Código': item.codigo, 'Descripción': item.descripcion, 'Categoría': item.categoria || '', 'Unidad': item.unidad || 'Unidad', 'Stock Inicial': item.inicial || 0, 'Stock Mínimo': item.minimo || 0, 'Stock Máximo': item.maximo || 0, 'Ubicación': item.ubicacion || '', 'Planta': item.planta || '', 'Crítico': item.critico || 'NO', 'Observaciones': item.obs || '' }));
        const wsItems = XLSX.utils.json_to_sheet(itemsData); XLSX.utils.book_append_sheet(wb, wsItems, 'Ítems');
        const movsData = (data.movimientos || []).map(m => ({ 'Fecha': m.fecha || '', 'Hora': m.hora || '', 'Tipo': m.tipo || '', 'Código': m.codigo || '', 'Descripción': m.descripcion || '', 'Cantidad': m.cantidad || 0, 'Responsable': m.responsable || '', 'OT/Referencia': m.ot || '', 'Sector/Destino': m.sector || '', 'Observaciones': m.obs || '' }));
        const wsMovs = XLSX.utils.json_to_sheet(movsData); XLSX.utils.book_append_sheet(wb, wsMovs, 'Movimientos');
        wsItems['!cols'] = [{ wch: 15 }, { wch: 30 }, { wch: 15 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 30 }];
        wsMovs['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 15 }, { wch: 30 }, { wch: 12 }, { wch: 15 }, { wch: 18 }, { wch: 18 }, { wch: 30 }];
        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }); const blob = new Blob([wbout], { type: 'application/octet-stream' });
        if (window.showSaveFilePicker) {
            try { const handle = await window.showSaveFilePicker({ suggestedName: 'backup_pañol.xlsx', types: [{ description: 'Excel Workbook', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }] }); const writable = await handle.createWritable(); await writable.write(blob); await writable.close(); showToast('✅ Backup guardado correctamente'); return; }
            catch (err) { if (err.name === 'AbortError') { showToast('⏹️ Descarga cancelada'); return; } }
        }
        const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'backup_pañol.xlsx';
        document.body.appendChild(link); link.click(); document.body.removeChild(link); setTimeout(() => URL.revokeObjectURL(link.href), 100);
        showToast('✅ Backup descargado');
    } catch (err) { showLoading(false); showToast('❌ Error: ' + err.message, false); }
}

function openBackupModal() { if (currentUser?.rol !== 'admin') { showToast('Solo administradores', false); return; } document.getElementById('backupModal').classList.add('show'); document.getElementById('restoreInfo').style.display = 'none'; }
function closeBackupModal() { document.getElementById('backupModal').classList.remove('show'); }

function restoreBackup(event) {
    if (currentUser?.rol !== 'admin') { showToast('Solo administradores pueden restaurar backups', false); return; }
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const wb = XLSX.read(e.target.result, { type: 'array' }); const wsItems = wb.Sheets['Ítems']; if (!wsItems) throw new Error('No se encontró la hoja "Ítems"');
            const itemsData = XLSX.utils.sheet_to_json(wsItems); const wsMovs = wb.Sheets['Movimientos']; let movsData = []; if (wsMovs) movsData = XLSX.utils.sheet_to_json(wsMovs);
            if (!itemsData || itemsData.length === 0) throw new Error('No se encontraron ítems');
            const restoredItems = itemsData.map(row => ({ codigo: String(row['Código'] || '').trim(), descripcion: String(row['Descripción'] || '').trim(), categoria: String(row['Categoría'] || 'Sin categoría').trim() || 'Sin categoría', unidad: String(row['Unidad'] || 'Unidad').trim() || 'Unidad', inicial: Number(row['Stock Inicial']) || 0, minimo: Number(row['Stock Mínimo']) || 0, maximo: Number(row['Stock Máximo']) || 0, ubicacion: String(row['Ubicación'] || '').trim(), planta: String(row['Planta'] || '').trim(), critico: ['SI', 'NO'].includes(String(row['Crítico'] || '').toUpperCase()) ? String(row['Crítico']).toUpperCase() : 'NO', obs: String(row['Observaciones'] || '').trim(), imagenes: [] }));
            const validItems = restoredItems.filter(item => item.codigo && item.descripcion); if (validItems.length === 0) throw new Error('No hay ítems válidos');
            const restoredMovs = movsData.map(row => ({ fecha: String(row['Fecha'] || new Date().toLocaleDateString('es-AR')), hora: String(row['Hora'] || new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })), tipo: String(row['Tipo'] || 'ENTRADA'), codigo: String(row['Código'] || '').trim(), descripcion: String(row['Descripción'] || '').trim(), cantidad: Number(row['Cantidad']) || 0, responsable: String(row['Responsable'] || '').trim(), ot: String(row['OT/Referencia'] || '').trim(), sector: String(row['Sector/Destino'] || '').trim(), obs: String(row['Observaciones'] || '').trim(), id: Date.now() + Math.random() * 1000 }));
            pendingRestoreData = { items: validItems, movs: restoredMovs };
            const infoDiv = document.getElementById('restoreInfo'); infoDiv.style.display = 'block';
            infoDiv.innerHTML = `<div class="info-box success"><strong>✅ Backup listo para restaurar</strong><br>📦 Ítems: ${validItems.length}<br>📋 Movimientos: ${restoredMovs.length}</div><div class="btn-group"><button class="btn btn-cancel" onclick="cancelRestore()">Cancelar</button><button class="btn btn-primary" onclick="confirmRestore()">✅ Confirmar</button></div>`;
        } catch (err) { const infoDiv = document.getElementById('restoreInfo'); infoDiv.style.display = 'block'; infoDiv.innerHTML = `<div class="info-box error">❌ ${err.message || 'Error al leer el archivo'}</div>`; pendingRestoreData = null; }
    };
    reader.readAsArrayBuffer(file); event.target.value = '';
}

function cancelRestore() { document.getElementById('restoreInfo').style.display = 'none'; pendingRestoreData = null; }

function confirmRestore() {
    if (!pendingRestoreData) { showToast('No hay datos para restaurar', false); return; }
    showLoading(true);
    if (currentUser && USUARIOS_LOCALES[currentUser.username]) { items = pendingRestoreData.items; movs = pendingRestoreData.movs; localStorage.setItem('panol_items', JSON.stringify(items)); localStorage.setItem('panol_movs', JSON.stringify(movs)); showLoading(false); document.getElementById('restoreInfo').style.display = 'none'; pendingRestoreData = null; closeBackupModal(); showToast('✅ Datos restaurados correctamente (local)'); renderStock(); renderHistory(); renderCategorias(); updateKPIsLocales(); return; }
    apiCall('/api/backup/restore', { method: 'POST', body: JSON.stringify({ items: pendingRestoreData.items, movimientos: pendingRestoreData.movs, usuarios: {} }) })
        .then(() => { showLoading(false); document.getElementById('restoreInfo').style.display = 'none'; pendingRestoreData = null; closeBackupModal(); showToast('✅ Datos restaurados correctamente'); loadDataFromServer(); })
        .catch(err => { showLoading(false); showToast('❌ Error: ' + err.message, false); });
}

function openImportModal() { if (currentUser?.rol !== 'admin') { showToast('Solo administradores pueden importar', false); return; } document.getElementById('importModal').classList.add('show'); resetImportModal(); }
function closeImportModal() { document.getElementById('importModal').classList.remove('show'); }
function resetImportModal() { const dropZone = document.getElementById('dropZone'); if (dropZone) dropZone.classList.remove('loaded'); document.getElementById('dropIcon').textContent = '📊'; document.getElementById('dropText').textContent = 'Hacé clic o arrastrá tu archivo Excel'; document.getElementById('importInfo').style.display = 'none'; document.getElementById('previewContainer').style.display = 'none'; document.getElementById('importButtons').style.display = 'none'; importData = null; }
function handleDrop(event) { event.preventDefault(); if (event.dataTransfer.files[0]) processFile(event.dataTransfer.files[0]); }
function handleFileSelect(event) { if (event.target.files[0]) processFile(event.target.files[0]); }

function mapearColumnas(headers) {
    const map = {};
    headers.forEach((h, i) => { const n = String(h || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ''); if (n.includes('cod')) map.codigo = i; if (n.includes('desc')) map.descripcion = i; if (n.includes('stockinicial') || n === 'stockinicial' || n === 'stock_inicial' || n === 'stock inicial') map.stock = i; if (n === 'stock' || n === 'stockactual' || n === 'cantidad') map.stock = i; if (n.includes('ubic')) map.ubicacion = i; if (n.includes('plant')) map.planta = i; if (n.includes('min')) map.minimo = i; if (n.includes('max')) map.maximo = i; if (n.includes('obs') || n.includes('nota')) map.obs = i; if (n.includes('cat')) map.categoria = i; if (n.includes('unid')) map.unidad = i; if (n.includes('crit')) map.critico = i; });
    return map;
}

function processFile(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const wb = XLSX.read(e.target.result, { type: 'array' }); const ws = wb.Sheets[wb.SheetNames[0]]; const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
            if (rows.length < 2) { showImportError('Archivo vacío'); return; }
            let hdrIdx = 0; for (let i = 0; i < Math.min(5, rows.length); i++) { if (rows[i].some(c => typeof c === 'string' && c.trim())) { hdrIdx = i; break; } }
            const map = mapearColumnas(rows[hdrIdx]); if (map.codigo === undefined || map.descripcion === undefined) { showImportError('Columnas obligatorias: Código y Descripción'); return; }
            importData = rows.slice(hdrIdx + 1).filter(r => r[map.codigo] && String(r[map.codigo]).trim()).map(r => { let stockValor = Number(r[map.stock] ?? 0); if (isNaN(stockValor)) stockValor = 0; let criticoVal = String(r[map.critico] || '').trim().toUpperCase(); if (!['SI', 'NO'].includes(criticoVal)) criticoVal = 'NO'; return { codigo: String(r[map.codigo] || '').trim(), descripcion: String(r[map.descripcion] || '').trim(), categoria: String(r[map.categoria] || 'Sin categoría').trim() || 'Sin categoría', unidad: String(r[map.unidad] || 'Unidad').trim() || 'Unidad', inicial: stockValor, minimo: Number(r[map.minimo] ?? 0) || 0, maximo: Number(r[map.maximo] ?? 0) || 0, ubicacion: String(r[map.ubicacion] || '').trim(), planta: String(r[map.planta] || '').trim() || 'Planta 1', critico: criticoVal, obs: String(r[map.obs] || '').trim(), imagenes: [] }; });
            if (importData.length === 0) { showImportError('No se encontraron datos válidos'); return; }
            document.getElementById('dropZone').classList.add('loaded'); document.getElementById('dropIcon').textContent = '✅'; document.getElementById('dropText').textContent = file.name + ` (${importData.length} ítems)`;
            document.getElementById('importInfo').style.display = 'block'; document.getElementById('importInfo').className = 'info-box success'; document.getElementById('importInfo').textContent = `✓ Listo para importar ${importData.length} ítems`;
            const previewContainer = document.getElementById('previewContainer'); previewContainer.style.display = 'block';
            previewContainer.innerHTML = `<div style="font-size:12px;font-weight:700;color:var(--sub);margin-bottom:8px;">Vista previa (${Math.min(5, importData.length)} de ${importData.length})</div><table class="preview-table"><thead><tr><th>Código</th><th>Descripción</th><th>Stock</th><th>Mín</th><th>Máx</th><th>Crítico</th></tr></thead><tbody>${importData.slice(0,5).map((r,i) => `<tr style="background:${i%2===0?'#fff':'var(--bg)'}"><td style="font-weight:700;color:var(--verde);">${r.codigo}</td><td>${r.descripcion}</td><td style="text-align:center;font-weight:700;color:${r.inicial > 0 ? 'var(--verdeM)' : 'var(--rojo)'};">${r.inicial}</td><td style="text-align:center;">${r.minimo}</td><td style="text-align:center;">${r.maximo}</td><td style="text-align:center;font-weight:700;color:${r.critico==='SI'?'var(--rojo)':'var(--sub)'};">${r.critico}</td></tr>`).join('')}${importData.length > 5 ? `<tr><td colspan="6" style="text-align:center;color:var(--sub);">... y ${importData.length - 5} más</td></tr>` : ''}</tbody></table>`;
            document.getElementById('importButtons').style.display = 'flex';
        } catch (err) { showImportError('Error al leer archivo: ' + err.message); }
    };
    reader.readAsArrayBuffer(file);
}

function showImportError(msg) { document.getElementById('importInfo').style.display = 'block'; document.getElementById('importInfo').className = 'info-box error'; document.getElementById('importInfo').textContent = '⚠️ ' + msg; }

function confirmImport() {
    if (!importData || currentUser?.rol !== 'admin') { showToast('No hay datos para importar', false); return; }
    if (currentUser && USUARIOS_LOCALES[currentUser.username]) { items = importData; movs = []; localStorage.setItem('panol_items', JSON.stringify(items)); localStorage.setItem('panol_movs', JSON.stringify(movs)); closeImportModal(); categoriasExpandidas = {}; showToast('✅ ' + items.length + ' ítems importados (local)'); renderStock(); renderHistory(); renderCategorias(); updateKPIsLocales(); return; }
    showLoading(true);
    const promises = importData.map(item => { const existe = items.find(i => i.codigo === item.codigo); if (existe) { return apiCall(`/api/items/${item.codigo}`, { method: 'PUT', body: JSON.stringify(item) }).catch(() => null); } else { return apiCall('/api/items', { method: 'POST', body: JSON.stringify(item) }).catch(() => null); } });
    Promise.allSettled(promises).then(results => { showLoading(false); closeImportModal(); categoriasExpandidas = {}; const procesados = results.filter(r => r.status === 'fulfilled' && r.value?.success !== false).length; showToast(`✅ ${procesados} ítems procesados`); loadDataFromServer(); }).catch(err => { showLoading(false); showToast('❌ Error al importar: ' + err.message, false); });
}

// ============================================================
//  PLANILLA DE TRABAJO
// ============================================================
function cargarPlanillasDesdeServidor() { if (!token) return Promise.resolve([]); return apiCall('/api/planillas').then(data => { planillas = data || []; guardarPlanillasLocal(); return planillas; }).catch(err => { console.log('Error al cargar planillas:', err); return []; }); }
function guardarPlanillasLocal() { localStorage.setItem('panol_planillas', JSON.stringify(planillas)); }
function iniciarPollingPlanillas() { detenerPollingPlanillas(); if (!token) return; planillasInterval = setInterval(() => { if (!document.hidden) sincronizarPlanillas(); }, 5000); }
function detenerPollingPlanillas() { if (planillasInterval) { clearInterval(planillasInterval); planillasInterval = null; } }
function sincronizarPlanillas() { if (!token) return; apiCall('/api/planillas').then(data => { const nuevasPlanillas = data || []; if (JSON.stringify(planillas) !== JSON.stringify(nuevasPlanillas)) { planillas = nuevasPlanillas; guardarPlanillasLocal(); if (currentTab === 'planillasRecibidas' && currentUser?.rol === 'admin') renderPlanillasRecibidasUI(document.getElementById('planillasRecibidasList')); if (currentTab === 'planilla') actualizarContadorPlanillas(); } }).catch(() => {}); }
function actualizarContadorPlanillas() { const badge = document.querySelector('.tab-btn[data-tab="planillasRecibidas"] .badge-count-tab'); if (!badge && currentUser?.rol === 'admin') { const span = document.createElement('span'); span.className = 'badge-count-tab'; span.style.cssText = `background:var(--rojo);color:#fff;border-radius:50%;padding:0px 6px;font-size:9px;font-weight:700;margin-left:4px;`; document.querySelector('.tab-btn[data-tab="planillasRecibidas"]')?.appendChild(span); } const badgeEl = document.querySelector('.tab-btn[data-tab="planillasRecibidas"] .badge-count-tab'); if (badgeEl) badgeEl.textContent = planillas.length > 0 ? planillas.length : ''; }

function registrarPlanilla() {
    if (!currentUser) { showToast('Debés iniciar sesión', false); return; }
    const fecha = document.getElementById('planillaFecha').value; const tipo = document.getElementById('planillaTipo').value; const clasificacion = document.getElementById('planillaClasificacion').value;
    const modulo = document.getElementById('planillaModulo').value.trim(); const descripcion = document.getElementById('planillaDescripcion').value.trim();
    const tecnico = document.getElementById('planillaTecnico').value.trim() || currentUser.username; const horas = parseFloat(document.getElementById('planillaHoras').value);
    const repuesto = document.getElementById('planillaRepuesto').value.trim(); const observaciones = document.getElementById('planillaObservaciones').value.trim();
    if (!tipo) { showToast('Seleccioná un tipo de trabajo', false); return; } if (!modulo) { showToast('Ingresá el módulo intervenido', false); return; }
    if (!descripcion) { showToast('Ingresá la descripción de la tarea', false); return; } if (!horas || horas <= 0) { showToast('Ingresá las horas invertidas', false); return; }
    showLoading(true);
    if (currentUser && USUARIOS_LOCALES[currentUser.username]) {
        const nuevaPlanilla = { id: Date.now(), fecha, tipo, clasificacion, modulo, descripcion, horas, repuesto: repuesto || '', observaciones: observaciones || '', usuario: currentUser.username, tecnico: tecnico, timestamp: new Date().toISOString() };
        planillas.unshift(nuevaPlanilla); localStorage.setItem('panol_planillas', JSON.stringify(planillas)); showLoading(false);
        showToast('✅ Trabajo registrado correctamente (local)');
        document.getElementById('planillaTipo').value = ''; document.getElementById('planillaModulo').value = ''; document.getElementById('planillaDescripcion').value = ''; document.getElementById('planillaHoras').value = ''; document.getElementById('planillaRepuesto').value = ''; document.getElementById('planillaObservaciones').value = ''; initPlanillaFecha();
        if (currentUser?.rol === 'admin') { cargarOrdenesDesdePlanillas(); renderTablaOT(); }
        return;
    }
    apiCall('/api/planillas', { method: 'POST', body: JSON.stringify({ fecha, tipo, clasificacion, modulo, descripcion, horas, repuesto, observaciones, tecnico: tecnico }) })
        .then(data => { showLoading(false); if (data.success) { planillas.unshift(data.planilla); guardarPlanillasLocal(); showToast('✅ Trabajo registrado correctamente'); document.getElementById('planillaTipo').value = ''; document.getElementById('planillaModulo').value = ''; document.getElementById('planillaDescripcion').value = ''; document.getElementById('planillaHoras').value = ''; document.getElementById('planillaRepuesto').value = ''; document.getElementById('planillaObservaciones').value = ''; initPlanillaFecha(); if (currentUser?.rol === 'admin') { cargarOrdenesDesdePlanillas(); renderTablaOT(); } } })
        .catch(err => { showLoading(false); showToast('❌ Error al registrar: ' + err.message, false); });
}

function renderPlanillasRecibidas() { const container = document.getElementById('planillasRecibidasList'); if (!container) return; if (currentUser?.rol === 'admin') { if (currentUser && USUARIOS_LOCALES[currentUser.username]) { renderPlanillasRecibidasUI(container); return; } showLoading(true); apiCall('/api/planillas').then(data => { planillas = data || []; guardarPlanillasLocal(); showLoading(false); renderPlanillasRecibidasUI(container); if (!planillasInterval) iniciarPollingPlanillas(); }).catch(err => { showLoading(false); showToast('Error al cargar planillas', false); renderPlanillasRecibidasUI(container); }); } else { renderPlanillasRecibidasUI(container); } }

function renderPlanillasRecibidasUI(container) {
    if (!container) return; const filtroEmpleado = document.getElementById('planillaFiltroEmpleado'); const filtroFecha = document.getElementById('planillaFiltroFecha');
    const empleados = [...new Set(planillas.map(p => p.usuario))]; const empleadoActual = filtroEmpleado?.value || ''; const fechaActual = filtroFecha?.value || '';
    if (filtroEmpleado) filtroEmpleado.innerHTML = `<option value="">Todos los empleados</option>${empleados.map(e => `<option value="${e}" ${e === empleadoActual ? 'selected' : ''}>${e}</option>`).join('')}`;
    let planillasFiltradas = [...planillas]; if (empleadoActual) planillasFiltradas = planillasFiltradas.filter(p => p.usuario === empleadoActual); if (fechaActual) planillasFiltradas = planillasFiltradas.filter(p => p.fecha === fechaActual);
    const empleadosFiltrados = [...new Set(planillasFiltradas.map(p => p.usuario))];
    if (empleadosFiltrados.length === 0) { container.innerHTML = `<div class="planilla-vacia"><div class="icono">📭</div><div class="titulo">Sin planillas registradas</div><p>Los empleados aún no han registrado trabajos.</p></div>`; return; }
    let html = '';
    empleadosFiltrados.forEach(empleado => {
        const planillasEmpleado = planillasFiltradas.filter(p => p.usuario === empleado).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        const planillasPorDia = {}; const planillasMostrar = []; planillasEmpleado.forEach(p => { const dia = p.fecha; if (!planillasPorDia[dia]) planillasPorDia[dia] = 0; if (planillasPorDia[dia] < 7) { planillasPorDia[dia]++; planillasMostrar.push(p); } });
        const totalPlanillas = planillasEmpleado.length; const totalHoras = planillasEmpleado.reduce((sum, p) => sum + p.horas, 0);
        html += `<div class="empleado-planilla-card"><div class="empleado-planilla-header" onclick="togglePlanillasEmpleado('${empleado}')"><span class="nombre">👤 ${empleado}</span><span class="badge-count">${totalPlanillas} trabajos · ${totalHoras}h</span><span class="toggle-icon" id="toggleIcon_${empleado}">+</span></div><div class="empleado-planilla-body" id="planillasBody_${empleado}">${planillasMostrar.length > 0 ? planillasMostrar.map(p => `<div class="planilla-item" style="${p.id === planillas[0]?.id ? 'background:var(--verdeC);border-left:3px solid var(--verdeM);' : ''}"><span class="fecha">${p.fecha}</span><span class="tipo ${p.tipo.toLowerCase()}">${p.tipo}</span><span class="modulo">${p.modulo}</span><span class="horas">${p.horas}h</span><span class="repuesto">${p.repuesto || '—'}</span><div class="acciones"><button onclick="verPlanillaDetalle('${p.id}')" title="Ver detalle">👁️</button>${currentUser?.rol === 'admin' ? `<button onclick="eliminarPlanilla('${p.id}')" title="Eliminar">🗑️</button>` : ''}</div></div>`).join('') : `<div class="planilla-vacia" style="padding:12px;"><p>Sin trabajos registrados</p></div>`}${totalPlanillas > 7 ? `<div style="text-align:center;font-size:12px;color:var(--sub);padding:8px;">... y ${totalPlanillas - 7} trabajos más</div>` : ''}</div></div>`;
    });
    container.innerHTML = html; actualizarContadorPlanillas();
}

function togglePlanillasEmpleado(empleado) { const body = document.getElementById(`planillasBody_${empleado}`); const icon = document.getElementById(`toggleIcon_${empleado}`); if (body) { body.classList.toggle('open'); if (icon) { icon.textContent = body.classList.contains('open') ? '✕' : '+'; icon.classList.toggle('open'); } } }
function verPlanillaDetalle(id) { const planilla = planillas.find(p => p.id === id); if (!planilla) { showToast('Planilla no encontrada', false); return; } alert(`📋 PLANILLA DE TRABAJO\n━━━━━━━━━━━━━━━━━━━━━\n📅 Fecha: ${planilla.fecha}\n👤 Técnico: ${planilla.tecnico}\n🔧 Tipo: ${planilla.tipo}\n📋 Clasificación: ${planilla.clasificacion || 'Orden de Trabajo'}\n📌 Módulo: ${planilla.modulo}\n📝 Descripción: ${planilla.descripcion}\n⏱ Horas: ${planilla.horas}\n🔩 Repuesto: ${planilla.repuesto || 'Ninguno'}\n💬 Observaciones: ${planilla.observaciones || '—'}`); }
function eliminarPlanilla(id) { if (currentUser?.rol !== 'admin') { showToast('Solo administradores pueden eliminar', false); return; } if (!confirm('¿Eliminar esta planilla permanentemente?')) return; if (currentUser && USUARIOS_LOCALES[currentUser.username]) { planillas = planillas.filter(p => p.id !== id); localStorage.setItem('panol_planillas', JSON.stringify(planillas)); renderPlanillasRecibidasUI(document.getElementById('planillasRecibidasList')); showToast('✅ Planilla eliminada (local)'); return; } showLoading(true); apiCall(`/api/planillas/${id}`, { method: 'DELETE' }).then(() => { showLoading(false); planillas = planillas.filter(p => p.id !== id); guardarPlanillasLocal(); renderPlanillasRecibidasUI(document.getElementById('planillasRecibidasList')); showToast('✅ Planilla eliminada'); }).catch(err => { showLoading(false); showToast('❌ Error: ' + err.message, false); }); }
function filtrarPlanillasPorEmpleado() { renderPlanillasRecibidasUI(document.getElementById('planillasRecibidasList')); }
function filtrarPlanillasPorFecha() { renderPlanillasRecibidasUI(document.getElementById('planillasRecibidasList')); }

function exportarPlanillasExcel() {
    if (planillas.length === 0) { showToast('No hay planillas para exportar', false); return; }
    const filtroEmpleado = document.getElementById('planillaFiltroEmpleado')?.value || ''; const filtroFecha = document.getElementById('planillaFiltroFecha')?.value || '';
    let datosExportar = [...planillas]; if (filtroEmpleado) datosExportar = datosExportar.filter(p => p.usuario === filtroEmpleado); if (filtroFecha) datosExportar = datosExportar.filter(p => p.fecha === filtroFecha);
    if (datosExportar.length === 0) { showToast('No hay planillas con los filtros seleccionados', false); return; }
    const wb = XLSX.utils.book_new(); const data = datosExportar.map(p => ({ 'Fecha': p.fecha, 'Técnico': p.tecnico, 'Tipo': p.tipo, 'Clasificación': p.clasificacion || 'Orden de Trabajo', 'Módulo': p.modulo, 'Descripción': p.descripcion, 'Horas': p.horas, 'Repuesto': p.repuesto || 'Ninguno', 'Observaciones': p.observaciones || '', 'Registrado por': p.usuario }));
    const ws = XLSX.utils.json_to_sheet(data); ws['!cols'] = [{ wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 20 }, { wch: 40 }, { wch: 10 }, { wch: 20 }, { wch: 30 }, { wch: 15 }]; XLSX.utils.book_append_sheet(wb, ws, 'Planillas');
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }); const blob = new Blob([wbout], { type: 'application/octet-stream' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
    let nombreArchivo = 'planillas_trabajo'; if (filtroEmpleado) nombreArchivo += `_${filtroEmpleado}`; if (filtroFecha) nombreArchivo += `_${filtroFecha}`; nombreArchivo += `.xlsx`; link.download = nombreArchivo;
    document.body.appendChild(link); link.click(); document.body.removeChild(link); setTimeout(() => URL.revokeObjectURL(link.href), 100); showToast('✅ Planillas exportadas a Excel');
}

function initPlanillaFecha() { const fechaInput = document.getElementById('planillaFecha'); if (fechaInput) { const hoy = new Date(); fechaInput.value = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`; } const tecnicoInput = document.getElementById('planillaTecnico'); if (tecnicoInput && currentUser) tecnicoInput.value = currentUser.username; }

// ============================================================
//  ÓRDENES DE TRABAJO
// ============================================================
function guardarOTLocal() { localStorage.setItem('ot_ordenes_v2', JSON.stringify(ordenes)); localStorage.setItem('ot_maquinas', JSON.stringify(maquinasList)); localStorage.setItem('ot_tecnicos', JSON.stringify(tecnicosList)); localStorage.setItem('ot_modulos', JSON.stringify(modulosList)); }
function cargarOrdenesDesdePlanillas() { const idsExistentes = new Set(ordenes.map(o => o.id)); let contador = 0; planillas.forEach(p => { const id = p.id || Date.now() + Math.random() * 1000; if (!idsExistentes.has(id)) { ordenes.push({ id: id, fecha: p.fecha || '', maquina: p.modulo || '', falla: p.descripcion || '', clasificacion: p.clasificacion || 'Orden de Trabajo', tecnico: p.tecnico || p.usuario || '', horas: p.horas || 0, repuestos: p.repuesto || '', solucion: '', operativa: 'SI', tipoOrden: p.tipo || '', comentarios: p.observaciones || '', _origen: 'planilla' }); idsExistentes.add(id); contador++; } }); if (contador > 0) guardarOTLocal(); }
function initOrdenes() { const saved = localStorage.getItem('ot_ordenes_v2'); if (saved) { try { const parsed = JSON.parse(saved); if (parsed.length > 0) ordenes = parsed; } catch(e) {} } if (currentUser?.rol === 'admin') cargarOrdenesDesdePlanillas(); renderTablaOT(); }

function renderTablaOT() {
    const saved = localStorage.getItem('ot_ordenes_v2'); if (saved) { try { const parsed = JSON.parse(saved); if (parsed.length > 0) ordenes = parsed; } catch(e) {} } if (currentUser?.rol === 'admin') cargarOrdenesDesdePlanillas();
    const search = document.getElementById('searchInputOT')?.value?.toLowerCase() || ''; const filtroClasificacion = document.getElementById('filterClasificacionOT')?.value || ''; const filtroMaq = document.getElementById('filterMaquinaOT')?.value || ''; const filtroTec = document.getElementById('filterTecnicoOT')?.value || '';
    let filtrados = ordenes.filter(o => { const matchSearch = !search || (o.id || '').toString().toLowerCase().includes(search) || (o.maquina || '').toLowerCase().includes(search) || (o.tecnico || '').toLowerCase().includes(search) || (o.falla || '').toLowerCase().includes(search); const matchClasificacion = !filtroClasificacion || o.clasificacion === filtroClasificacion; const matchMaq = !filtroMaq || o.maquina === filtroMaq; const matchTec = !filtroTec || o.tecnico === filtroTec; return matchSearch && matchClasificacion && matchMaq && matchTec; });
    document.getElementById('totalOT').textContent = filtrados.length; const horas = filtrados.map(o => parseFloat(o.horas) || 0); const sumHoras = horas.reduce((a, b) => a + b, 0); document.getElementById('promHorasOT').textContent = filtrados.length ? (sumHoras / filtrados.length).toFixed(1) : '0.0'; document.getElementById('totalRepuestosOT').textContent = filtrados.filter(o => o.repuestos && o.repuestos.trim()).length;
    const maquinas = [...new Set(ordenes.map(o => o.maquina).filter(Boolean))].sort(); const tecnicos = [...new Set(ordenes.map(o => o.tecnico).filter(Boolean))].sort();
    const selMaq = document.getElementById('filterMaquinaOT'); const selTec = document.getElementById('filterTecnicoOT');
    if (selMaq) { const curMaq = selMaq.value; selMaq.innerHTML = '<option value="">Todas las máquinas</option>' + maquinas.map(m => `<option value="${m}">${m}</option>`).join(''); selMaq.value = curMaq; }
    if (selTec) { const curTec = selTec.value; selTec.innerHTML = '<option value="">Todos los técnicos</option>' + tecnicos.map(t => `<option value="${t}">${t}</option>`).join(''); selTec.value = curTec; }
    const tbody = document.getElementById('tablaBodyOT'); const empty = document.getElementById('emptyStateOT');
    if (filtrados.length === 0) { tbody.innerHTML = ''; if (empty) empty.style.display = 'block'; return; } if (empty) empty.style.display = 'none';
    tbody.innerHTML = filtrados.map((o) => { const formatearFecha = (fecha) => { if (!fecha) return ''; if (fecha instanceof Date) return `${String(fecha.getDate()).padStart(2, '0')}/${String(fecha.getMonth() + 1).padStart(2, '0')}/${String(fecha.getFullYear()).slice(-2)}`; const fechaStr = String(fecha); if (fechaStr.includes('-')) { const partes = fechaStr.split('-'); if (partes.length === 3) return `${partes[1]}/${partes[2]}/${partes[0].slice(-2)}`; } return fechaStr; }; let fechaStr = formatearFecha(o.fecha); const esPreventivo = o.clasificacion === 'Preventivo'; const badgeClass = esPreventivo ? 'badge-info' : 'badge-warning'; const badgeText = esPreventivo ? '🛠️ Preventivo' : '📋 Orden'; return `<tr><td><strong style="color:var(--verde);">${o.id || '—'}</strong></td><td>${fechaStr}</td><td><span class="badge-ot">${o.maquina || '—'}</span></td><td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${o.falla || ''}">${o.falla || '—'}</td><td><span class="${badgeClass}">${badgeText}</span></td><td><strong>${o.tecnico || '—'}</strong></td><td style="font-weight:700;color:var(--verde);">${o.horas || 0}h</td><td>${o.repuestos || '—'}</td><td style="text-align:center;"><button class="btn-accion" onclick="verDetalleOT('${o.id}')">👁️</button></td></tr>`; }).join('');
}

function verDetalleOT(id) { const orden = ordenes.find(o => o.id == id); if (!orden) { showToast('Registro no encontrado', false); return; } alert(`📋 DETALLE DE TRABAJO\n━━━━━━━━━━━━━━━━━━━━━\n🔢 ID: ${orden.id}\n📅 Fecha: ${orden.fecha}\n🏭 Máquina: ${orden.maquina || '—'}\n📋 Clasificación: ${orden.clasificacion || '—'}\n📝 Descripción: ${orden.falla || '—'}\n👤 Técnico: ${orden.tecnico || '—'}\n⏱ Horas: ${orden.horas || 0}h\n🔩 Repuestos: ${orden.repuestos || '—'}\n💬 Comentarios: ${orden.comentarios || '—'}`); }
function limpiarFiltrosOT() { ['searchInputOT', 'filterClasificacionOT', 'filterMaquinaOT', 'filterTecnicoOT'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; }); renderTablaOT(); }
function cargarSelectoresOT() { const selMaq = document.getElementById('otMaquina'); const selTec = document.getElementById('otTecnico'); if (selMaq) selMaq.innerHTML = '<option value="">Seleccionar máquina</option>' + maquinasList.map(m => `<option value="${m}">${m}</option>`).join(''); if (selTec) selTec.innerHTML = '<option value="">Seleccionar técnico</option>' + tecnicosList.map(t => `<option value="${t}">${t}</option>`).join(''); }
function abrirFormularioOT() { if (currentUser?.rol !== 'admin') { showToast('Solo administradores pueden crear órdenes', false); return; } document.getElementById('modalOT').classList.add('show'); document.getElementById('editIndexOT').value = -1; document.getElementById('modalTitleOT').textContent = '➕ Nueva Orden de Trabajo'; document.getElementById('submitBtnOT').textContent = '✅ Guardar'; document.getElementById('otFecha').value = new Date().toISOString().split('T')[0]; document.getElementById('otId').value = Date.now(); document.getElementById('otOperativa').value = 'SI'; cargarSelectoresOT(); }
function cerrarModalOT() { document.getElementById('modalOT').classList.remove('show'); }
function guardarOT(e) { e.preventDefault(); if (currentUser?.rol !== 'admin') { showToast('Solo administradores pueden crear órdenes', false); return; } const id = document.getElementById('otId').value.trim() || Date.now(); const fecha = document.getElementById('otFecha').value; const maquina = document.getElementById('otMaquina').value; const tecnico = document.getElementById('otTecnico').value; if (!fecha || !maquina || !tecnico) { showToast('Completá los campos obligatorios', false); return; } const nuevaOT = { id: id, fecha: fecha, maquina: maquina, falla: document.getElementById('otFalla').value.trim(), clasificacion: document.getElementById('otClasificacion').value, tecnico: tecnico, horas: parseFloat(document.getElementById('otHoras').value) || 0, repuestos: document.getElementById('otRepuestos').value.trim() || '', solucion: document.getElementById('otSolucion').value.trim() || '', operativa: document.getElementById('otOperativa').value, tipoOrden: document.getElementById('otTipoOrden').value || '', comentarios: document.getElementById('otComentarios').value.trim() || '', turno: document.getElementById('otTurno').value || '', modulo: document.getElementById('otModulo').value.trim() || '', _origen: 'admin' }; ordenes.push(nuevaOT); guardarOTLocal(); cerrarModalOT(); renderTablaOT(); showToast('✅ Orden creada correctamente'); }
function exportarOTXLSX() { if (ordenes.length === 0) { showToast('No hay datos para exportar', false); return; } const datos = ordenes.map(o => ({ 'ID': o.id || '', 'Fecha': o.fecha || '', 'Máquina': o.maquina || '', 'Falla': o.falla || '', 'Clasificación': o.clasificacion || '', 'Técnico': o.tecnico || '', 'Horas': o.horas || 0, 'Repuestos': o.repuestos || '', 'Solución': o.solucion || '', 'Operativa': o.operativa || '', 'Comentarios': o.comentarios || '' })); const wb = XLSX.utils.book_new(); const ws = XLSX.utils.json_to_sheet(datos); ws['!cols'] = Object.keys(datos[0]).map(() => ({ wch: 18 })); XLSX.utils.book_append_sheet(wb, ws, 'Órdenes'); const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }); const blob = new Blob([wbout], { type: 'application/octet-stream' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `ordenes_${new Date().toLocaleDateString('es-AR').replace(/\//g, '-')}.xlsx`; document.body.appendChild(link); link.click(); document.body.removeChild(link); setTimeout(() => URL.revokeObjectURL(link.href), 100); showToast('✅ Órdenes exportadas a Excel'); }

let importDataOT = null;
function abrirImportadorOT() { document.getElementById('importModalOT').classList.add('show'); document.getElementById('dropZoneOT').classList.remove('loaded'); document.getElementById('dropIconOT').textContent = '📊'; document.getElementById('dropTextOT').textContent = 'Hacé clic o arrastrá tu archivo Excel'; document.getElementById('importInfoOT').style.display = 'none'; document.getElementById('previewContainerOT').style.display = 'none'; document.getElementById('importButtonsOT').style.display = 'none'; importDataOT = null; }
function cerrarImportadorOT() { document.getElementById('importModalOT').classList.remove('show'); }
function handleDropOT(e) { e.preventDefault(); if (e.dataTransfer.files[0]) processFileOT(e.dataTransfer.files[0]); }
function handleFileSelectOT(e) { if (e.target.files[0]) processFileOT(e.target.files[0]); }

function processFileOT(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        try { const wb = XLSX.read(e.target.result, { type: 'array' }); let wsDatos = null; for (let sheetName of wb.SheetNames) { if (sheetName.toLowerCase().includes('datos') || sheetName.toLowerCase().includes('data')) { wsDatos = wb.Sheets[sheetName]; break; } } if (!wsDatos && wb.SheetNames.length > 0) wsDatos = wb.Sheets[wb.SheetNames[0]]; if (!wsDatos) { showToast('No se encontró ninguna hoja con datos', false); return; } const data = XLSX.utils.sheet_to_json(wsDatos); if (!data || data.length === 0) { showToast('El archivo está vacío', false); return; }
            importDataOT = data.map(row => { const id = row['ID_Tarea'] || row['ID'] || row['id'] || row['ID_TAREA'] || Date.now() + Math.random() * 1000; let fecha = ''; const fechaRaw = row['Fecha'] || row['fecha'] || row['FECHA'] || ''; if (fechaRaw !== null && fechaRaw !== undefined) fecha = String(fechaRaw); if (fecha && fecha.includes('/')) { const partes = fecha.split('/'); if (partes.length === 3) { let año = partes[2]; if (año.length === 2) año = '20' + año; fecha = `${año}-${partes[1].padStart(2, '0')}-${partes[0].padStart(2, '0')}`; } } else if (fecha && typeof fecha === 'number') { try { const excelDate = new Date((fecha - 25569) * 86400 * 1000); fecha = `${excelDate.getFullYear()}-${String(excelDate.getMonth() + 1).padStart(2, '0')}-${String(excelDate.getDate()).padStart(2, '0')}`; } catch(err) { fecha = ''; } } const maquina = row['Maquina'] || row['Máquina'] || row['maquina'] || row['MÁQUINA'] || ''; const tecnico = row['Tecnico'] || row['Técnico'] || row['tecnico'] || row['TÉCNICO'] || ''; let clasificacion = row['Clasificación'] || row['Clasificacion'] || row['clasificacion'] || 'Orden de Trabajo'; if (row['Tipo de Orden']) { const tipoOrden = String(row['Tipo de Orden'] || ''); if (tipoOrden.includes('Preventivo')) clasificacion = 'Preventivo'; } let horas = 0; const horasRaw = row['Tiempo de trabajo'] !== undefined ? row['Tiempo de trabajo'] : (row['Horas'] !== undefined ? row['Horas'] : (row['horas'] !== undefined ? row['horas'] : 0)); if (horasRaw !== null && horasRaw !== undefined && horasRaw !== '') horas = parseFloat(String(horasRaw)) || 0; let operativa = 'SI'; const opStr = String(row['Operativa'] || row['operativa'] || '').toUpperCase(); if (opStr === 'FALSE' || opStr === 'NO' || opStr === '0') operativa = 'NO'; return { id, fecha, maquina: maquina || row['Modulo Intervenido'] || row['Modulo'] || row['modulo'] || '', falla: row['Falla'] || row['falla'] || row['FALLA'] || row['Descripción'] || row['descripcion'] || '', clasificacion, tecnico, horas, repuestos: row['Repuestos'] || row['repuestos'] || row['REPUESTOS'] || '', solucion: row['Solucion'] || row['Solución'] || row['solucion'] || '', operativa, comentarios: row['Comentarios'] || row['comentarios'] || row['Observaciones'] || row['observaciones'] || '' }; });
            importDataOT = importDataOT.filter(o => o.maquina || o.tecnico || o.falla); if (importDataOT.length === 0) { showToast('No se encontraron datos válidos', false); return; }
            document.getElementById('dropZoneOT').classList.add('loaded'); document.getElementById('dropIconOT').textContent = '✅'; document.getElementById('dropTextOT').textContent = file.name + ' (' + importDataOT.length + ' registros)'; document.getElementById('importButtonsOT').style.display = 'flex';
            const preview = document.getElementById('previewContainerOT'); preview.style.display = 'block'; preview.innerHTML = `<div style="font-size:12px;font-weight:700;color:var(--sub);margin:8px 0;">Vista previa (${importDataOT.length} registros)</div><div class="preview-table-wrap"><table><thead><tr><th>ID</th><th>Fecha</th><th>Máquina</th><th>Clasificación</th><th>Técnico</th><th>Horas</th></tr></thead><tbody>${importDataOT.slice(0, 10).map(o => `<tr><td>${o.id}</td><td>${o.fecha}</td><td>${o.maquina || '—'}</td><td>${o.clasificacion}</td><td>${o.tecnico || '—'}</td><td>${o.horas}</td></tr>`).join('')}${importDataOT.length > 10 ? `<tr><td colspan="6" style="text-align:center;color:var(--sub);">... y ${importDataOT.length - 10} más</td></tr>` : ''}</tbody></table></div>`; showToast('✅ Archivo procesado. ' + importDataOT.length + ' registros listos.'); } catch (err) { showToast('❌ Error al leer el archivo: ' + err.message, false); }
    };
    reader.readAsArrayBuffer(file); document.getElementById('fileInputOT').value = '';
}

function confirmarImportacionOT() { if (!importDataOT || importDataOT.length === 0) { showToast('No hay datos para importar', false); return; } let contador = 0; importDataOT.forEach(o => { const existe = ordenes.find(ord => ord.id == o.id); if (!existe) { ordenes.push({ ...o, _origen: 'importado' }); contador++; } }); guardarOTLocal(); cerrarImportadorOT(); renderTablaOT(); showToast('✅ ' + contador + ' órdenes importadas correctamente'); }

// ============================================================
//  INICIO - Verificar token guardado
// ============================================================
const savedToken = localStorage.getItem('panol_token');
const savedUser = localStorage.getItem('panol_user');
if (savedToken && savedUser) {
    try { const userData = JSON.parse(savedUser); if (USUARIOS_LOCALES[userData.username]) { currentUser = { username: userData.username, rol: userData.rol, token: savedToken }; token = savedToken; document.getElementById('loginScreen').style.display = 'none'; document.getElementById('appScreen').style.display = 'flex'; document.getElementById('userNameDisplay').textContent = '👤 ' + userData.username; const rolSpan = document.getElementById('userRolDisplay'); rolSpan.textContent = userData.rol; rolSpan.className = 'rol ' + (userData.rol === 'admin' ? 'admin-badge' : 'empleado-badge'); if (userData.rol === 'admin') { document.getElementById('adminTabBtn').style.display = 'block'; document.getElementById('planillasRecibidasBtn').style.display = 'block'; document.getElementById('ordenesBtn').style.display = 'block'; } else { document.getElementById('adminTabBtn').style.display = 'none'; document.getElementById('planillasRecibidasBtn').style.display = 'none'; document.getElementById('ordenesBtn').style.display = 'none'; } cargarDatosLocales(); iniciarPing(); initPlanillaFecha(); initOrdenes(); cargarSelectoresOT(); showToast('✅ Sesión restaurada'); } } catch(e) {}
}

document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && document.getElementById('loginScreen').style.display !== 'none') doLogin(); });
setTimeout(() => { if (document.getElementById('ordenesSection')) { initOrdenes(); cargarSelectoresOT(); } }, 500);

console.log('🏭 Sistema de Stock Pañol ECO FACTORY');
console.log('📸 Múltiples imágenes + Carrousel + Vista empleado - ACTIVADO');
console.log('👥 Usuarios: admin/admin123, empleado1/empleado123');
console.log('💡 Para depurar: verDatosOT()');

function verDatosOT() { console.log('📋 Órdenes:', ordenes.length); console.log('📦 Ítems:', items.length); console.log('🖼️ Ítems con imágenes:', items.filter(i => i.imagenes && i.imagenes.length > 0).length); console.log('🎠 Carrousel intervals activos:', Object.keys(carrouselIntervals).length); }
