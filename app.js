// ============================================================
//  CONFIGURACIÓN - CONECTADO AL SERVIDOR EN RENDER
// ============================================================
const API_URL = 'https://panol-eco-factory.onrender.com';

// ============================================================
//  USUARIOS LOCALES (solo para login de emergencia)
// ============================================================
const USUARIOS_LOCALES = {
    admin: { password: 'admin123', rol: 'admin' }
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
let planillas = [];
let planillasInterval = null;

// POLLING DE STOCK
let stockPollingInterval = null;

// ÓRDENES DE TRABAJO
let ordenes = [];
let maquinasList = ['Torno CNC-12', 'Fresadora', 'Prensa hidráulica', 'Compresor', 'Cinta transportadora'];
let tecnicosList = ['Juan Pérez', 'María Gómez', 'Carlos López', 'Ana Martínez'];
let modulosList = ['Cabezal', 'Panel de control', 'Motor', 'Bomba hidráulica', 'Sistema eléctrico'];

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
//  API HELPER - TODAS LAS LLAMADAS AL SERVIDOR
// ============================================================
function apiCall(endpoint, options = {}) {
    // Si estamos en modo local (sin token o fallback)
    const isLocal = !token || (currentUser && USUARIOS_LOCALES[currentUser.username]);
    
    if (isLocal) {
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
        if (endpoint === '/api/backup') return Promise.resolve({ items, movimientos: movs, planillas });
        return Promise.resolve({ success: true });
    }

    return fetch(`${API_URL}${endpoint}`, {
            ...options,
            headers: { 'Content-Type': 'application/json', 'Authorization': token, ...(options.headers || {}) }
        })
        .then(res => {
            if (!res.ok) throw new Error('Error ' + res.status);
            return res.json();
        })
        .then(data => {
            if (data.error) throw new Error(data.error);
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

    fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    })
    .then(res => res.json())
    .then(data => {
        showLoading(false);
        if (data.error) {
            if (USUARIOS_LOCALES[username] && USUARIOS_LOCALES[username].password === password) {
                loginLocal(username);
                showToast('⚠️ Modo local (sin conexión al servidor)');
                return;
            }
            showLoginError(data.error);
            return;
        }
        token = data.token;
        currentUser = data;
        mostrarApp(data);
        cargarTodosLosDatos();
        iniciarPing();
        initPlanillaFecha();
        iniciarPollingPlanillas();
        iniciarPollingStock();
        initOrdenes();
        cargarSelectoresOT();
        showToast('✅ Bienvenido ' + data.username);
    })
    .catch(err => {
        showLoading(false);
        if (USUARIOS_LOCALES[username] && USUARIOS_LOCALES[username].password === password) {
            loginLocal(username);
            showToast('⚠️ Sin conexión - Modo local');
            return;
        }
        showLoginError('Error al conectar con el servidor');
        console.error(err);
    });
}

function loginLocal(username) {
    token = 'token_local_' + username + '_' + Date.now();
    currentUser = { username: username, rol: USUARIOS_LOCALES[username].rol };
    mostrarApp(currentUser);
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
    movs = [];
    planillas = [];
    renderStock();
    renderHistory();
    renderCategorias();
    updateKPIsLocales();
    iniciarPing();
    initPlanillaFecha();
    initOrdenes();
    cargarSelectoresOT();
}

function mostrarApp(data) {
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
}

function doLogout() {
    detenerPollingPlanillas();
    detenerPollingStock();
    if (token && !token.startsWith('token_local_')) {
        fetch(`${API_URL}/api/logout`, { method: 'POST', headers: { 'Authorization': token } }).catch(() => {});
    }
    token = null;
    currentUser = null;
    items = [];
    movs = [];
    planillas = [];
    document.getElementById('appScreen').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('loginPass').value = '';
    document.getElementById('loginError').className = 'login-error';
    detenerPing();
}

function showLoginError(msg) { const el = document.getElementById('loginError'); el.textContent = msg; el.className = 'login-error show'; }
function showLoading(show) { document.getElementById('loadingOverlay').className = show ? 'loading-overlay show' : 'loading-overlay'; }

// ============================================================
//  CARGAR TODOS LOS DATOS DEL SERVIDOR
// ============================================================
function cargarTodosLosDatos() {
    showLoading(true);
    
    Promise.all([
        apiCall('/api/items'),
        apiCall('/api/movimientos'),
        apiCall('/api/stats'),
        apiCall('/api/planillas')
    ])
    .then(([itemsData, movsData, statsData, planillasData]) => {
        items = itemsData || [];
        movs = movsData || [];
        planillas = planillasData || [];
        showLoading(false);
        updateKPIsFromStats(statsData);
        renderStock();
        renderHistory();
        renderCategorias();
        actualizarContadorPlanillas();
        document.getElementById('syncStatus').textContent = '●';
        document.getElementById('syncStatus').className = 'sync-status';
        console.log('✅ Datos recargados: ' + items.length + ' ítems, ' + movs.length + ' movimientos');
        showToast('✅ Datos recargados (' + items.length + ' ítems)');
    })
    .catch(err => {
        showLoading(false);
        document.getElementById('syncStatus').textContent = '⚠️';
        document.getElementById('syncStatus').className = 'sync-status error';
        showToast('❌ Error al cargar datos: ' + err.message, false);
    });
}

function updateKPIsFromStats(stats) {
    document.getElementById('kpiTotal').textContent = stats.totalItems || 0;
    document.getElementById('kpiSinStock').textContent = stats.sinStock || 0;
    document.getElementById('kpiCriticos').textContent = stats.criticos || 0;
    document.getElementById('kpiCategorias').textContent = stats.categorias || 0;
    document.getElementById('kpiMovs').textContent = stats.totalMovimientos || 0;
}

function updateKPIsLocales() {
    document.getElementById('kpiTotal').textContent = items.length;
    document.getElementById('kpiSinStock').textContent = items.filter(i => stockActual(i) <= 0).length;
    document.getElementById('kpiCriticos').textContent = items.filter(i => esCritico(i)).length;
    document.getElementById('kpiCategorias').textContent = [...new Set(items.map(i => i.categoria || 'Sin categoría'))].length;
    document.getElementById('kpiMovs').textContent = movs.length;
}

function actualizarContadorPlanillas() {
    const tab = document.querySelector('.tab-btn[data-tab="planillasRecibidas"]');
    if (!tab) return;
    
    let badge = tab.querySelector('.badge-count-tab');
    if (!badge && currentUser?.rol === 'admin') {
        badge = document.createElement('span');
        badge.className = 'badge-count-tab';
        badge.style.cssText = 'background:var(--rojo);color:#fff;border-radius:50%;padding:0px 6px;font-size:9px;font-weight:700;margin-left:4px;';
        tab.appendChild(badge);
    }
    if (badge) {
        badge.textContent = planillas.length > 0 ? planillas.length : '';
    }
}

// ============================================================
//  SINCRONIZACIÓN MANUAL (DESDE EL SERVIDOR)
// ============================================================
function sincronizarManual() {
    if (!token) {
        showToast('⚠️ Sin sesión activa', false);
        return;
    }
    
    const btn = document.querySelector('.sync-btn');
    if (btn) btn.classList.add('sync-active');
    
    showLoading(true);
    showToast('🔄 Sincronizando con servidor...');
    
    Promise.all([
        apiCall('/api/items'),
        apiCall('/api/movimientos'),
        apiCall('/api/planillas')
    ])
    .then(([itemsData, movsData, planillasData]) => {
        if (itemsData && itemsData.length > 0) {
            items = itemsData;
            movs = movsData || [];
            planillas = planillasData || [];
            renderStock();
            renderHistory();
            renderCategorias();
            updateKPIsLocales();
            actualizarContadorPlanillas();
            showLoading(false);
            if (btn) btn.classList.remove('sync-active');
            document.getElementById('syncStatus').textContent = '●';
            document.getElementById('syncStatus').className = 'sync-status';
            showToast('✅ Sincronizado: ' + items.length + ' ítems, ' + movs.length + ' movimientos');
        } else {
            showLoading(false);
            if (btn) btn.classList.remove('sync-active');
            document.getElementById('syncStatus').textContent = '⚠️';
            document.getElementById('syncStatus').className = 'sync-status error';
            showToast('⚠️ El servidor no tiene datos. Importá un Excel desde Admin.', false);
        }
    })
    .catch(err => {
        console.error('❌ Error en sincronización:', err);
        showLoading(false);
        if (btn) btn.classList.remove('sync-active');
        document.getElementById('syncStatus').textContent = '⚠️';
        document.getElementById('syncStatus').className = 'sync-status error';
        showToast('❌ Error al sincronizar: ' + err.message, false);
    });
}

// ============================================================
//  POLLING DE STOCK
// ============================================================
function iniciarPollingStock() {
    detenerPollingStock();
    if (!token || token.startsWith('token_local_')) return;
    
    stockPollingInterval = setInterval(() => {
        if (!document.hidden) {
            sincronizarStock();
        }
    }, 15000);
}

function detenerPollingStock() {
    if (stockPollingInterval) {
        clearInterval(stockPollingInterval);
        stockPollingInterval = null;
    }
}

function sincronizarStock() {
    if (!token || token.startsWith('token_local_')) return;
    
    apiCall('/api/items')
        .then(data => {
            if (data && data.length > 0 && JSON.stringify(items) !== JSON.stringify(data)) {
                items = data;
                if (currentTab === 'stock') renderStock();
                if (currentTab === 'categorias') renderCategorias();
                updateKPIsLocales();
                console.log('🔄 Stock actualizado automáticamente (' + items.length + ' ítems)');
            }
        })
        .catch(() => {});
}

// ============================================================
//  PING
// ============================================================
function iniciarPing() { setTimeout(hacerPing, 2000); pingInterval = setInterval(hacerPing, 240000); }
function detenerPing() { if (pingInterval) { clearInterval(pingInterval); pingInterval = null; } document.getElementById('pingStatus').textContent = '⏱ Detenido'; document.getElementById('pingStatus').className = 'ping-status'; }
function hacerPing() {
    pingContador++;
    fetch(`${API_URL}/api/items`, { headers: { 'Authorization': token || '' }, signal: AbortSignal.timeout(10000) })
        .then(() => { const s = document.getElementById('pingStatus'); s.textContent = `⏱ ${pingContador} ✅`; s.className = 'ping-status active'; })
        .catch(() => { const s = document.getElementById('pingStatus'); s.textContent = `⏱ ${pingContador} ⚠️`; s.className = 'ping-status'; });
}

// ============================================================
//  TABS
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.tab-btn').forEach(btn => { btn.addEventListener('click', function() { switchTab(this.dataset.tab); }); });
    document.querySelectorAll('.kpi-card').forEach(card => { card.addEventListener('click', function() { if (this.dataset.filter) filterByKPI(this.dataset.filter); if (this.dataset.tab) switchTab(this.dataset.tab); }); });
});

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const section = document.getElementById(tab + 'Section'); if (section) section.classList.add('active');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.tab-btn[data-tab="${tab}"]`)?.classList.add('active');
    if (tab === 'stock') renderStock();
    if (tab === 'historial') renderHistory();
    if (tab === 'movimiento') updateNewItemVisibility();
    if (tab === 'editar') resetEditForm();
    if (tab === 'categorias') renderCategorias();
    if (tab === 'planilla') initPlanillaFecha();
    if (tab === 'planillasRecibidas' && currentUser?.rol === 'admin') { renderPlanillasRecibidas(); }
    if (tab === 'ordenes' && currentUser?.rol === 'admin') { initOrdenes(); cargarSelectoresOT(); renderTablaOT(); }
}

function showToast(msg, success = true) {
    const toast = document.getElementById('toast'); toast.textContent = msg;
    toast.className = 'toast show ' + (success ? 'toast-success' : 'toast-error');
    clearTimeout(toast._timeout); toast._timeout = setTimeout(() => toast.classList.remove('show'), 4000);
}

function filterByKPI(filter) { activeKpiFilter = filter; switchTab('stock'); const si = document.querySelector('.search-input'); const cs = document.querySelector('.category-select'); if (si) si.value = ''; if (cs) cs.value = 'Todas'; renderStock(); }

// ============================================================
//  🔥 RENDER STOCK - TARJETAS CON CARROUSEL AUTOMÁTICO 🔥
// ============================================================
function renderStock() {
    Object.values(carrouselIntervals).forEach(clearInterval); carrouselIntervals = {};
    const searchInput = document.querySelector('.search-input'); const catSelect = document.querySelector('.category-select');
    const q = searchInput?.value.toLowerCase() || ''; const cat = catSelect?.value || 'Todas';
    const categorias = ['Todas', ...new Set(items.map(i => i.categoria || 'Sin categoría'))];
    if (catSelect) catSelect.innerHTML = categorias.map(c => `<option ${c === cat ? 'selected' : ''}>${c}</option>`).join('');
    let filtrados = items.filter(i => { const mQ = !q || i.codigo.toLowerCase().includes(q) || i.descripcion.toLowerCase().includes(q); const mC = cat === 'Todas' || (i.categoria || 'Sin categoría') === cat; return mQ && mC; });
    if (activeKpiFilter === 'sinstock') filtrados = filtrados.filter(i => stockActual(i) <= 0);
    else if (activeKpiFilter === 'criticos') filtrados = filtrados.filter(i => esCritico(i));
    const container = document.getElementById('stockCardsContainer'); if (!container) return; container.innerHTML = '';
    if (filtrados.length === 0) { 
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-title">Sin resultados</div><div class="empty-sub" style="font-size:12px;color:var(--sub);margin-top:4px;">' + (items.length === 0 ? '⚠️ No hay ítems cargados. Usá "Sincronizar" 🔄 o importá desde Admin.' : '') + '</div></div>'; 
        return; 
    }
    filtrados.forEach((item) => {
        const actual = stockActual(item); const e = estadoItem(actual, item.minimo, item);
        const todasImagenes = []; if (item.imagenes && item.imagenes.length > 0) todasImagenes.push(...item.imagenes); else if (item.imagen) todasImagenes.push(item.imagen);
        const card = document.createElement('div'); card.className = 'stock-card'; card.onclick = () => editItemFromTable(item.codigo); card.title = 'Click para ver';
        const imgContainer = document.createElement('div'); imgContainer.className = 'card-img-container';
        if (todasImagenes.length > 0) {
            const img = document.createElement('img'); img.src = todasImagenes[0]; img.alt = item.descripcion; img.className = 'card-img'; img.loading = 'lazy'; imgContainer.appendChild(img);
            if (todasImagenes.length > 1) { const badge = document.createElement('span'); badge.className = 'card-img-badge'; badge.textContent = `${todasImagenes.length} fotos`; imgContainer.appendChild(badge); }
            if (todasImagenes.length > 1) {
                const dotsContainer = document.createElement('div'); dotsContainer.className = 'card-dots';
                todasImagenes.forEach((_, idx) => { const dot = document.createElement('span'); dot.className = 'card-dot' + (idx === 0 ? ' active' : ''); dotsContainer.appendChild(dot); });
                imgContainer.appendChild(dotsContainer);
                let currentIdx = 0; const intervalId = setInterval(() => { currentIdx = (currentIdx + 1) % todasImagenes.length; img.src = todasImagenes[currentIdx]; const dots = dotsContainer.querySelectorAll('.card-dot'); dots.forEach((d, i) => d.classList.toggle('active', i === currentIdx)); }, 3000);
                carrouselIntervals[item.codigo] = intervalId;
            }
        } else { const placeholder = document.createElement('span'); placeholder.className = 'card-img-placeholder'; placeholder.textContent = '📦'; imgContainer.appendChild(placeholder); }
        card.appendChild(imgContainer);
        const info = document.createElement('div'); info.className = 'card-info';
        info.innerHTML = `<div class="card-descripcion">${item.descripcion}</div><div class="card-codigo">${item.codigo}</div><div class="card-stock" style="color: ${actual <= item.minimo ? e.color : 'var(--verdeM)'}">Stock: ${actual} ${item.unidad || 'u.'}</div><span class="badge" style="background:${e.bg};color:${e.color};border:1px solid ${e.color}33;margin-top:4px;">${e.label}</span>`;
        card.appendChild(info); container.appendChild(card);
    });
}

function filterStock() { activeKpiFilter = 'todos'; renderStock(); }
function editItemFromTable(codigo) { switchTab('editar'); loadItemForEdit(codigo); }

// ============================================================
//  EDITAR / VER COMPONENTE (ADMIN Y EMPLEADO)
// ============================================================
function searchItemToEdit() {
    const val = document.getElementById('editSearchInput').value.trim().toUpperCase(); const suggestions = document.getElementById('editSuggestions');
    if (!val) { suggestions.classList.remove('show'); return; }
    if (val.length >= 2) {
        const results = items.filter(i => i.codigo.toLowerCase().includes(val.toLowerCase()) || i.descripcion.toLowerCase().includes(val.toLowerCase())).slice(0, 8);
        if (results.length > 0) { suggestions.innerHTML = results.map(s => `<div class="suggestion-item" onclick="loadItemForEdit('${s.codigo}')"><span><strong style="color:var(--verde);">${s.codigo}</strong> ${s.descripcion}</span></div>`).join(''); suggestions.classList.add('show'); }
        else { suggestions.classList.remove('show'); }
    } else { suggestions.classList.remove('show'); }
}

function loadItemForEdit(codigo) {
    const item = items.find(i => i.codigo === codigo); if (!item) return;
    editingItemCodigo = codigo; const esAdmin = currentUser?.rol === 'admin';
    const searchInput = document.getElementById('editSearchInput').value.trim(); let itemsFiltrados = items;
    if (searchInput && !searchInput.includes(' - ')) { const q = searchInput.toLowerCase(); itemsFiltrados = items.filter(i => i.codigo.toLowerCase().includes(q) || i.descripcion.toLowerCase().includes(q)); }
    const currentIndex = itemsFiltrados.findIndex(i => i.codigo === codigo); const totalItems = itemsFiltrados.length;
    const tieneAnterior = currentIndex > 0; const tieneSiguiente = currentIndex < totalItems - 1;
    const itemAnterior = tieneAnterior ? itemsFiltrados[currentIndex - 1] : null; const itemSiguiente = tieneSiguiente ? itemsFiltrados[currentIndex + 1] : null;
    document.getElementById('editSearchInput').value = item.codigo + ' - ' + item.descripcion; document.getElementById('editSuggestions').classList.remove('show');
    document.getElementById('editItemName').textContent = item.descripcion; document.getElementById('editItemStock').textContent = stockActual(item); document.getElementById('editItemUnit').textContent = item.unidad || 'unidades';
    document.getElementById('editCodigo').value = item.codigo; document.getElementById('editDescripcion').value = item.descripcion;
    document.getElementById('editCategoria').value = item.categoria || ''; document.getElementById('editUnidad').value = item.unidad || 'Unidad';
    document.getElementById('editInicial').value = item.inicial; document.getElementById('editMinimo').value = item.minimo; document.getElementById('editMaximo').value = item.maximo;
    document.getElementById('editUbicacion').value = item.ubicacion || ''; document.getElementById('editPlanta').value = item.planta || '';
    document.getElementById('editCritico').value = item.critico || 'NO'; document.getElementById('editObs').value = item.obs || '';
    const inputs = document.querySelectorAll('#editFormContainer .form-input'); inputs.forEach(input => { if (input.id === 'editSearchInput') return; input.disabled = !esAdmin; input.readOnly = !esAdmin; });
    const btnGroup = document.querySelector('#editFormContainer .btn-group'); if (btnGroup) btnGroup.style.display = esAdmin ? 'flex' : 'none';
    const itemInfoName = document.querySelector('#editFormContainer .item-info-name');
    if (itemInfoName) itemInfoName.innerHTML = esAdmin ? `✏️ Editando: <span id="editItemName">${item.descripcion}</span>` : `👁️ Viendo: <span id="editItemName">${item.descripcion}</span>`;
    actualizarNavegacionEdicion(itemAnterior, itemSiguiente, tieneAnterior, tieneSiguiente);
    renderImagenesGrid(item.imagenes || []); const uploadArea = document.getElementById('editImagenesUpload'); if (uploadArea) uploadArea.style.display = esAdmin ? 'block' : 'none';
    if (!esAdmin) setTimeout(() => { document.querySelectorAll('.btn-eliminar-imagen').forEach(b => b.style.display = 'none'); }, 100);
    document.getElementById('editFormContainer').style.display = 'block';
}

// ============================================================
//  NAVEGACIÓN ENTRE COMPONENTES
// ============================================================
function actualizarNavegacionEdicion(itemAnterior, itemSiguiente, tieneAnterior, tieneSiguiente) {
    let navContainer = document.getElementById('editNavContainer');
    if (!navContainer) { navContainer = document.createElement('div'); navContainer.id = 'editNavContainer'; navContainer.className = 'edit-nav-container'; const itemInfo = document.querySelector('#editFormContainer .item-info'); if (itemInfo) itemInfo.after(navContainer); else { const fc = document.getElementById('editFormContainer'); fc.insertBefore(navContainer, fc.firstChild); } }
    if (!tieneAnterior && !tieneSiguiente) { navContainer.style.display = 'none'; return; }
    navContainer.style.display = 'flex';
    navContainer.innerHTML = `<button class="edit-nav-btn prev" onclick="navegarComponente('${itemAnterior?.codigo || ''}')" ${!tieneAnterior ? 'disabled' : ''} title="${itemAnterior ? 'Anterior: ' + itemAnterior.descripcion : 'No hay anterior'}">◀ Anterior</button><span class="edit-nav-counter"><strong>${editingItemCodigo}</strong></span><button class="edit-nav-btn next" onclick="navegarComponente('${itemSiguiente?.codigo || ''}')" ${!tieneSiguiente ? 'disabled' : ''} title="${itemSiguiente ? 'Siguiente: ' + itemSiguiente.descripcion : 'No hay siguiente'}">Siguiente ▶</button>`;
}

function navegarComponente(codigo) { if (!codigo) return; const fc = document.getElementById('editFormContainer'); fc.style.opacity = '0'; fc.style.transform = 'translateX(20px)'; fc.style.transition = 'all 0.15s ease'; setTimeout(() => { loadItemForEdit(codigo); fc.style.opacity = '1'; fc.style.transform = 'translateX(0)'; }, 150); }
function cerrarVistaComponente() { editingItemCodigo = null; imagenesTemporales = []; document.getElementById('editSearchInput').value = ''; document.getElementById('editSuggestions').classList.remove('show'); document.getElementById('editFormContainer').style.display = 'none'; const nc = document.getElementById('editNavContainer'); if (nc) nc.remove(); }

function saveEdit() {
    if (currentUser?.rol !== 'admin') { showToast('Solo administradores pueden editar', false); return; }
    if (!editingItemCodigo) { showToast('Seleccioná un ítem para editar', false); return; }
    const newCodigo = document.getElementById('editCodigo').value.trim(); const newDescripcion = document.getElementById('editDescripcion').value.trim();
    if (!newCodigo || !newDescripcion) { showToast('Código y descripción son obligatorios', false); return; }
    if (newCodigo !== editingItemCodigo && items.find(i => i.codigo === newCodigo)) { showToast('El código ' + newCodigo + ' ya existe', false); return; }
    let criticoVal = document.getElementById('editCritico').value.trim().toUpperCase(); if (!['SI', 'NO'].includes(criticoVal)) criticoVal = 'NO';
    const updatedItem = { codigo: newCodigo, descripcion: newDescripcion, categoria: document.getElementById('editCategoria').value.trim() || 'Sin categoría', unidad: document.getElementById('editUnidad').value, inicial: Number(document.getElementById('editInicial').value) || 0, minimo: Number(document.getElementById('editMinimo').value) || 1, maximo: Number(document.getElementById('editMaximo').value) || 10, ubicacion: document.getElementById('editUbicacion').value.trim(), planta: document.getElementById('editPlanta').value.trim(), critico: criticoVal, obs: document.getElementById('editObs').value.trim() };
    if (imagenesTemporales.length > 0) { updatedItem.imagenes = [...imagenesTemporales]; updatedItem.imagen = imagenesTemporales[0]; } else { updatedItem.imagenes = []; updatedItem.imagen = null; }
    showLoading(true);
    if (token && token.startsWith('token_local_')) {
        const idx = items.findIndex(i => i.codigo === editingItemCodigo);
        if (idx !== -1) items[idx] = updatedItem;
        editingItemCodigo = newCodigo;
        showLoading(false);
        showToast('✅ Ítem actualizado (local)');
        loadItemForEdit(newCodigo);
        renderStock();
        renderCategorias();
        return;
    }
    apiCall(`/api/items/${editingItemCodigo}`, { method: 'PUT', body: JSON.stringify(updatedItem) })
        .then(() => {
            const idx = items.findIndex(i => i.codigo === editingItemCodigo);
            if (idx !== -1) items[idx] = updatedItem;
            editingItemCodigo = newCodigo;
            showLoading(false);
            showToast('✅ Ítem actualizado');
            loadItemForEdit(newCodigo);
            renderStock();
            renderCategorias();
            cargarTodosLosDatos();
        })
        .catch(err => { showLoading(false); showToast('❌ Error: ' + err.message, false); });
}

function cancelEdit() { cerrarVistaComponente(); }
function resetEditForm() { cancelEdit(); }

// ============================================================
//  FUNCIONES PARA MÚLTIPLES IMÁGENES
// ============================================================
function renderImagenesGrid(imagenes) { const grid = document.getElementById('editImagenesGrid'); const infoEl = document.getElementById('editImagenesInfo'); imagenesTemporales = [...imagenes]; grid.innerHTML = ''; if (imagenes.length > 0) infoEl.textContent = `📸 ${imagenes.length} imagen(es) · ${calcularPesoImagenes(imagenes)}`; else infoEl.textContent = '📸 Sin imágenes'; if (imagenes.length === 0) { grid.innerHTML = `<div class="imagenes-empty"><span class="empty-img-icon">📷</span><span style="font-size:12px;font-weight:600;">Sin imágenes</span></div>`; return; } imagenes.forEach((imgData, index) => { const card = document.createElement('div'); card.className = 'imagen-card'; card.innerHTML = `<span class="imagen-index">#${index+1}</span><button class="btn-eliminar-imagen" onclick="event.stopPropagation();eliminarImagenIndividual(${index})">×</button><button class="btn-preview-imagen" onclick="event.stopPropagation();abrirVisorImagen(${index})">🔍</button><img src="${imgData}" loading="lazy">`; card.addEventListener('click', () => abrirVisorImagen(index)); grid.appendChild(card); }); }
function calcularPesoImagenes(imgs) { let t = 0; imgs.forEach(i => { if (i.startsWith('data:image')) { const b = i.split(',')[1]||''; t += Math.round((b.length*3)/4); } }); return t<1024?t+' B':t<1048576?(t/1024).toFixed(1)+' KB':(t/1048576).toFixed(2)+' MB'; }
function cargarMultiplesImagenes(event) { const files = Array.from(event.target.files); if (!files.length) return; if (imagenesTemporales.length + files.length > 5) { showToast('⚠️ Máximo 5 imágenes', false); return; } let c=0,e=0; files.forEach(f=>{ if(f.size>5242880){e++;return;} if(!f.type.startsWith('image/')){e++;return;} const r=new FileReader(); r.onload=function(ev){imagenesTemporales.push(ev.target.result);c++;if(c+e===files.length){renderImagenesGrid(imagenesTemporales);if(c>0)showToast(`✅ ${c} imagen(es)`);if(e>0)showToast(`⚠️ ${e} rechazados`,false);}}; r.onerror=function(){e++;if(c+e===files.length){renderImagenesGrid(imagenesTemporales);showToast('⚠️ Error',false);}}; r.readAsDataURL(f); }); event.target.value=''; }
function tomarMultiplesFotos() { if(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia){const i=document.createElement('input');i.type='file';i.accept='image/*';i.capture='environment';i.onchange=function(e){if(e.target.files&&e.target.files[0])cargarMultiplesImagenes({target:{files:[e.target.files[0]]}});i.remove();};i.click();}else document.getElementById('editMultipleImages').click(); }
function eliminarImagenIndividual(index) { if(!confirm(`¿Eliminar imagen #${index+1}?`))return; imagenesTemporales.splice(index,1); renderImagenesGrid(imagenesTemporales); showToast('🗑️ Eliminada'); }
function abrirVisorImagen(index) { const o=document.createElement('div'); o.className='modal-imagen-overlay'; o.id='modalVisorImagen'; o.innerHTML=`<div class="modal-imagen-content"><button class="modal-imagen-close" onclick="cerrarVisorImagen()">×</button><img src="${imagenesTemporales[index]}"><div class="modal-imagen-nav"><button onclick="navegarVisorImagen(${index-1})" ${index===0?'disabled':''}>◀</button><span class="modal-imagen-counter">${index+1}/${imagenesTemporales.length}</span><button onclick="navegarVisorImagen(${index+1})" ${index===imagenesTemporales.length-1?'disabled':''}>▶</button></div></div>`; o.addEventListener('click',function(e){if(e.target===o)cerrarVisorImagen();}); const esc=e=>{if(e.key==='Escape'){cerrarVisorImagen();document.removeEventListener('keydown',esc);}}; document.addEventListener('keydown',esc); document.body.appendChild(o); document.body.style.overflow='hidden'; }
function cerrarVisorImagen() { const o=document.getElementById('modalVisorImagen'); if(o){o.style.animation='fadeOut 0.2s forwards';setTimeout(()=>{o.remove();document.body.style.overflow='';},200);} }
function navegarVisorImagen(i) { if(i<0||i>=imagenesTemporales.length)return; cerrarVisorImagen(); setTimeout(()=>abrirVisorImagen(i),100); }

// ============================================================
//  MOVIMIENTOS
// ============================================================
function setTipo(tipo, btn) { currentTipo=tipo; document.querySelectorAll('.type-btn').forEach(b=>b.className='type-btn'); const ac=tipo==='SALIDA'?'active-salida':(tipo==='ENTRADA'||tipo==='DEVOLUCIÓN')?'active-entrada':'active-ajuste'; btn.classList.add(ac); document.getElementById('submitBtn').textContent='Registrar '+tipo+' →'; document.getElementById('submitBtn').style.background=tipo==='SALIDA'?'var(--rojo)':(tipo==='ENTRADA'||tipo==='DEVOLUCIÓN')?'var(--verdeM)':'var(--gris)'; updateNewItemVisibility(); if(tipo!=='ENTRADA')hideNewItemForm(); }
function updateNewItemVisibility() { document.getElementById('toggleNewItem').style.display=(currentTipo==='ENTRADA'&&currentTab==='movimiento')?'flex':'none'; }
function toggleNewItemForm() { if(currentUser?.rol!=='admin'){showToast('Solo admin',false);return;} isCreatingNewItem=!isCreatingNewItem; const f=document.getElementById('newItemForm'),cg=document.getElementById('codigoExistenteGroup'),ii=document.getElementById('itemInfo'),ti=document.getElementById('toggleNewItemIcon'),tt=document.getElementById('toggleNewItemText'); if(isCreatingNewItem){f.classList.add('show');cg.style.opacity='0.5';cg.style.pointerEvents='none';ii.classList.remove('show');document.getElementById('suggestions').classList.remove('show');ti.textContent='➖';tt.textContent='Seleccionar ítem existente';selectedItemCodigo=null;document.getElementById('codigoInput').value='';}else{hideNewItemForm();} }
function hideNewItemForm() { isCreatingNewItem=false; document.getElementById('newItemForm').classList.remove('show'); document.getElementById('codigoExistenteGroup').style.opacity='1'; document.getElementById('codigoExistenteGroup').style.pointerEvents='auto'; document.getElementById('toggleNewItemIcon').textContent='➕'; document.getElementById('toggleNewItemText').textContent='Crear nuevo ítem'; ['newCodigo','newDescripcion','newCategoria','newUbicacion','newPlanta','newCritico'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';}); const ni=document.getElementById('newInicial');if(ni)ni.value='0'; const nm=document.getElementById('newMinimo');if(nm)nm.value='1'; const nx=document.getElementById('newMaximo');if(nx)nx.value='10'; }
function searchItem() { if(isCreatingNewItem)return; const v=document.getElementById('codigoInput').value.trim().toUpperCase(),s=document.getElementById('suggestions'),ii=document.getElementById('itemInfo'); if(!v){s.classList.remove('show');ii.classList.remove('show');selectedItemCodigo=null;return;} const ex=items.find(i=>i.codigo===v); if(ex){s.classList.remove('show');mostrarInfoItem(ex);selectedItemCodigo=ex.codigo;}else if(v.length>=2){const r=items.filter(i=>i.codigo.toLowerCase().includes(v.toLowerCase())||i.descripcion.toLowerCase().includes(v.toLowerCase())).slice(0,6); if(r.length>0){s.innerHTML=r.map(i=>`<div class="suggestion-item" onclick="selectItem('${i.codigo}')"><span><strong style="color:var(--verde);">${i.codigo}</strong> ${i.descripcion}</span><span>Stock: ${stockActual(i)}</span></div>`).join(''); if(currentTipo==='ENTRADA'&&currentUser?.rol==='admin')s.innerHTML+=`<div class="suggestion-item new-item" onclick="toggleNewItemForm();document.getElementById('newCodigo').value='${v}';document.getElementById('suggestions').classList.remove('show');"><span>🆕 Crear: ${v}</span></div>`; s.classList.add('show');ii.classList.remove('show');selectedItemCodigo=null;}else{s.classList.remove('show');ii.classList.remove('show'); if(currentTipo==='ENTRADA'&&v.length>=2&&currentUser?.rol==='admin'){s.innerHTML=`<div class="suggestion-item new-item" onclick="toggleNewItemForm();document.getElementById('newCodigo').value='${v}';document.getElementById('suggestions').classList.remove('show');"><span>🆕 Crear: ${v}</span></div>`;s.classList.add('show');}} } }
function mostrarInfoItem(item) { document.getElementById('itemInfoDesc').textContent=item.descripcion; document.getElementById('itemInfoDetails').textContent=(item.categoria||'')+(item.ubicacion?' · '+item.ubicacion:'')+(item.planta?' · '+item.planta:'')+' · Crítico: '+(item.critico||'NO'); document.getElementById('itemInfoStock').textContent=stockActual(item); document.getElementById('itemInfoUnit').textContent=(item.unidad||'unidades')+' actuales'; document.getElementById('itemInfo').classList.add('show'); }
function selectItem(codigo) { document.getElementById('codigoInput').value=codigo; document.getElementById('suggestions').classList.remove('show'); const item=items.find(i=>i.codigo===codigo); if(item){mostrarInfoItem(item);selectedItemCodigo=codigo;hideNewItemForm();} document.getElementById('cantidadInput').focus(); }
function clearItemSelection() { document.getElementById('codigoInput').value=''; document.getElementById('itemInfo').classList.remove('show'); document.getElementById('suggestions').classList.remove('show'); selectedItemCodigo=null; hideNewItemForm(); document.getElementById('codigoInput').focus(); }

function registrarMovimiento() { const cant=Number(document.getElementById('cantidadInput').value),resp=document.getElementById('responsableInput').value.trim()||currentUser?.username||'',ot=document.getElementById('otInput').value.trim(),sec=document.getElementById('sectorInput').value.trim(),obs=document.getElementById('obsInput').value.trim(); if(!cant||cant<=0){showToast('Cantidad inválida',false);return;} let co,de,ca,un,mi,ma,ub,pl,cr; if(isCreatingNewItem){if(currentUser?.rol!=='admin'){showToast('Solo admin',false);return;} const nc=document.getElementById('newCodigo').value.trim(),nd=document.getElementById('newDescripcion').value.trim(); if(!nc){showToast('Código requerido',false);return;} if(!nd){showToast('Descripción requerida',false);return;} if(items.find(i=>i.codigo===nc)){showToast('Código existe',false);return;} co=nc;de=nd;ca=document.getElementById('newCategoria').value.trim()||'Sin categoría';un=document.getElementById('newUnidad').value;mi=Number(document.getElementById('newMinimo').value)||1;ma=Number(document.getElementById('newMaximo').value)||10;ub=document.getElementById('newUbicacion').value.trim();pl=document.getElementById('newPlanta').value.trim()||'Planta 1';cr=document.getElementById('newCritico').value.trim().toUpperCase()||'NO';if(!['SI','NO'].includes(cr))cr='NO'; showLoading(true); if(token && token.startsWith('token_local_')){items.push({codigo:co,descripcion:de,categoria:ca,unidad:un,inicial:Number(document.getElementById('newInicial').value)||0,minimo:mi,maximo:ma,ubicacion:ub,planta:pl,critico:cr,obs:'',imagenes:[]}); movs.unshift({id:Date.now(),fecha:new Date().toLocaleDateString('es-AR'),hora:new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}),tipo:currentTipo,codigo:co,descripcion:de,cantidad:cant,responsable:resp||currentUser.username,ot,sec,obs,usuario:currentUser.username}); showLoading(false);limpiarFormularioMovimiento();showToast('✓ '+currentTipo+' registrada — '+de);renderStock();renderHistory();renderCategorias();updateKPIsLocales();return;} apiCall('/api/items',{method:'POST',body:JSON.stringify({codigo:co,descripcion:de,categoria:ca,unidad:un,inicial:Number(document.getElementById('newInicial').value)||0,minimo:mi,maximo:ma,ubicacion:ub,planta:pl,critico:cr,obs:''})}).then(()=>registrarMovimientoEnServidor(co,de,cant,resp,ot,sec,obs,ca,un,mi,ma,ub,pl,cr)).then(()=>{showLoading(false);limpiarFormularioMovimiento();showToast('✓ '+currentTipo+' registrada — '+de);cargarTodosLosDatos();}).catch(err=>{showLoading(false);showToast('❌ '+err.message,false);});return;} if(!selectedItemCodigo){const v=document.getElementById('codigoInput').value.trim();const item=items.find(i=>i.codigo===v);if(!item){showToast('Seleccioná ítem',false);return;}selectedItemCodigo=item.codigo;} const item=items.find(i=>i.codigo===selectedItemCodigo);if(!item){showToast('Ítem no encontrado',false);return;}co=item.codigo;de=item.descripcion; if(currentTipo==='SALIDA'&&cant>stockActual(item)){showToast('Stock insuficiente: '+stockActual(item),false);return;} showLoading(true); if(token && token.startsWith('token_local_')){movs.unshift({id:Date.now(),fecha:new Date().toLocaleDateString('es-AR'),hora:new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}),tipo:currentTipo,codigo:co,descripcion:de,cantidad:cant,responsable:resp||currentUser.username,ot,sec,obs,usuario:currentUser.username});showLoading(false);limpiarFormularioMovimiento();showToast('✓ '+currentTipo+' registrada — '+de);renderStock();renderHistory();renderCategorias();updateKPIsLocales();return;} registrarMovimientoEnServidor(co,de,cant,resp,ot,sec,obs).then(()=>{showLoading(false);limpiarFormularioMovimiento();showToast('✓ '+currentTipo+' registrada — '+de);cargarTodosLosDatos();}).catch(err=>{showLoading(false);showToast('❌ '+err.message,false);}); }
function registrarMovimientoEnServidor(co,de,cant,resp,ot,sec,obs,ca,un,mi,ma,ub,pl,cr){const b={codigo:co,descripcion:de,tipo:currentTipo,cantidad:cant,responsable:resp,ot,sec,obs};if(ca)b.categoria=ca;if(un)b.unidad=un;if(mi)b.minimo=mi;if(ma)b.maximo=ma;if(ub)b.ubicacion=ub;if(pl)b.planta=pl;if(cr)b.critico=cr;return apiCall('/api/movimiento',{method:'POST',body:JSON.stringify(b)});}
function limpiarFormularioMovimiento(){['codigoInput','cantidadInput','otInput','obsInput'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});document.getElementById('itemInfo').classList.remove('show');selectedItemCodigo=null;hideNewItemForm();}

// ============================================================
//  RENDER HISTORY
// ============================================================
function renderHistory(){const c=document.getElementById('historyList');if(!movs.length){c.innerHTML='<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">Sin movimientos</div></div>';return;}c.innerHTML=movs.slice(0,100).map(m=>{const ie=m.tipo==='ENTRADA'||m.tipo==='DEVOLUCIÓN';return`<div class="history-card" style="border-left:4px solid ${ie?'var(--verdeM)':m.tipo==='SALIDA'?'var(--rojo)':'var(--gris)'};"><span class="history-date">${m.fecha}</span><span class="history-type" style="color:${ie?'var(--verdeM)':'var(--rojo)'};">${m.tipo}</span><div><div class="history-desc">${m.descripcion}</div></div><span class="history-qty" style="color:${m.tipo==='SALIDA'?'var(--rojo)':'var(--verdeM)'};">${m.tipo==='SALIDA'?'-':'+'}${m.cantidad}</span></div>`;}).join('');}

// ============================================================
//  RENDER CATEGORÍAS
// ============================================================
function renderCategorias(){const c=document.getElementById('categoriasList');const cats=[...new Set(items.map(i=>i.categoria||'Sin categoría'))].sort();if(!cats.length){c.innerHTML='<div class="empty-state"><div class="empty-icon">📂</div><div class="empty-title">Sin categorías</div></div>';return;}let h='';cats.forEach(cat=>{const ic=items.filter(i=>(i.categoria||'Sin categoría')===cat);const io=categoriasExpandidas[cat]||false;h+=`<div class="categoria-item"><div class="categoria-header" onclick="toggleCategoria('${cat}')"><span class="categoria-toggle ${io?'open':''}">${io?'✕':'+'}</span><span class="categoria-nombre">${cat}</span><span class="categoria-cantidad">${ic.length} ítems</span></div><div class="categoria-items ${io?'open':''}">`;ic.forEach(item=>{const a=stockActual(item);const e=estadoItem(a,item.minimo,item);let ih='';if(item.imagenes&&item.imagenes.length>0)ih=`<img src="${item.imagenes[0]}" alt="${item.descripcion}" class="cat-item-img">`;else if(item.imagen)ih=`<img src="${item.imagen}" alt="${item.descripcion}" class="cat-item-img">`;else ih='<span class="cat-item-img-placeholder">📦</span>';h+=`<div class="categoria-subitem" onclick="editItemFromTable('${item.codigo}')"><div class="cat-item-img-col">${ih}</div><div class="cat-item-info"><div class="cat-item-header"><span class="cat-item-codigo">${item.codigo}</span><span class="cat-item-descripcion">${item.descripcion}</span><span class="badge cat-item-badge" style="background:${e.bg};color:${e.color};border:1px solid ${e.color}33;">${e.label}</span></div><div class="cat-item-detalles"><span class="cat-item-stock" style="color:${a<=item.minimo?e.color:'var(--verdeM)'}">Stock: <strong>${a}</strong> ${item.unidad||'u.'}</span><span class="cat-item-separador">·</span><span>Mín: <strong>${item.minimo}</strong></span><span class="cat-item-separador">·</span><span>Máx: <strong>${item.maximo}</strong></span>${item.ubicacion?`<span class="cat-item-separador">·</span><span>📌 ${item.ubicacion}</span>`:''}</div></div></div>`;});h+='</div></div>';});c.innerHTML=h;}
function toggleCategoria(cat){categoriasExpandidas[cat]=!categoriasExpandidas[cat];renderCategorias();}

// ============================================================
//  ADMIN - PLANTILLA EXCEL / EXPORTAR / BACKUP / IMPORT
// ============================================================
function descargarPlantilla(){const w=XLSX.utils.book_new();const d=[['Código','Descripción','Categoría','Unidad','Stock Inicial','Stock Mínimo','Stock Máximo','Ubicación','Planta','Crítico','Observaciones'],['PAN-001','Ejemplo','EPP','Unidad',10,5,20,'E1-A1','Planta 1','NO','']];const ws=XLSX.utils.aoa_to_sheet(d);XLSX.utils.book_append_sheet(w,ws,'Ítems');ws['!cols']=[{wch:15},{wch:30},{wch:15},{wch:12},{wch:14},{wch:14},{wch:14},{wch:15},{wch:15},{wch:10},{wch:30}];const wo=XLSX.write(w,{bookType:'xlsx',type:'array'});const b=new Blob([wo],{type:'application/octet-stream'});const l=document.createElement('a');l.href=URL.createObjectURL(b);l.download='plantilla_stock_panol.xlsx';document.body.appendChild(l);l.click();document.body.removeChild(l);setTimeout(()=>URL.revokeObjectURL(l.href),100);showToast('✅ Plantilla descargada');}
function exportarDatos(){if(currentUser?.rol!=='admin'){showToast('Solo admin',false);return;}downloadBackup();}
async function downloadBackup(){if(currentUser?.rol!=='admin'){showToast('Solo admin',false);return;}showLoading(true);try{let d;if(token && token.startsWith('token_local_')){d={items,movimientos:movs,planillas};showLoading(false);}else{d=await apiCall('/api/backup');showLoading(false);}const w=XLSX.utils.book_new();const id=d.items.map(i=>({'Código':i.codigo,'Descripción':i.descripcion,'Categoría':i.categoria||'','Unidad':i.unidad||'Unidad','Stock Inicial':i.inicial||0,'Stock Mínimo':i.minimo||0,'Stock Máximo':i.maximo||0,'Ubicación':i.ubicacion||'','Planta':i.planta||'','Crítico':i.critico||'NO','Observaciones':i.obs||''}));const wi=XLSX.utils.json_to_sheet(id);XLSX.utils.book_append_sheet(w,wi,'Ítems');const md=(d.movimientos||[]).map(m=>({'Fecha':m.fecha||'','Hora':m.hora||'','Tipo':m.tipo||'','Código':m.codigo||'','Descripción':m.descripcion||'','Cantidad':m.cantidad||0,'Responsable':m.responsable||'','OT/Referencia':m.ot||'','Sector/Destino':m.sector||'','Observaciones':m.obs||''}));const wm=XLSX.utils.json_to_sheet(md);XLSX.utils.book_append_sheet(w,wm,'Movimientos');wi['!cols']=[{wch:15},{wch:30},{wch:15},{wch:12},{wch:14},{wch:14},{wch:14},{wch:15},{wch:15},{wch:10},{wch:30}];wm['!cols']=[{wch:12},{wch:10},{wch:12},{wch:15},{wch:30},{wch:12},{wch:15},{wch:18},{wch:18},{wch:30}];const wo=XLSX.write(w,{bookType:'xlsx',type:'array'});const b2=new Blob([wo],{type:'application/octet-stream'});const l=document.createElement('a');l.href=URL.createObjectURL(b2);l.download='backup_pañol.xlsx';document.body.appendChild(l);l.click();document.body.removeChild(l);setTimeout(()=>URL.revokeObjectURL(l.href),100);showToast('✅ Backup descargado');}catch(err){showLoading(false);showToast('❌ '+err.message,false);}}
function openBackupModal(){if(currentUser?.rol!=='admin'){showToast('Solo admin',false);return;}document.getElementById('backupModal').classList.add('show');document.getElementById('restoreInfo').style.display='none';}
function closeBackupModal(){document.getElementById('backupModal').classList.remove('show');}
function restoreBackup(e){if(currentUser?.rol!=='admin'){showToast('Solo admin',false);return;}const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=function(ev){try{const w=XLSX.read(ev.target.result,{type:'array'});const wi=w.Sheets['Ítems'];if(!wi)throw new Error('Hoja Ítems no encontrada');const id=XLSX.utils.sheet_to_json(wi);const wm=w.Sheets['Movimientos'];let md=[];if(wm)md=XLSX.utils.sheet_to_json(wm);if(!id||id.length===0)throw new Error('Sin ítems');const ri=id.map(r=>({codigo:String(r['Código']||'').trim(),descripcion:String(r['Descripción']||'').trim(),categoria:String(r['Categoría']||'Sin categoría').trim()||'Sin categoría',unidad:String(r['Unidad']||'Unidad').trim()||'Unidad',inicial:Number(r['Stock Inicial'])||0,minimo:Number(r['Stock Mínimo'])||0,maximo:Number(r['Stock Máximo'])||0,ubicacion:String(r['Ubicación']||'').trim(),planta:String(r['Planta']||'').trim(),critico:['SI','NO'].includes(String(r['Crítico']||'').toUpperCase())?String(r['Crítico']).toUpperCase():'NO',obs:String(r['Observaciones']||'').trim(),imagenes:[]}));const vi=ri.filter(i=>i.codigo&&i.descripcion);if(vi.length===0)throw new Error('Sin ítems válidos');const rm=md.map(r=>({fecha:String(r['Fecha']||new Date().toLocaleDateString('es-AR')),hora:String(r['Hora']||new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})),tipo:String(r['Tipo']||'ENTRADA'),codigo:String(r['Código']||'').trim(),descripcion:String(r['Descripción']||'').trim(),cantidad:Number(r['Cantidad'])||0,responsable:String(r['Responsable']||'').trim(),ot:String(r['OT/Referencia']||'').trim(),sector:String(r['Sector/Destino']||'').trim(),obs:String(r['Observaciones']||'').trim(),id:Date.now()+Math.random()*1000}));pendingRestoreData={items:vi,movs:rm};const info=document.getElementById('restoreInfo');info.style.display='block';info.innerHTML=`<div class="info-box success"><strong>✅ Backup listo</strong><br>📦 ${vi.length} ítems<br>📋 ${rm.length} movs</div><div class="btn-group"><button class="btn btn-cancel" onclick="cancelRestore()">Cancelar</button><button class="btn btn-primary" onclick="confirmRestore()">✅ Confirmar</button></div>`;}catch(err){const info=document.getElementById('restoreInfo');info.style.display='block';info.innerHTML=`<div class="info-box error">❌ ${err.message||'Error'}</div>`;pendingRestoreData=null;}};r.readAsArrayBuffer(f);e.target.value='';}
function cancelRestore(){document.getElementById('restoreInfo').style.display='none';pendingRestoreData=null;}
function confirmRestore(){if(!pendingRestoreData){showToast('Sin datos',false);return;}showLoading(true);if(token && token.startsWith('token_local_')){items=pendingRestoreData.items;movs=pendingRestoreData.movs;showLoading(false);document.getElementById('restoreInfo').style.display='none';pendingRestoreData=null;closeBackupModal();showToast('✅ Restaurado (local)');renderStock();renderHistory();renderCategorias();updateKPIsLocales();return;}apiCall('/api/backup/restore',{method:'POST',body:JSON.stringify({items:pendingRestoreData.items,movimientos:pendingRestoreData.movs,usuarios:{}})}).then(()=>{showLoading(false);document.getElementById('restoreInfo').style.display='none';pendingRestoreData=null;closeBackupModal();showToast('✅ Restaurado');cargarTodosLosDatos();}).catch(err=>{showLoading(false);showToast('❌ '+err.message,false);});}
function openImportModal(){if(currentUser?.rol!=='admin'){showToast('Solo admin',false);return;}document.getElementById('importModal').classList.add('show');resetImportModal();}
function closeImportModal(){document.getElementById('importModal').classList.remove('show');}
function resetImportModal(){const dz=document.getElementById('dropZone');if(dz)dz.classList.remove('loaded');document.getElementById('dropIcon').textContent='📊';document.getElementById('dropText').textContent='Hacé clic o arrastrá tu Excel';document.getElementById('importInfo').style.display='none';document.getElementById('previewContainer').style.display='none';document.getElementById('importButtons').style.display='none';importData=null;}
function handleDrop(e){e.preventDefault();if(e.dataTransfer.files[0])processFile(e.dataTransfer.files[0]);}
function handleFileSelect(e){if(e.target.files[0])processFile(e.target.files[0]);}
function mapearColumnas(h){const m={};h.forEach((h,i)=>{const n=String(h||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'');if(n.includes('cod'))m.codigo=i;if(n.includes('desc'))m.descripcion=i;if(n.includes('stockinicial')||n==='stockinicial'||n==='stock_inicial')m.stock=i;if(n==='stock'||n==='stockactual'||n==='cantidad')m.stock=i;if(n.includes('ubic'))m.ubicacion=i;if(n.includes('plant'))m.planta=i;if(n.includes('min'))m.minimo=i;if(n.includes('max'))m.maximo=i;if(n.includes('obs')||n.includes('nota'))m.obs=i;if(n.includes('cat'))m.categoria=i;if(n.includes('unid'))m.unidad=i;if(n.includes('crit'))m.critico=i;});return m;}
function processFile(f){const r=new FileReader();r.onload=function(e){try{const w=XLSX.read(e.target.result,{type:'array'});const ws=w.Sheets[w.SheetNames[0]];const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});if(rows.length<2){showImportError('Archivo vacío');return;}let hi=0;for(let i=0;i<Math.min(5,rows.length);i++){if(rows[i].some(c=>typeof c==='string'&&c.trim())){hi=i;break;}}const map=mapearColumnas(rows[hi]);if(map.codigo===undefined||map.descripcion===undefined){showImportError('Columnas: Código y Descripción');return;}importData=rows.slice(hi+1).filter(r=>r[map.codigo]&&String(r[map.codigo]).trim()).map(r=>{let sv=Number(r[map.stock]??0);if(isNaN(sv))sv=0;let cv=String(r[map.critico]||'').trim().toUpperCase();if(!['SI','NO'].includes(cv))cv='NO';return{codigo:String(r[map.codigo]||'').trim(),descripcion:String(r[map.descripcion]||'').trim(),categoria:String(r[map.categoria]||'Sin categoría').trim()||'Sin categoría',unidad:String(r[map.unidad]||'Unidad').trim()||'Unidad',inicial:sv,minimo:Number(r[map.minimo]??0)||0,maximo:Number(r[map.maximo]??0)||0,ubicacion:String(r[map.ubicacion]||'').trim(),planta:String(r[map.planta]||'').trim()||'Planta 1',critico:cv,obs:String(r[map.obs]||'').trim(),imagenes:[]};});if(importData.length===0){showImportError('Sin datos válidos');return;}document.getElementById('dropZone').classList.add('loaded');document.getElementById('dropIcon').textContent='✅';document.getElementById('dropText').textContent=f.name+` (${importData.length} ítems)`;document.getElementById('importInfo').style.display='block';document.getElementById('importInfo').className='info-box success';document.getElementById('importInfo').textContent=`✓ ${importData.length} ítems listos`;const pc=document.getElementById('previewContainer');pc.style.display='block';pc.innerHTML=`<div style="font-size:12px;font-weight:700;color:var(--sub);margin-bottom:8px;">Vista previa (${Math.min(5,importData.length)} de ${importData.length})</div><table class="preview-table"><thead><tr><th>Código</th><th>Descripción</th><th>Stock</th><th>Mín</th><th>Máx</th><th>Crítico</th></tr></thead><tbody>${importData.slice(0,5).map((r,i)=>`<tr style="background:${i%2===0?'#fff':'var(--bg)'}"><td style="font-weight:700;color:var(--verde);">${r.codigo}</td><td>${r.descripcion}</td><td style="text-align:center;font-weight:700;color:${r.inicial>0?'var(--verdeM)':'var(--rojo)'};">${r.inicial}</td><td style="text-align:center;">${r.minimo}</td><td style="text-align:center;">${r.maximo}</td><td style="text-align:center;font-weight:700;color:${r.critico==='SI'?'var(--rojo)':'var(--sub)'};">${r.critico}</td></tr>`).join('')}${importData.length>5?`<tr><td colspan="6" style="text-align:center;color:var(--sub);">... y ${importData.length-5} más</td></tr>`:''}</tbody></table>`;document.getElementById('importButtons').style.display='flex';}catch(err){showImportError('Error: '+err.message);}};r.readAsArrayBuffer(f);}
function showImportError(m){document.getElementById('importInfo').style.display='block';document.getElementById('importInfo').className='info-box error';document.getElementById('importInfo').textContent='⚠️ '+m;}

// ============================================================
//  ✅ IMPORTAR EXCEL - CORREGIDO
// ============================================================
function confirmImport() {
    if (!importData || currentUser?.rol !== 'admin') {
        showToast('Sin datos', false);
        return;
    }
    
    // Si estamos en modo local
    if (token && token.startsWith('token_local_')) {
        items = importData;
        movs = [];
        closeImportModal();
        categoriasExpandidas = {};
        showToast('✅ ' + items.length + ' ítems (local)');
        renderStock();
        renderHistory();
        renderCategorias();
        updateKPIsLocales();
        return;
    }
    
    showLoading(true);
    showToast('📤 Subiendo ' + importData.length + ' ítems al servidor...');
    
    // Primero, obtener los items existentes para saber cuáles actualizar
    apiCall('/api/items')
        .then(existingItems => {
            const promesas = importData.map(i => {
                const existe = existingItems.find(x => x.codigo === i.codigo);
                if (existe) {
                    // Actualizar existente
                    return apiCall(`/api/items/${i.codigo}`, {
                        method: 'PUT',
                        body: JSON.stringify(i)
                    }).catch(() => null);
                } else {
                    // Crear nuevo
                    return apiCall('/api/items', {
                        method: 'POST',
                        body: JSON.stringify(i)
                    }).catch(() => null);
                }
            });
            
            return Promise.allSettled(promesas);
        })
        .then(resultados => {
            const ok = resultados.filter(r => r.status === 'fulfilled' && r.value?.success !== false).length;
            const fallidos = resultados.length - ok;
            
            showLoading(false);
            closeImportModal();
            categoriasExpandidas = {};
            
            if (ok > 0) {
                showToast('✅ ' + ok + ' ítems importados al servidor' + (fallidos > 0 ? ' (' + fallidos + ' fallidos)' : ''));
                // ✅ RECARGAR TODOS LOS DATOS DEL SERVIDOR
                setTimeout(() => {
                    cargarTodosLosDatos();
                }, 500);
            } else {
                showToast('❌ Error al importar', false);
            }
        })
        .catch(err => {
            showLoading(false);
            showToast('❌ Error: ' + err.message, false);
        });
}

// ============================================================
//  PLANILLA DE TRABAJO
// ============================================================
function iniciarPollingPlanillas(){detenerPollingPlanillas();if(!token || token.startsWith('token_local_'))return;planillasInterval=setInterval(()=>{if(!document.hidden)cargarPlanillasDesdeServidor();},5000);}
function detenerPollingPlanillas(){if(planillasInterval){clearInterval(planillasInterval);planillasInterval=null;}}
function cargarPlanillasDesdeServidor(){if(!token || token.startsWith('token_local_'))return Promise.resolve([]);return apiCall('/api/planillas').then(d=>{planillas=d||[];if(currentTab==='planillasRecibidas'&&currentUser?.rol==='admin')renderPlanillasRecibidasUI(document.getElementById('planillasRecibidasList'));actualizarContadorPlanillas();return planillas;}).catch(()=>[]);}
function registrarPlanilla(){if(!currentUser){showToast('Iniciá sesión',false);return;}const fe=document.getElementById('planillaFecha').value,ti=document.getElementById('planillaTipo').value,cl=document.getElementById('planillaClasificacion').value,mo=document.getElementById('planillaModulo').value.trim(),de=document.getElementById('planillaDescripcion').value.trim(),te=document.getElementById('planillaTecnico').value.trim()||currentUser.username,ho=parseFloat(document.getElementById('planillaHoras').value),re=document.getElementById('planillaRepuesto').value.trim(),ob=document.getElementById('planillaObservaciones').value.trim();if(!ti){showToast('Tipo requerido',false);return;}if(!mo){showToast('Módulo requerido',false);return;}if(!de){showToast('Descripción requerida',false);return;}if(!ho||ho<=0){showToast('Horas requeridas',false);return;}showLoading(true);if(token && token.startsWith('token_local_')){const np={id:Date.now(),fecha:fe,tipo:ti,clasificacion:cl,modulo:mo,descripcion:de,horas:ho,repuesto:re||'',observaciones:ob||'',usuario:currentUser.username,tecnico:te,timestamp:new Date().toISOString()};planillas.unshift(np);showLoading(false);showToast('✅ Registrado (local)');document.getElementById('planillaTipo').value='';document.getElementById('planillaModulo').value='';document.getElementById('planillaDescripcion').value='';document.getElementById('planillaHoras').value='';document.getElementById('planillaRepuesto').value='';document.getElementById('planillaObservaciones').value='';initPlanillaFecha();if(currentUser?.rol==='admin'){cargarOrdenesDesdePlanillas();renderTablaOT();}return;}apiCall('/api/planillas',{method:'POST',body:JSON.stringify({fecha:fe,tipo:ti,clasificacion:cl,modulo:mo,descripcion:de,horas:ho,repuesto:re,observaciones:ob,tecnico:te})}).then(d=>{showLoading(false);if(d.success){planillas.unshift(d.planilla);showToast('✅ Registrado');document.getElementById('planillaTipo').value='';document.getElementById('planillaModulo').value='';document.getElementById('planillaDescripcion').value='';document.getElementById('planillaHoras').value='';document.getElementById('planillaRepuesto').value='';document.getElementById('planillaObservaciones').value='';initPlanillaFecha();if(currentUser?.rol==='admin'){cargarOrdenesDesdePlanillas();renderTablaOT();}cargarPlanillasDesdeServidor();}}).catch(err=>{showLoading(false);showToast('❌ '+err.message,false);});}
function renderPlanillasRecibidas(){const c=document.getElementById('planillasRecibidasList');if(!c)return;if(currentUser?.rol==='admin'){if(token && token.startsWith('token_local_')){renderPlanillasRecibidasUI(c);return;}showLoading(true);apiCall('/api/planillas').then(d=>{planillas=d||[];showLoading(false);renderPlanillasRecibidasUI(c);if(!planillasInterval)iniciarPollingPlanillas();}).catch(()=>{showLoading(false);renderPlanillasRecibidasUI(c);});}else{renderPlanillasRecibidasUI(c);}}
function renderPlanillasRecibidasUI(c){if(!c)return;const fe=document.getElementById('planillaFiltroEmpleado'),ff=document.getElementById('planillaFiltroFecha');const em=[...new Set(planillas.map(p=>p.usuario))],ea=fe?.value||'',fa=ff?.value||'';if(fe)fe.innerHTML=`<option value="">Todos</option>${em.map(e=>`<option value="${e}" ${e===ea?'selected':''}>${e}</option>`).join('')}`;let pf=[...planillas];if(ea)pf=pf.filter(p=>p.usuario===ea);if(fa)pf=pf.filter(p=>p.fecha===fa);const ef=[...new Set(pf.map(p=>p.usuario))];if(ef.length===0){c.innerHTML='<div class="planilla-vacia"><div class="icono">📭</div><div class="titulo">Sin planillas</div></div>';return;}let h='';ef.forEach(em=>{const pe=pf.filter(p=>p.usuario===em).sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));const pp={};const pm=[];pe.forEach(p=>{const d=p.fecha;if(!pp[d])pp[d]=0;if(pp[d]<7){pp[d]++;pm.push(p);}});const tp=pe.length,th=pe.reduce((s,p)=>s+p.horas,0);h+=`<div class="empleado-planilla-card"><div class="empleado-planilla-header" onclick="togglePlanillasEmpleado('${em}')"><span class="nombre">👤 ${em}</span><span class="badge-count">${tp} trabajos · ${th}h</span><span class="toggle-icon" id="toggleIcon_${em}">+</span></div><div class="empleado-planilla-body" id="planillasBody_${em}">${pm.length>0?pm.map(p=>`<div class="planilla-item"><span class="fecha">${p.fecha}</span><span class="tipo ${p.tipo.toLowerCase()}">${p.tipo}</span><span class="modulo">${p.modulo}</span><span class="horas">${p.horas}h</span><span class="repuesto">${p.repuesto||'—'}</span><div class="acciones"><button onclick="verPlanillaDetalle('${p.id}')">👁️</button>${currentUser?.rol==='admin'?`<button onclick="eliminarPlanilla('${p.id}')">🗑️</button>`:''}</div></div>`).join(''):'<div class="planilla-vacia"><p>Sin registros</p></div>'}${tp>7?`<div style="text-align:center;font-size:12px;color:var(--sub);padding:8px;">... y ${tp-7} más</div>`:''}</div></div>`;});c.innerHTML=h;actualizarContadorPlanillas();}
function togglePlanillasEmpleado(em){const b=document.getElementById(`planillasBody_${em}`),i=document.getElementById(`toggleIcon_${em}`);if(b){b.classList.toggle('open');if(i){i.textContent=b.classList.contains('open')?'✕':'+';i.classList.toggle('open');}}}
function verPlanillaDetalle(id){const p=planillas.find(x=>x.id===id);if(!p){showToast('No encontrada',false);return;}alert(`📋 PLANILLA\n━━━━━━━━━━━━\n📅 ${p.fecha}\n👤 ${p.tecnico}\n🔧 ${p.tipo}\n📋 ${p.clasificacion||'OT'}\n📌 ${p.modulo}\n📝 ${p.descripcion}\n⏱ ${p.horas}h\n🔩 ${p.repuesto||'—'}\n💬 ${p.observaciones||'—'}`);}
function eliminarPlanilla(id){if(currentUser?.rol!=='admin'){showToast('Solo admin',false);return;}if(!confirm('¿Eliminar?'))return;if(token && token.startsWith('token_local_')){planillas=planillas.filter(p=>p.id!==id);renderPlanillasRecibidasUI(document.getElementById('planillasRecibidasList'));showToast('✅ Eliminada (local)');return;}showLoading(true);apiCall(`/api/planillas/${id}`,{method:'DELETE'}).then(()=>{showLoading(false);planillas=planillas.filter(p=>p.id!==id);renderPlanillasRecibidasUI(document.getElementById('planillasRecibidasList'));showToast('✅ Eliminada');cargarPlanillasDesdeServidor();}).catch(err=>{showLoading(false);showToast('❌ '+err.message,false);});}
function filtrarPlanillasPorEmpleado(){renderPlanillasRecibidasUI(document.getElementById('planillasRecibidasList'));}
function filtrarPlanillasPorFecha(){renderPlanillasRecibidasUI(document.getElementById('planillasRecibidasList'));}
function exportarPlanillasExcel(){if(planillas.length===0){showToast('Sin datos',false);return;}const fe=document.getElementById('planillaFiltroEmpleado')?.value||'',ff=document.getElementById('planillaFiltroFecha')?.value||'';let de=[...planillas];if(fe)de=de.filter(p=>p.usuario===fe);if(ff)de=de.filter(p=>p.fecha===ff);if(de.length===0){showToast('Sin resultados',false);return;}const w=XLSX.utils.book_new();const d=de.map(p=>({'Fecha':p.fecha,'Técnico':p.tecnico,'Tipo':p.tipo,'Clasificación':p.clasificacion||'OT','Módulo':p.modulo,'Descripción':p.descripcion,'Horas':p.horas,'Repuesto':p.repuesto||'—','Observaciones':p.observaciones||'','Registrado':p.usuario}));const ws=XLSX.utils.json_to_sheet(d);ws['!cols']=[{wch:12},{wch:15},{wch:12},{wch:20},{wch:40},{wch:10},{wch:20},{wch:30},{wch:15}];XLSX.utils.book_append_sheet(w,ws,'Planillas');const wo=XLSX.write(w,{bookType:'xlsx',type:'array'});const b=new Blob([wo],{type:'application/octet-stream'});const l=document.createElement('a');l.href=URL.createObjectURL(b);let n='planillas_trabajo';if(fe)n+=`_${fe}`;if(ff)n+=`_${ff}`;n+='.xlsx';l.download=n;document.body.appendChild(l);l.click();document.body.removeChild(l);setTimeout(()=>URL.revokeObjectURL(l.href),100);showToast('✅ Exportado');}
function initPlanillaFecha(){const fi=document.getElementById('planillaFecha');if(fi){const h=new Date();fi.value=`${h.getFullYear()}-${String(h.getMonth()+1).padStart(2,'0')}-${String(h.getDate()).padStart(2,'0')}`;}const ti=document.getElementById('planillaTecnico');if(ti&&currentUser)ti.value=currentUser.username;}

// ============================================================
//  ÓRDENES DE TRABAJO
// ============================================================
function guardarOTLocal(){localStorage.setItem('ot_ordenes_v2',JSON.stringify(ordenes));localStorage.setItem('ot_maquinas',JSON.stringify(maquinasList));localStorage.setItem('ot_tecnicos',JSON.stringify(tecnicosList));localStorage.setItem('ot_modulos',JSON.stringify(modulosList));}
function cargarOrdenesDesdePlanillas(){const ie=new Set(ordenes.map(o=>o.id));let c=0;planillas.forEach(p=>{const id=p.id||Date.now()+Math.random()*1000;if(!ie.has(id)){ordenes.push({id,fecha:p.fecha||'',maquina:p.modulo||'',falla:p.descripcion||'',clasificacion:p.clasificacion||'Orden de Trabajo',tecnico:p.tecnico||p.usuario||'',horas:p.horas||0,repuestos:p.repuesto||'',solucion:'',operativa:'SI',tipoOrden:p.tipo||'',comentarios:p.observaciones||'',_origen:'planilla'});ie.add(id);c++;}});if(c>0)guardarOTLocal();}
function initOrdenes(){const s=localStorage.getItem('ot_ordenes_v2');if(s){try{const p=JSON.parse(s);if(p.length>0)ordenes=p;}catch(e){}}if(currentUser?.rol==='admin')cargarOrdenesDesdePlanillas();renderTablaOT();}
function renderTablaOT(){const s=localStorage.getItem('ot_ordenes_v2');if(s){try{const p=JSON.parse(s);if(p.length>0)ordenes=p;}catch(e){}}if(currentUser?.rol==='admin')cargarOrdenesDesdePlanillas();const q=document.getElementById('searchInputOT')?.value?.toLowerCase()||'',fc=document.getElementById('filterClasificacionOT')?.value||'',fm=document.getElementById('filterMaquinaOT')?.value||'',ft=document.getElementById('filterTecnicoOT')?.value||'';let fl=ordenes.filter(o=>{const ms=!q||(o.id||'').toString().toLowerCase().includes(q)||(o.maquina||'').toLowerCase().includes(q)||(o.tecnico||'').toLowerCase().includes(q)||(o.falla||'').toLowerCase().includes(q);return ms&&(!fc||o.clasificacion===fc)&&(!fm||o.maquina===fm)&&(!ft||o.tecnico===ft);});document.getElementById('totalOT').textContent=fl.length;const hs=fl.map(o=>parseFloat(o.horas)||0);document.getElementById('promHorasOT').textContent=fl.length?(hs.reduce((a,b)=>a+b,0)/fl.length).toFixed(1):'0.0';document.getElementById('totalRepuestosOT').textContent=fl.filter(o=>o.repuestos&&o.repuestos.trim()).length;const ma=[...new Set(ordenes.map(o=>o.maquina).filter(Boolean))].sort(),te=[...new Set(ordenes.map(o=>o.tecnico).filter(Boolean))].sort();const sm=document.getElementById('filterMaquinaOT'),st=document.getElementById('filterTecnicoOT');if(sm){const cv=sm.value;sm.innerHTML='<option value="">Todas</option>'+ma.map(m=>`<option value="${m}">${m}</option>`).join('');sm.value=cv;}if(st){const cv=st.value;st.innerHTML='<option value="">Todos</option>'+te.map(t=>`<option value="${t}">${t}</option>`).join('');st.value=cv;}const tb=document.getElementById('tablaBodyOT'),em=document.getElementById('emptyStateOT');if(fl.length===0){tb.innerHTML='';if(em)em.style.display='block';return;}if(em)em.style.display='none';tb.innerHTML=fl.map(o=>{const ff=f=>{if(!f)return'';if(f instanceof Date)return`${String(f.getDate()).padStart(2,'0')}/${String(f.getMonth()+1).padStart(2,'0')}/${String(f.getFullYear()).slice(-2)}`;const fs=String(f);if(fs.includes('-')){const p=fs.split('-');if(p.length===3)return`${p[1]}/${p[2]}/${p[0].slice(-2)}`;}return fs;};const ep=o.clasificacion==='Preventivo';return`<tr><td><strong style="color:var(--verde);">${o.id||'—'}</strong></td><td>${ff(o.fecha)}</td><td><span class="badge-ot">${o.maquina||'—'}</span></td><td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${o.falla||''}">${o.falla||'—'}</td><td><span class="${ep?'badge-info':'badge-warning'}">${ep?'🛠️ Preventivo':'📋 Orden'}</span></td><td><strong>${o.tecnico||'—'}</strong></td><td style="font-weight:700;color:var(--verde);">${o.horas||0}h</td><td>${o.repuestos||'—'}</td><td style="text-align:center;"><button class="btn-accion" onclick="verDetalleOT('${o.id}')">👁️</button></td></tr>`;}).join('');}
function verDetalleOT(id){const o=ordenes.find(x=>x.id==id);if(!o){showToast('No encontrado',false);return;}alert(`📋 DETALLE\n━━━━━━━━━━━━\n🔢 ${o.id}\n📅 ${o.fecha}\n🏭 ${o.maquina||'—'}\n📋 ${o.clasificacion||'—'}\n📝 ${o.falla||'—'}\n👤 ${o.tecnico||'—'}\n⏱ ${o.horas||0}h\n🔩 ${o.repuestos||'—'}\n💬 ${o.comentarios||'—'}`);}
function limpiarFiltrosOT(){['searchInputOT','filterClasificacionOT','filterMaquinaOT','filterTecnicoOT'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});renderTablaOT();}
function cargarSelectoresOT(){const sm=document.getElementById('otMaquina'),st=document.getElementById('otTecnico');if(sm)sm.innerHTML='<option value="">Seleccionar</option>'+maquinasList.map(m=>`<option value="${m}">${m}</option>`).join('');if(st)st.innerHTML='<option value="">Seleccionar</option>'+tecnicosList.map(t=>`<option value="${t}">${t}</option>`).join('');}
function abrirFormularioOT(){if(currentUser?.rol!=='admin'){showToast('Solo admin',false);return;}document.getElementById('modalOT').classList.add('show');document.getElementById('editIndexOT').value=-1;document.getElementById('modalTitleOT').textContent='➕ Nueva OT';document.getElementById('submitBtnOT').textContent='✅ Guardar';document.getElementById('otFecha').value=new Date().toISOString().split('T')[0];document.getElementById('otId').value=Date.now();document.getElementById('otOperativa').value='SI';cargarSelectoresOT();}
function cerrarModalOT(){document.getElementById('modalOT').classList.remove('show');}
function guardarOT(e){e.preventDefault();if(currentUser?.rol!=='admin'){showToast('Solo admin',false);return;}const id=document.getElementById('otId').value.trim()||Date.now(),fe=document.getElementById('otFecha').value,ma=document.getElementById('otMaquina').value,te=document.getElementById('otTecnico').value;if(!fe||!ma||!te){showToast('Completá campos',false);return;}const no={id,fecha:fe,maquina:ma,falla:document.getElementById('otFalla').value.trim(),clasificacion:document.getElementById('otClasificacion').value,tecnico:te,horas:parseFloat(document.getElementById('otHoras').value)||0,repuestos:document.getElementById('otRepuestos').value.trim()||'',solucion:document.getElementById('otSolucion').value.trim()||'',operativa:document.getElementById('otOperativa').value,tipoOrden:document.getElementById('otTipoOrden').value||'',comentarios:document.getElementById('otComentarios').value.trim()||'',turno:document.getElementById('otTurno').value||'',modulo:document.getElementById('otModulo').value.trim()||'',_origen:'admin'};ordenes.push(no);guardarOTLocal();cerrarModalOT();renderTablaOT();showToast('✅ OT creada');}
function exportarOTXLSX(){if(ordenes.length===0){showToast('Sin datos',false);return;}const d=ordenes.map(o=>({'ID':o.id||'','Fecha':o.fecha||'','Máquina':o.maquina||'','Falla':o.falla||'','Clasificación':o.clasificacion||'','Técnico':o.tecnico||'','Horas':o.horas||0,'Repuestos':o.repuestos||'','Solución':o.solucion||'','Operativa':o.operativa||'','Comentarios':o.comentarios||''}));const w=XLSX.utils.book_new();const ws=XLSX.utils.json_to_sheet(d);ws['!cols']=Object.keys(d[0]).map(()=>({wch:18}));XLSX.utils.book_append_sheet(w,ws,'Órdenes');const wo=XLSX.write(w,{bookType:'xlsx',type:'array'});const b=new Blob([wo],{type:'application/octet-stream'});const l=document.createElement('a');l.href=URL.createObjectURL(b);l.download=`ordenes_${new Date().toLocaleDateString('es-AR').replace(/\//g,'-')}.xlsx`;document.body.appendChild(l);l.click();document.body.removeChild(l);setTimeout(()=>URL.revokeObjectURL(l.href),100);showToast('✅ Exportado');}
let importDataOT=null;
function abrirImportadorOT(){document.getElementById('importModalOT').classList.add('show');document.getElementById('dropZoneOT').classList.remove('loaded');document.getElementById('dropIconOT').textContent='📊';document.getElementById('dropTextOT').textContent='Arrastrá tu Excel';document.getElementById('importInfoOT').style.display='none';document.getElementById('previewContainerOT').style.display='none';document.getElementById('importButtonsOT').style.display='none';importDataOT=null;}
function cerrarImportadorOT(){document.getElementById('importModalOT').classList.remove('show');}
function handleDropOT(e){e.preventDefault();if(e.dataTransfer.files[0])processFileOT(e.dataTransfer.files[0]);}
function handleFileSelectOT(e){if(e.target.files[0])processFileOT(e.target.files[0]);}
function processFileOT(f){const r=new FileReader();r.onload=function(e){try{const w=XLSX.read(e.target.result,{type:'array'});let ws=null;for(let sn of w.SheetNames){if(sn.toLowerCase().includes('datos')||sn.toLowerCase().includes('data')){ws=w.Sheets[sn];break;}}if(!ws&&w.SheetNames.length>0)ws=w.Sheets[w.SheetNames[0]];if(!ws){showToast('Sin hoja datos',false);return;}const d=XLSX.utils.sheet_to_json(ws);if(!d||d.length===0){showToast('Vacío',false);return;}importDataOT=d.map(r=>{const id=r['ID_Tarea']||r['ID']||r['id']||Date.now()+Math.random()*1000;let fe='';const fr=r['Fecha']||r['fecha']||r['FECHA']||'';if(fr!==null&&fr!==undefined)fe=String(fr);if(fe&&fe.includes('/')){const p=fe.split('/');if(p.length===3){let a=p[2];if(a.length===2)a='20'+a;fe=`${a}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;}}else if(fe&&typeof fe==='number'){try{const ed=new Date((fe-25569)*86400*1000);fe=`${ed.getFullYear()}-${String(ed.getMonth()+1).padStart(2,'0')}-${String(ed.getDate()).padStart(2,'0')}`;}catch(err){fe='';}}const ma=r['Maquina']||r['Máquina']||r['maquina']||'';const te=r['Tecnico']||r['Técnico']||r['tecnico']||'';let cl=r['Clasificación']||r['Clasificacion']||r['clasificacion']||'Orden de Trabajo';if(r['Tipo de Orden']){const to=String(r['Tipo de Orden']||'');if(to.includes('Preventivo'))cl='Preventivo';}let ho=0;const hr=r['Tiempo de trabajo']!==undefined?r['Tiempo de trabajo']:(r['Horas']!==undefined?r['Horas']:(r['horas']!==undefined?r['horas']:0));if(hr!==null&&hr!==undefined&&hr!=='')ho=parseFloat(String(hr))||0;let op='SI';const os=String(r['Operativa']||r['operativa']||'').toUpperCase();if(os==='FALSE'||os==='NO'||os==='0')op='NO';return{id,fecha:fe,maquina:ma||r['Modulo Intervenido']||r['Modulo']||r['modulo']||'',falla:r['Falla']||r['falla']||r['Descripción']||r['descripcion']||'',clasificacion:cl,tecnico:te,horas:ho,repuestos:r['Repuestos']||r['repuestos']||'',solucion:r['Solucion']||r['Solución']||r['solucion']||'',operativa:op,comentarios:r['Comentarios']||r['comentarios']||r['Observaciones']||r['observaciones']||''};});importDataOT=importDataOT.filter(o=>o.maquina||o.tecnico||o.falla);if(importDataOT.length===0){showToast('Sin datos válidos',false);return;}document.getElementById('dropZoneOT').classList.add('loaded');document.getElementById('dropIconOT').textContent='✅';document.getElementById('dropTextOT').textContent=f.name+' ('+importDataOT.length+' registros)';document.getElementById('importButtonsOT').style.display='flex';const pv=document.getElementById('previewContainerOT');pv.style.display='block';pv.innerHTML=`<div style="font-size:12px;font-weight:700;color:var(--sub);margin:8px 0;">Vista previa (${importDataOT.length})</div><div class="preview-table-wrap"><table><thead><tr><th>ID</th><th>Fecha</th><th>Máquina</th><th>Clasif.</th><th>Técnico</th><th>Horas</th></tr></thead><tbody>${importDataOT.slice(0,10).map(o=>`<tr><td>${o.id}</td><td>${o.fecha}</td><td>${o.maquina||'—'}</td><td>${o.clasificacion}</td><td>${o.tecnico||'—'}</td><td>${o.horas}</td></tr>`).join('')}${importDataOT.length>10?`<tr><td colspan="6" style="text-align:center;color:var(--sub);">... y ${importDataOT.length-10} más</td></tr>`:''}</tbody></table></div>`;showToast('✅ '+importDataOT.length+' registros');}catch(err){showToast('❌ '+err.message,false);}};r.readAsArrayBuffer(f);document.getElementById('fileInputOT').value='';}
function confirmarImportacionOT(){if(!importDataOT||importDataOT.length===0){showToast('Sin datos',false);return;}let c=0;importDataOT.forEach(o=>{const ex=ordenes.find(x=>x.id==o.id);if(!ex){ordenes.push({...o,_origen:'importado'});c++;}});guardarOTLocal();cerrarImportadorOT();renderTablaOT();showToast('✅ '+c+' importadas');}

// ============================================================
//  INICIO - Verificar token guardado (solo token, no datos)
// ============================================================
const savedToken = localStorage.getItem('panol_token');
const savedUser = localStorage.getItem('panol_user');
if (savedToken && savedUser) {
    try {
        const userData = JSON.parse(savedUser);
        if (savedToken.startsWith('token_local_')) {
            if (USUARIOS_LOCALES[userData.username]) {
                currentUser = { username: userData.username, rol: userData.rol };
                token = savedToken;
                mostrarApp(currentUser);
                cargarTodosLosDatos();
                iniciarPing();
                initPlanillaFecha();
                initOrdenes();
                cargarSelectoresOT();
            }
        } else {
            currentUser = { username: userData.username, rol: userData.rol };
            token = savedToken;
            mostrarApp(currentUser);
            cargarTodosLosDatos();
            iniciarPing();
            initPlanillaFecha();
            iniciarPollingPlanillas();
            iniciarPollingStock();
            initOrdenes();
            cargarSelectoresOT();
            showToast('✅ Sesión restaurada');
        }
    } catch(e) {}
}

document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && document.getElementById('loginScreen').style.display !== 'none') doLogin(); });
setTimeout(() => { if (document.getElementById('ordenesSection')) { initOrdenes(); cargarSelectoresOT(); } }, 500);

console.log('🏭 Sistema de Stock Pañol ECO FACTORY');
console.log('🔄 Polling de stock: Cada 15 segundos');
console.log('📸 Múltiples imágenes + Carrousel + Vista empleado - ACTIVADO');
console.log('👤 Admin local: admin/admin123 (solo emergencia)');
console.log('🌐 Empleados: Martin, Gino, Esteban, Lucas, Walter, Yamir, Victor');
console.log('☁️ TODOS LOS DATOS SE GUARDAN EN EL SERVIDOR');
console.log('📱 Si ves "sin datos", presioná el botón 🔄 para sincronizar');

function verDatosOT() { console.log('📋 Órdenes:', ordenes.length); console.log('📦 Ítems:', items.length); console.log('🖼️ Ítems con imágenes:', items.filter(i => i.imagenes && i.imagenes.length > 0).length); console.log('🎠 Carrousel intervals activos:', Object.keys(carrouselIntervals).length); }
