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
        if (endpoint === '/api/items') {
            return Promise.resolve(items);
        }
        if (endpoint === '/api/movimientos') {
            return Promise.resolve(movs);
        }
        if (endpoint === '/api/stats') {
            return Promise.resolve({
                totalItems: items.length,
                sinStock: items.filter(i => stockActual(i) <= 0).length,
                criticos: items.filter(i => esCritico(i)).length,
                totalMovimientos: movs.length,
                categorias: [...new Set(items.map(i => i.categoria || 'Sin categoría'))].length
            });
        }
        if (endpoint === '/api/planillas') {
            return Promise.resolve(planillas);
        }
        if (endpoint.startsWith('/api/planillas/') && options.method === 'DELETE') {
            return Promise.resolve({ success: true });
        }
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
        if (endpoint === '/api/backup') {
            return Promise.resolve({ items, movimientos: movs, planillas, usuarios: USUARIOS_LOCALES });
        }
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
            { codigo: "PAN-001", descripcion: "Guante de cuero Talle 9", categoria: "EPP", unidad: "Par", minimo: 5, maximo: 20, inicial: 12, ubicacion: "E1-A1", planta: "Planta 1", obs: "", critico: "NO" },
            { codigo: "PAN-002", descripcion: "Casco de seguridad blanco", categoria: "EPP", unidad: "Unidad", minimo: 3, maximo: 15, inicial: 7, ubicacion: "E1-A2", planta: "Planta 1", obs: "", critico: "NO" },
            { codigo: "PAN-003", descripcion: "Lente de seguridad claro", categoria: "EPP", unidad: "Unidad", minimo: 10, maximo: 40, inicial: 23, ubicacion: "E1-A3", planta: "Planta 1", obs: "", critico: "NO" },
            { codigo: "PAN-005", descripcion: "Grasa litio multiuso 500g", categoria: "Lubricantes", unidad: "Kg", minimo: 3, maximo: 10, inicial: 5, ubicacion: "E3-A1", planta: "Planta 1", obs: "", critico: "NO" },
            { codigo: "PAN-006", descripcion: "Aceite hidráulico ISO 46 20L", categoria: "Lubricantes", unidad: "Bidón", minimo: 1, maximo: 5, inicial: 2, ubicacion: "E3-A2", planta: "Planta 1", obs: "", critico: "SI" },
            { codigo: "PAN-010", descripcion: "Disco de corte 115mm", categoria: "Abrasivos", unidad: "Unidad", minimo: 20, maximo: 80, inicial: 35, ubicacion: "E5-A1", planta: "Planta 1", obs: "", critico: "NO" },
            { codigo: "PAN-015", descripcion: "Rodamiento 6205 ZZ", categoria: "Rodamientos", unidad: "Unidad", minimo: 2, maximo: 8, inicial: 1, ubicacion: "E7-A2", planta: "Planta 1", obs: "", critico: "SI" },
            { codigo: "PAN-016", descripcion: "Filtro hidráulico HF7", categoria: "Filtros", unidad: "Unidad", minimo: 1, maximo: 6, inicial: 3, ubicacion: "E8-A1", planta: "Planta 1", obs: "", critico: "NO" }
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
    if (tab === 'planilla') {
        initPlanillaFecha();
    }
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
//  RENDER STOCK - CON IMÁGENES
// ============================================================
function renderStock() {
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

    if (activeKpiFilter === 'sinstock') {
        filtrados = filtrados.filter(i => stockActual(i) <= 0);
    } else if (activeKpiFilter === 'criticos') {
        filtrados = filtrados.filter(i => esCritico(i));
    }

    const tableBody = document.getElementById('stockTable');
    tableBody.innerHTML = '';

    if (filtrados.length === 0) {
        tableBody.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-title">Sin resultados</div></div>';
        return;
    }

    tableBody.innerHTML = filtrados.map((item) => {
        const actual = stockActual(item);
        const e = estadoItem(actual, item.minimo, item);
        const criticoLabel = esCritico(item) ? 'SI' : 'NO';
        
        // Generar HTML de la imagen (si existe)
        let imagenHtml = '';
        if (item.imagen) {
            imagenHtml = `<img src="${item.imagen}" alt="${item.codigo}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;border:1px solid var(--borde);">`;
        } else {
            imagenHtml = `<span style="font-size:20px;color:var(--sub);">📦</span>`;
        }

        return `<div class="table-row" onclick="editItemFromTable('${item.codigo}')" title="Click para editar">
            <span class="code-cell" style="display:flex;align-items:center;gap:8px;">
                ${imagenHtml}
                ${item.codigo}
            </span>
            <span class="desc-cell">${item.descripcion}</span>
            <span class="cat-cell">${item.categoria || '—'}</span>
            <span class="num-cell">${item.minimo}</span>
            <span class="stock-cell" style="color:${actual <= item.minimo ? e.color : 'var(--texto)'}">${actual}</span>
            <span class="num-cell">${item.maximo}</span>
            <span style="font-size:10px;color:var(--sub);">${item.ubicacion || '—'}</span>
            <span style="text-align:center;"><span class="badge" style="background:${e.bg};color:${e.color};border:1px solid ${e.color}33;">${e.label}</span></span>
        </div>`;
    }).join('');
}

function filterStock() {
    activeKpiFilter = 'todos';
    renderStock();
}

function editItemFromTable(codigo) {
    switchTab('editar');
    loadItemForEdit(codigo);
}

// ============================================================
//  EDITAR (solo admin) - CON IMÁGENES
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
    if (currentUser?.rol !== 'admin') {
        showToast('Solo administradores pueden editar', false);
        return;
    }
    const item = items.find(i => i.codigo === codigo);
    if (!item) return;

    editingItemCodigo = codigo;
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
    
    // === CARGAR IMAGEN ===
    if (item.imagen) {
        document.getElementById('editImageDisplay').src = item.imagen;
        document.getElementById('editImageDisplay').style.display = 'block';
        document.getElementById('editImagePlaceholder').style.display = 'none';
        document.getElementById('editImageInfo').textContent = '✅ Imagen cargada';
    } else {
        document.getElementById('editImageDisplay').style.display = 'none';
        document.getElementById('editImagePlaceholder').style.display = 'flex';
        document.getElementById('editImageInfo').textContent = '';
    }
    
    document.getElementById('editFormContainer').style.display = 'block';
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

    // === GUARDAR IMAGEN ===
    const imagenDisplay = document.getElementById('editImageDisplay');
    if (imagenDisplay.style.display !== 'none' && imagenDisplay.src && !imagenDisplay.src.includes('placeholder')) {
        updatedItem.imagen = imagenDisplay.src;
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
    editingItemCodigo = null;
    document.getElementById('editSearchInput').value = '';
    document.getElementById('editSuggestions').classList.remove('show');
    document.getElementById('editFormContainer').style.display = 'none';
}

function resetEditForm() {
    cancelEdit();
}

// ============================================================
//  FUNCIONES PARA IMÁGENES
// ============================================================

function cargarImagenEdit(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (file.size > 5 * 1024 * 1024) {
        showToast('La imagen es demasiado grande (máx 5MB)', false);
        return;
    }
    
    if (!file.type.startsWith('image/')) {
        showToast('El archivo debe ser una imagen', false);
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const imagenData = e.target.result;
        document.getElementById('editImageDisplay').src = imagenData;
        document.getElementById('editImageDisplay').style.display = 'block';
        document.getElementById('editImagePlaceholder').style.display = 'none';
        document.getElementById('editImageInfo').textContent = '✅ Imagen cargada: ' + file.name + ' (' + Math.round(file.size/1024) + 'KB)';
        showToast('✅ Imagen cargada correctamente');
    };
    reader.onerror = function() {
        showToast('❌ Error al cargar la imagen', false);
    };
    reader.readAsDataURL(file);
}

function tomarFotoEdit() {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.capture = 'environment';
        input.onchange = function(e) {
            if (e.target.files && e.target.files[0]) {
                cargarImagenEdit(e);
            }
            input.remove();
        };
        input.click();
    } else {
        document.getElementById('editImageInput').click();
    }
}

function eliminarImagenEdit() {
    if (!confirm('¿Eliminar la imagen del componente?')) return;
    
    document.getElementById('editImageDisplay').src = '';
    document.getElementById('editImageDisplay').style.display = 'none';
    document.getElementById('editImagePlaceholder').style.display = 'flex';
    document.getElementById('editImageInfo').textContent = '🗑️ Imagen eliminada';
    document.getElementById('editImageInput').value = '';
    showToast('🗑️ Imagen eliminada');
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
    if (currentUser?.rol !== 'admin') {
        showToast('Solo administradores pueden crear nuevos ítems', false);
        return;
    }
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
    isCreatingNew
