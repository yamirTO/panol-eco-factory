// ============================================================
//  CONFIGURACIÓN - CONECTADO AL SERVIDOR EN RENDER
// ============================================================
const API_URL = 'https://panol-eco-factory.onrender.com';

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
let planillas = [];
let planillasInterval = null;

// CORRECTIVOS
let correctivos = [];
let correctivosCargados = false;

// ============================================================
//  DOM REFERENCIAS
// ============================================================
const $ = (id) => document.getElementById(id);

// ============================================================
//  FUNCIÓN DE FECHA (para mostrar en MM/DD/AA)
// ============================================================
function fechaToMMDDAA(fechaStr){
    if(!fechaStr) return '';
    if(fechaStr.includes('-')) {
        const partes = fechaStr.split('-');
        if(partes.length === 3) {
            const año = partes[0].slice(-2);
            return partes[1] + '/' + partes[2] + '/' + año;
        }
    }
    return fechaStr;
}

// ============================================================
//  AUTENTICACIÓN
// ============================================================
function doLogin() {
    const username = $('loginUser').value.trim();
    const password = $('loginPass').value.trim();

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
            showLoginError(data.error);
            return;
        }
        token = data.token;
        currentUser = data;
        localStorage.setItem('panol_token', token);
        $('loginScreen').style.display = 'none';
        $('appScreen').style.display = 'flex';
        $('userNameDisplay').textContent = '👤 ' + data.username;
        const rolSpan = $('userRolDisplay');
        rolSpan.textContent = data.rol;
        rolSpan.className = 'rol ' + (data.rol === 'admin' ? 'admin-badge' : 'empleado-badge');
        
        if (data.rol === 'admin') {
            $('adminTabBtn').style.display = 'block';
            $('planillasRecibidasBtn').style.display = 'block';
            $('correctivosBtn').style.display = 'block';
            document.querySelectorAll('.header-btn.admin-only').forEach(el => el.style.display = 'inline-block');
        } else {
            $('adminTabBtn').style.display = 'none';
            $('planillasRecibidasBtn').style.display = 'none';
            $('correctivosBtn').style.display = 'none';
            document.querySelectorAll('.header-btn.admin-only').forEach(el => el.style.display = 'none');
        }
        
        loadDataFromServer();
        iniciarPing();
        initPlanillaFecha();
        cargarPlanillasDesdeServidor().then(() => {
            iniciarPollingPlanillas();
        });
        cargarCorrectivos();
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
    $('appScreen').style.display = 'none';
    $('loginScreen').style.display = 'flex';
    $('loginPass').value = '';
    $('loginError').className = 'login-error';
    detenerPing();
}

function showLoginError(msg) {
    const el = $('loginError');
    el.textContent = msg;
    el.className = 'login-error show';
}

function showLoading(show) {
    $('loadingOverlay').className = show ? 'loading-overlay show' : 'loading-overlay';
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
    $('pingStatus').textContent = '⏱ Detenido';
    $('pingStatus').className = 'ping-status';
}

function hacerPing() {
    pingContador++;
    fetch(`${API_URL}/api/items`, {
        headers: { 'Authorization': token || '' },
        signal: AbortSignal.timeout(10000)
    })
    .then(() => {
        const statusEl = $('pingStatus');
        statusEl.textContent = `⏱ ${pingContador} ✅`;
        statusEl.className = 'ping-status active';
    })
    .catch(() => {
        const statusEl = $('pingStatus');
        statusEl.textContent = `⏱ ${pingContador} ⚠️`;
        statusEl.className = 'ping-status';
    });
}

// ============================================================
//  API HELPER
// ============================================================
function apiCall(endpoint, options = {}) {
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
                doLogout();
                showToast('Sesión expirada', false);
            }
            throw new Error(data.error);
        }
        return data;
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
        $('syncStatus').textContent = '●';
        $('syncStatus').className = 'sync-status';
        showToast('✅ Datos cargados');
    })
    .catch(err => {
        showLoading(false);
        $('syncStatus').textContent = '⚠️';
        $('syncStatus').className = 'sync-status error';
        showToast('❌ Error: ' + err.message, false);
    });
}

function updateKPIsFromStats(stats) {
    $('kpiTotal').textContent = stats.totalItems || 0;
    $('kpiSinStock').textContent = stats.sinStock || 0;
    $('kpiCriticos').textContent = stats.criticos || 0;
    $('kpiCategorias').textContent = stats.categorias || 0;
    $('kpiMovs').textContent = stats.totalMovimientos || 0;
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
    const section = $(tab + 'Section');
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
        cargarPlanillasDesdeServidor();
    }
    if (tab === 'planillasRecibidas' && currentUser?.rol === 'admin') {
        renderPlanillasRecibidas();
        if (!planillasInterval) iniciarPollingPlanillas();
    }
    if (tab === 'correctivos' && currentUser?.rol === 'admin') {
        cargarCorrectivos().then(() => {
            renderCorrectivosPorTecnico();
        });
    }
}

function showToast(msg, success = true) {
    const toast = $('toast');
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
//  RENDER STOCK
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

    const tableBody = $('stockTable');
    tableBody.innerHTML = '';
    
    if (filtrados.length === 0) {
        tableBody.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-title">Sin resultados</div></div>';
        return;
    }

    tableBody.innerHTML = filtrados.map((item) => {
        const actual = stockActual(item);
        const e = estadoItem(actual, item.minimo, item);
        return `<div class="table-row" onclick="editItemFromTable('${item.codigo}')">
            <span class="code-cell">${item.codigo}</span>
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
//  EDITAR (solo admin)
// ============================================================
function searchItemToEdit() {
    const val = $('editSearchInput').value.trim().toUpperCase();
    const suggestions = $('editSuggestions');
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
    $('editSearchInput').value = item.codigo + ' - ' + item.descripcion;
    $('editSuggestions').classList.remove('show');
    $('editItemName').textContent = item.descripcion;
    $('editItemStock').textContent = stockActual(item);
    $('editItemUnit').textContent = item.unidad || 'unidades';
    $('editCodigo').value = item.codigo;
    $('editDescripcion').value = item.descripcion;
    $('editCategoria').value = item.categoria || '';
    $('editUnidad').value = item.unidad || 'Unidad';
    $('editInicial').value = item.inicial;
    $('editMinimo').value = item.minimo;
    $('editMaximo').value = item.maximo;
    $('editUbicacion').value = item.ubicacion || '';
    $('editPlanta').value = item.planta || '';
    $('editCritico').value = item.critico || 'NO';
    $('editObs').value = item.obs || '';
    $('editFormContainer').style.display = 'block';
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
    
    const newCodigo = $('editCodigo').value.trim();
    const newDescripcion = $('editDescripcion').value.trim();
    if (!newCodigo || !newDescripcion) {
        showToast('Código y descripción son obligatorios', false);
        return;
    }
    
    if (newCodigo !== editingItemCodigo && items.find(i => i.codigo === newCodigo)) {
        showToast('El código ' + newCodigo + ' ya existe', false);
        return;
    }
    
    let criticoVal = $('editCritico').value.trim().toUpperCase();
    if (!['SI', 'NO'].includes(criticoVal)) criticoVal = 'NO';
    
    const updatedItem = {
        codigo: newCodigo,
        descripcion: newDescripcion,
        categoria: $('editCategoria').value.trim() || 'Sin categoría',
        unidad: $('editUnidad').value,
        inicial: Number($('editInicial').value) || 0,
        minimo: Number($('editMinimo').value) || 1,
        maximo: Number($('editMaximo').value) || 10,
        ubicacion: $('editUbicacion').value.trim(),
        planta: $('editPlanta').value.trim(),
        critico: criticoVal,
        obs: $('editObs').value.trim()
    };
    
    showLoading(true);
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
    $('editSearchInput').value = '';
    $('editSuggestions').classList.remove('show');
    $('editFormContainer').style.display = 'none';
}

function resetEditForm() {
    cancelEdit();
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
    $('submitBtn').textContent = 'Registrar ' + tipo + ' →';
    $('submitBtn').style.background = tipo === 'SALIDA' ? 'var(--rojo)' : 
                                       (tipo === 'ENTRADA' || tipo === 'DEVOLUCIÓN') ? 'var(--verdeM)' : 'var(--gris)';
    updateNewItemVisibility();
    if (tipo !== 'ENTRADA') hideNewItemForm();
}

function updateNewItemVisibility() {
    $('toggleNewItem').style.display = (currentTipo === 'ENTRADA' && currentTab === 'movimiento') ? 'flex' : 'none';
}

function toggleNewItemForm() {
    if (currentUser?.rol !== 'admin') {
        showToast('Solo administradores pueden crear nuevos ítems', false);
        return;
    }
    isCreatingNewItem = !isCreatingNewItem;
    const form = $('newItemForm');
    const codigoGroup = $('codigoExistenteGroup');
    const itemInfo = $('itemInfo');
    const toggleIcon = $('toggleNewItemIcon');
    const toggleText = $('toggleNewItemText');
    if (isCreatingNewItem) {
        form.classList.add('show');
        codigoGroup.style.opacity = '0.5';
        codigoGroup.style.pointerEvents = 'none';
        itemInfo.classList.remove('show');
        $('suggestions').classList.remove('show');
        toggleIcon.textContent = '➖';
        toggleText.textContent = 'Seleccionar ítem existente';
        selectedItemCodigo = null;
        $('codigoInput').value = '';
    } else {
        hideNewItemForm();
    }
}

function hideNewItemForm() {
    isCreatingNewItem = false;
    $('newItemForm').classList.remove('show');
    $('codigoExistenteGroup').style.opacity = '1';
    $('codigoExistenteGroup').style.pointerEvents = 'auto';
    $('toggleNewItemIcon').textContent = '➕';
    $('toggleNewItemText').textContent = 'Crear nuevo ítem';
    ['newCodigo', 'newDescripcion', 'newCategoria', 'newUbicacion', 'newPlanta', 'newCritico'].forEach(id => {
        const el = $(id);
        if (el) el.value = '';
    });
    const newInicial = $('newInicial');
    const newMinimo = $('newMinimo');
    const newMaximo = $('newMaximo');
    if (newInicial) newInicial.value = '0';
    if (newMinimo) newMinimo.value = '1';
    if (newMaximo) newMaximo.value = '10';
}

function searchItem() {
    if (isCreatingNewItem) return;
    const val = $('codigoInput').value.trim().toUpperCase();
    const suggestions = $('suggestions');
    const itemInfo = $('itemInfo');
    if (!val) {
        suggestions.classList.remove('show');
        itemInfo.classList.remove('show');
        selectedItemCodigo = null;
        return;
    }
    const itemExacto = items.find(i => i.codigo === val);
    if (itemExacto) {
        suggestions.classList.remove('show');
        mostrarInfoItem(itemExacto);
        selectedItemCodigo = itemExacto.codigo;
    } else if (val.length >= 2) {
        const results = items.filter(i => 
            i.codigo.toLowerCase().includes(val.toLowerCase()) || 
            i.descripcion.toLowerCase().includes(val.toLowerCase())
        ).slice(0, 6);
        if (results.length > 0) {
            suggestions.innerHTML = results.map(s =>
                `<div class="suggestion-item" onclick="selectItem('${s.codigo}')"><span><strong style="color:var(--verde);">${s.codigo}</strong> ${s.descripcion}</span><span>Stock: ${stockActual(s)}</span></div>`
            ).join('');
            if (currentTipo === 'ENTRADA' && currentUser?.rol === 'admin') {
                suggestions.innerHTML += `<div class="suggestion-item new-item" onclick="toggleNewItemForm();$('newCodigo').value='${val}';$('suggestions').classList.remove('show');"><span>🆕 Crear: ${val}</span></div>`;
            }
            suggestions.classList.add('show');
            itemInfo.classList.remove('show');
            selectedItemCodigo = null;
        } else {
            suggestions.classList.remove('show');
            itemInfo.classList.remove('show');
            if (currentTipo === 'ENTRADA' && val.length >= 2 && currentUser?.rol === 'admin') {
                suggestions.innerHTML = `<div class="suggestion-item new-item" onclick="toggleNewItemForm();$('newCodigo').value='${val}';$('suggestions').classList.remove('show');"><span>🆕 Crear: ${val}</span></div>`;
                suggestions.classList.add('show');
            }
        }
    }
}

function mostrarInfoItem(item) {
    $('itemInfoDesc').textContent = item.descripcion;
    $('itemInfoDetails').textContent = (item.categoria || '') + (item.ubicacion ? ' · ' + item.ubicacion : '') + (item.planta ? ' · ' + item.planta : '') + ' · Crítico: ' + (item.critico || 'NO');
    $('itemInfoStock').textContent = stockActual(item);
    $('itemInfoUnit').textContent = (item.unidad || 'unidades') + ' actuales';
    $('itemInfo').classList.add('show');
}

function selectItem(codigo) {
    $('codigoInput').value = codigo;
    $('suggestions').classList.remove('show');
    const item = items.find(i => i.codigo === codigo);
    if (item) {
        mostrarInfoItem(item);
        selectedItemCodigo = codigo;
        hideNewItemForm();
    }
    $('cantidadInput').focus();
}

function clearItemSelection() {
    $('codigoInput').value = '';
    $('itemInfo').classList.remove('show');
    $('suggestions').classList.remove('show');
    selectedItemCodigo = null;
    hideNewItemForm();
    $('codigoInput').focus();
}

function registrarMovimiento() {
    const cantidad = Number($('cantidadInput').value);
    const responsable = $('responsableInput').value.trim() || currentUser?.username || '';
    const ot = $('otInput').value.trim();
    const sector = $('sectorInput').value.trim();
    const obs = $('obsInput').value.trim();
    
    if (!cantidad || cantidad <= 0) {
        showToast('Ingresá una cantidad válida', false);
        return;
    }
    
    let codigo, descripcion, categoria, unidad, minimo, maximo, ubicacion, planta, critico;
    
    if (isCreatingNewItem) {
        if (currentUser?.rol !== 'admin') {
            showToast('Solo administradores pueden crear nuevos ítems', false);
            return;
        }
        const newCodigo = $('newCodigo').value.trim();
        const newDescripcion = $('newDescripcion').value.trim();
        if (!newCodigo) { showToast('Ingresá el código', false); return; }
        if (!newDescripcion) { showToast('Ingresá la descripción', false); return; }
        if (items.find(i => i.codigo === newCodigo)) { showToast('El código ya existe', false); return; }
        
        codigo = newCodigo;
        descripcion = newDescripcion;
        categoria = $('newCategoria').value.trim() || 'Sin categoría';
        unidad = $('newUnidad').value;
        minimo = Number($('newMinimo').value) || 1;
        maximo = Number($('newMaximo').value) || 10;
        ubicacion = $('newUbicacion').value.trim();
        planta = $('newPlanta').value.trim() || 'Planta 1';
        critico = $('newCritico').value.trim().toUpperCase() || 'NO';
        if (!['SI', 'NO'].includes(critico)) critico = 'NO';
        
        showLoading(true);
        apiCall('/api/items', {
            method: 'POST',
            body: JSON.stringify({
                codigo, descripcion, categoria, unidad,
                inicial: Number($('newInicial').value) || 0,
                minimo, maximo, ubicacion, planta, critico, obs: ''
            })
        })
        .then(() => {
            return registrarMovimientoEnServidor(codigo, descripcion, cantidad, responsable, ot, sector, obs,
                categoria, unidad, minimo, maximo, ubicacion, planta, critico);
        })
        .then(() => {
            showLoading(false);
            limpiarFormularioMovimiento();
            showToast('✓ ' + currentTipo + ' registrada — ' + descripcion);
            loadDataFromServer();
        })
        .catch(err => {
            showLoading(false);
            showToast('❌ Error: ' + err.message, false);
        });
        return;
    }
    
    if (!selectedItemCodigo) {
        const val = $('codigoInput').value.trim();
        const item = items.find(i => i.codigo === val);
        if (!item) { showToast('Seleccioná un ítem', false); return; }
        selectedItemCodigo = item.codigo;
    }
    
    const item = items.find(i => i.codigo === selectedItemCodigo);
    if (!item) { showToast('Ítem no encontrado', false); return; }
    codigo = item.codigo;
    descripcion = item.descripcion;
    
    if (currentTipo === 'SALIDA' && cantidad > stockActual(item)) {
        showToast('Stock insuficiente. Actual: ' + stockActual(item), false);
        return;
    }
    
    showLoading(true);
    registrarMovimientoEnServidor(codigo, descripcion, cantidad, responsable, ot, sector, obs)
        .then(() => {
            showLoading(false);
            limpiarFormularioMovimiento();
            showToast('✓ ' + currentTipo + ' registrada — ' + descripcion);
            loadDataFromServer();
        })
        .catch(err => {
            showLoading(false);
            showToast('❌ Error: ' + err.message, false);
        });
}

function registrarMovimientoEnServidor(codigo, descripcion, cantidad, responsable, ot, sector, obs, categoria, unidad, minimo, maximo, ubicacion, planta, critico) {
    const body = { codigo, descripcion, tipo: currentTipo, cantidad, responsable, ot, sector, obs };
    if (categoria) body.categoria = categoria;
    if (unidad) body.unidad = unidad;
    if (minimo) body.minimo = minimo;
    if (maximo) body.maximo = maximo;
    if (ubicacion) body.ubicacion = ubicacion;
    if (planta) body.planta = planta;
    if (critico) body.critico = critico;
    
    return apiCall('/api/movimiento', {
        method: 'POST',
        body: JSON.stringify(body)
    });
}

function limpiarFormularioMovimiento() {
    ['codigoInput', 'cantidadInput', 'otInput', 'obsInput'].forEach(id => {
        const el = $(id);
        if (el) el.value = '';
    });
    $('itemInfo').classList.remove('show');
    selectedItemCodigo = null;
    hideNewItemForm();
}

// ============================================================
//  RENDER HISTORY
// ============================================================
function renderHistory() {
    const container = $('historyList');
    if (!movs.length) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">Sin movimientos</div></div>`;
        return;
    }
    container.innerHTML = movs.slice(0, 100).map(m => {
        const isEntrada = m.tipo === 'ENTRADA' || m.tipo === 'DEVOLUCIÓN';
        return `<div class="history-card" style="border-left:4px solid ${isEntrada?'var(--verdeM)':m.tipo==='SALIDA'?'var(--rojo)':'var(--gris)'};">
            <span class="history-date">${m.fecha}</span>
            <span class="history-type" style="color:${isEntrada?'var(--verdeM)':'var(--rojo)'};">${m.tipo}</span>
            <div><div class="history-desc">${m.descripcion}</div></div>
            <span class="history-qty" style="color:${m.tipo==='SALIDA'?'var(--rojo)':'var(--verdeM)'};">${m.tipo==='SALIDA'?'-':'+'}${m.cantidad}</span>
        </div>`;
    }).join('');
}

// ============================================================
//  RENDER CATEGORÍAS
// ============================================================
function renderCategorias() {
    const container = $('categoriasList');
    const categorias = [...new Set(items.map(i => i.categoria || 'Sin categoría'))].sort();

    if (!categorias.length) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon">📂</div><div class="empty-title">Sin categorías</div></div>`;
        return;
    }

    let html = '';
    categorias.forEach(cat => {
        const itemsCat = items.filter(i => (i.categoria || 'Sin categoría') === cat);
        const isOpen = categoriasExpandidas[cat] || false;

        html += `<div class="categoria-item">
            <div class="categoria-header" onclick="toggleCategoria('${cat}')">
                <span class="categoria-toggle ${isOpen ? 'open' : ''}">${isOpen ? '✕' : '+'}</span>
                <span class="categoria-nombre">${cat}</span>
                <span class="categoria-cantidad">${itemsCat.length}</span>
            </div>
            <div class="categoria-items ${isOpen ? 'open' : ''}">
                ${itemsCat.map(item => {
                    const actual = stockActual(item);
                    const e = estadoItem(actual, item.minimo, item);
                    return `<div class="categoria-subitem">
                        <span class="sub-codigo">${item.codigo}</span>
                        <span class="sub-desc">${item.descripcion}</span>
                        <span class="sub-stock" style="color:${actual <= item.minimo ? e.color : 'var(--texto)'}">${actual}</span>
                        <span class="sub-min">Mín: ${item.minimo}</span>
                    </div>`;
                }).join('')}
            </div>
        </div>`;
    });

    container.innerHTML = html;
}

function toggleCategoria(categoria) {
    categoriasExpandidas[categoria] = !categoriasExpandidas[categoria];
    renderCategorias();
}

// ============================================================
//  ADMIN - PLANTILLA EXCEL
// ============================================================
function descargarPlantilla() {
    const wb = XLSX.utils.book_new();
    const data = [
        ['Código', 'Descripción', 'Categoría', 'Unidad', 'Stock Inicial', 'Stock Mínimo', 'Stock Máximo', 'Ubicación', 'Planta', 'Crítico', 'Observaciones'],
        ['PAN-001', 'Ejemplo de producto', 'EPP', 'Unidad', 10, 5, 20, 'E1-A1', 'Planta 1', 'NO', '']
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Ítems');
    
    ws['!cols'] = [
        { wch: 15 }, { wch: 30 }, { wch: 15 }, { wch: 12 },
        { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 15 },
        { wch: 15 }, { wch: 10 }, { wch: 30 }
    ];
    
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'plantilla_stock_panol.xlsx';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(link.href), 100);
    showToast('✅ Plantilla descargada');
}

function exportarDatos() {
    if (currentUser?.rol !== 'admin') {
        showToast('Solo administradores pueden exportar', false);
        return;
    }
    downloadBackup();
}

// ============================================================
//  BACKUP
// ============================================================
async function downloadBackup() {
    if (currentUser?.rol !== 'admin') {
        showToast('Solo administradores pueden descargar backups', false);
        return;
    }

    showLoading(true);
    try {
        const data = await apiCall('/api/backup');
        showLoading(false);
        
        const wb = XLSX.utils.book_new();

        const itemsData = data.items.map(item => ({
            'Código': item.codigo,
            'Descripción': item.descripcion,
            'Categoría': item.categoria || '',
            'Unidad': item.unidad || 'Unidad',
            'Stock Inicial': item.inicial || 0,
            'Stock Mínimo': item.minimo || 0,
            'Stock Máximo': item.maximo || 0,
            'Ubicación': item.ubicacion || '',
            'Planta': item.planta || '',
            'Crítico': item.critico || 'NO',
            'Observaciones': item.obs || ''
        }));

        const wsItems = XLSX.utils.json_to_sheet(itemsData);
        XLSX.utils.book_append_sheet(wb, wsItems, 'Ítems');

        const movsData = data.movimientos.map(m => ({
            'Fecha': m.fecha || '',
            'Hora': m.hora || '',
            'Tipo': m.tipo || '',
            'Código': m.codigo || '',
            'Descripción': m.descripcion || '',
            'Cantidad': m.cantidad || 0,
            'Responsable': m.responsable || '',
            'OT/Referencia': m.ot || '',
            'Sector/Destino': m.sector || '',
            'Observaciones': m.obs || ''
        }));

        const wsMovs = XLSX.utils.json_to_sheet(movsData);
        XLSX.utils.book_append_sheet(wb, wsMovs, 'Movimientos');

        wsItems['!cols'] = [
            { wch: 15 }, { wch: 30 }, { wch: 15 }, { wch: 12 },
            { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 15 },
            { wch: 15 }, { wch: 10 }, { wch: 30 }
        ];
        wsMovs['!cols'] = [
            { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 15 },
            { wch: 30 }, { wch: 12 }, { wch: 15 }, { wch: 18 },
            { wch: 18 }, { wch: 30 }
        ];

        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbout], { type: 'application/octet-stream' });

        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: 'backup_pañol.xlsx',
                    types: [{
                        description: 'Excel Workbook',
                        accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] }
                    }]
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                showToast('✅ Backup guardado correctamente');
                return;
            } catch (err) {
                if (err.name === 'AbortError') {
                    showToast('⏹️ Descarga cancelada');
                    return;
                }
                console.log('Fallback al método tradicional:', err);
            }
        }

        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'backup_pañol.xlsx';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(link.href), 100);
        showToast('✅ Backup descargado');
        
    } catch (err) {
        showLoading(false);
        showToast('❌ Error: ' + err.message, false);
    }
}

function openBackupModal() {
    if (currentUser?.rol !== 'admin') {
        showToast('Solo administradores', false);
        return;
    }
    $('backupModal').classList.add('show');
    $('restoreInfo').style.display = 'none';
}

function closeBackupModal() {
    $('backupModal').classList.remove('show');
}

function restoreBackup(event) {
    if (currentUser?.rol !== 'admin') {
        showToast('Solo administradores pueden restaurar backups', false);
        return;
    }
    
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const wb = XLSX.read(e.target.result, { type: 'array' });

            const wsItems = wb.Sheets['Ítems'];
            if (!wsItems) throw new Error('No se encontró la hoja "Ítems"');
            const itemsData = XLSX.utils.sheet_to_json(wsItems);

            const wsMovs = wb.Sheets['Movimientos'];
            let movsData = [];
            if (wsMovs) {
                movsData = XLSX.utils.sheet_to_json(wsMovs);
            }

            if (!itemsData || itemsData.length === 0) {
                throw new Error('No se encontraron ítems');
            }

            const restoredItems = itemsData.map(row => ({
                codigo: String(row['Código'] || '').trim(),
                descripcion: String(row['Descripción'] || '').trim(),
                categoria: String(row['Categoría'] || 'Sin categoría').trim() || 'Sin categoría',
                unidad: String(row['Unidad'] || 'Unidad').trim() || 'Unidad',
                inicial: Number(row['Stock Inicial']) || 0,
                minimo: Number(row['Stock Mínimo']) || 0,
                maximo: Number(row['Stock Máximo']) || 0,
                ubicacion: String(row['Ubicación'] || '').trim(),
                planta: String(row['Planta'] || '').trim(),
                critico: ['SI', 'NO'].includes(String(row['Crítico'] || '').toUpperCase()) ? String(row['Crítico']).toUpperCase() : 'NO',
                obs: String(row['Observaciones'] || '').trim()
            }));

            const validItems = restoredItems.filter(item => item.codigo && item.descripcion);
            if (validItems.length === 0) {
                throw new Error('No hay ítems válidos');
            }

            const restoredMovs = movsData.map(row => ({
                fecha: String(row['Fecha'] || new Date().toLocaleDateString('es-AR')),
                hora: String(row['Hora'] || new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })),
                tipo: String(row['Tipo'] || 'ENTRADA'),
                codigo: String(row['Código'] || '').trim(),
                descripcion: String(row['Descripción'] || '').trim(),
                cantidad: Number(row['Cantidad']) || 0,
                responsable: String(row['Responsable'] || '').trim(),
                ot: String(row['OT/Referencia'] || '').trim(),
                sector: String(row['Sector/Destino'] || '').trim(),
                obs: String(row['Observaciones'] || '').trim(),
                id: Date.now() + Math.random() * 1000
            }));

            pendingRestoreData = { items: validItems, movs: restoredMovs };

            const infoDiv = $('restoreInfo');
            infoDiv.style.display = 'block';
            infoDiv.innerHTML = `
                <div class="info-box success">
                    <strong>✅ Backup listo para restaurar</strong><br>
                    📦 Ítems: ${validItems.length}<br>
                    📋 Movimientos: ${restoredMovs.length}
                </div>
                <div class="btn-group">
                    <button class="btn btn-cancel" onclick="cancelRestore()">Cancelar</button>
                    <button class="btn btn-primary" onclick="confirmRestore()">✅ Confirmar</button>
                </div>
            `;
        } catch (err) {
            const infoDiv = $('restoreInfo');
            infoDiv.style.display = 'block';
            infoDiv.innerHTML = `<div class="info-box error">❌ ${err.message || 'Error al leer el archivo'}</div>`;
            pendingRestoreData = null;
        }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = '';
}

function cancelRestore() {
    $('restoreInfo').style.display = 'none';
    pendingRestoreData = null;
}

function confirmRestore() {
    if (!pendingRestoreData) {
        showToast('No hay datos para restaurar', false);
        return;
    }
    
    showLoading(true);
    apiCall('/api/backup/restore', {
        method: 'POST',
        body: JSON.stringify({
            items: pendingRestoreData.items,
            movimientos: pendingRestoreData.movs,
            usuarios: {}
        })
    })
    .then(() => {
        showLoading(false);
        $('restoreInfo').style.display = 'none';
        pendingRestoreData = null;
        closeBackupModal();
        showToast('✅ Datos restaurados correctamente');
        loadDataFromServer();
    })
    .catch(err => {
        showLoading(false);
        showToast('❌ Error: ' + err.message, false);
    });
}

// ============================================================
//  IMPORT EXCEL
// ============================================================
function openImportModal() {
    if (currentUser?.rol !== 'admin') {
        showToast('Solo administradores pueden importar', false);
        return;
    }
    $('importModal').classList.add('show');
    resetImportModal();
}

function closeImportModal() {
    $('importModal').classList.remove('show');
}

function resetImportModal() {
    const dropZone = $('dropZone');
    if (dropZone) dropZone.classList.remove('loaded');
    $('dropIcon').textContent = '📊';
    $('dropText').textContent = 'Hacé clic o arrastrá tu archivo Excel';
    $('importInfo').style.display = 'none';
    $('previewContainer').style.display = 'none';
    $('importButtons').style.display = 'none';
    importData = null;
}

function handleDrop(event) {
    event.preventDefault();
    if (event.dataTransfer.files[0]) processFile(event.dataTransfer.files[0]);
}

function handleFileSelect(event) {
    if (event.target.files[0]) processFile(event.target.files[0]);
}

function mapearColumnas(headers) {
    const map = {};
    headers.forEach((h, i) => {
        const n = String(h || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
        
        if (n.includes('cod')) map.codigo = i;
        if (n.includes('desc')) map.descripcion = i;
        if (n.includes('stockinicial') || n === 'stockinicial' || n === 'stock_inicial' || n === 'stock inicial') {
            map.stock = i;
        }
        if (n === 'stock' || n === 'stockactual' || n === 'cantidad') map.stock = i;
        if (n.includes('ubic')) map.ubicacion = i;
        if (n.includes('plant')) map.planta = i;
        if (n.includes('min')) map.minimo = i;
        if (n.includes('max')) map.maximo = i;
        if (n.includes('obs') || n.includes('nota')) map.obs = i;
        if (n.includes('cat')) map.categoria = i;
        if (n.includes('unid')) map.unidad = i;
        if (n.includes('crit')) map.critico = i;
    });
    
    console.log('🔍 Columnas detectadas:', map);
    return map;
}

function processFile(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const wb = XLSX.read(e.target.result, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
            
            if (rows.length < 2) {
                showImportError('Archivo vacío');
                return;
            }
            
            let hdrIdx = 0;
            for (let i = 0; i < Math.min(5, rows.length); i++) {
                if (rows[i].some(c => typeof c === 'string' && c.trim())) {
                    hdrIdx = i;
                    break;
                }
            }
            
            const map = mapearColumnas(rows[hdrIdx]);
            
            if (map.codigo === undefined || map.descripcion === undefined) {
                showImportError('Columnas obligatorias: Código y Descripción');
                return;
            }
            
            importData = rows.slice(hdrIdx + 1)
                .filter(r => r[map.codigo] && String(r[map.codigo]).trim())
                .map(r => {
                    let stockValor = Number(r[map.stock] ?? 0);
                    if (isNaN(stockValor)) stockValor = 0;
                    
                    let criticoVal = String(r[map.critico] || '').trim().toUpperCase();
                    if (!['SI', 'NO'].includes(criticoVal)) criticoVal = 'NO';
                    
                    return {
                        codigo: String(r[map.codigo] || '').trim(),
                        descripcion: String(r[map.descripcion] || '').trim(),
                        categoria: String(r[map.categoria] || 'Sin categoría').trim() || 'Sin categoría',
                        unidad: String(r[map.unidad] || 'Unidad').trim() || 'Unidad',
                        inicial: stockValor,
                        minimo: Number(r[map.minimo] ?? 0) || 0,
                        maximo: Number(r[map.maximo] ?? 0) || 0,
                        ubicacion: String(r[map.ubicacion] || '').trim(),
                        planta: String(r[map.planta] || '').trim() || 'Planta 1',
                        critico: criticoVal,
                        obs: String(r[map.obs] || '').trim()
                    };
                });
            
            if (importData.length === 0) {
                showImportError('No se encontraron datos válidos');
                return;
            }
            
            $('dropZone').classList.add('loaded');
            $('dropIcon').textContent = '✅';
            $('dropText').textContent = file.name + ` (${importData.length} ítems)`;
            
            $('importInfo').style.display = 'block';
            $('importInfo').className = 'info-box success';
            $('importInfo').textContent = `✓ Listo para importar ${importData.length} ítems`;
            
            const previewContainer = $('previewContainer');
            previewContainer.style.display = 'block';
            previewContainer.innerHTML = `
                <div style="font-size:12px;font-weight:700;color:var(--sub);margin-bottom:8px;">
                    Vista previa (${Math.min(5, importData.length)} de ${importData.length})
                </div>
                <table class="preview-table">
                    <thead><tr>
                        <th>Código</th><th>Descripción</th><th>Stock</th><th>Mín</th><th>Máx</th><th>Crítico</th>
                    </tr></thead>
                    <tbody>
                        ${importData.slice(0,5).map((r,i) => `
                            <tr style="background:${i%2===0?'#fff':'var(--bg)'}">
                                <td style="font-weight:700;color:var(--verde);">${r.codigo}</td>
                                <td>${r.descripcion}</td>
                                <td style="text-align:center;font-weight:700;color:${r.inicial > 0 ? 'var(--verdeM)' : 'var(--rojo)'};">${r.inicial}</td>
                                <td style="text-align:center;">${r.minimo}</td>
                                <td style="text-align:center;">${r.maximo}</td>
                                <td style="text-align:center;font-weight:700;color:${r.critico==='SI'?'var(--rojo)':'var(--sub)'};">${r.critico}</td>
                            </tr>
                        `).join('')}
                        ${importData.length > 5 ? `<tr><td colspan="6" style="text-align:center;color:var(--sub);">... y ${importData.length - 5} más</td></tr>` : ''}
                    </tbody>
                </table>
            `;
            
            $('importButtons').style.display = 'flex';
            
        } catch (err) {
            showImportError('Error al leer archivo: ' + err.message);
        }
    };
    reader.readAsArrayBuffer(file);
}

function showImportError(msg) {
    $('importInfo').style.display = 'block';
    $('importInfo').className = 'info-box error';
    $('importInfo').textContent = '⚠️ ' + msg;
}

function confirmImport() {
    if (!importData || currentUser?.rol !== 'admin') {
        showToast('No hay datos para importar', false);
        return;
    }

    console.log('📊 Importando datos:', importData.length, 'ítems');
    console.log('📊 Muestra:', importData.slice(0, 3));

    showLoading(true);
    
    const promises = importData.map(item => {
        const existe = items.find(i => i.codigo === item.codigo);
        if (existe) {
            return apiCall(`/api/items/${item.codigo}`, {
                method: 'PUT',
                body: JSON.stringify(item)
            }).catch(err => {
                console.log('Error al actualizar:', item.codigo, err.message);
                return null;
            });
        } else {
            return apiCall('/api/items', {
                method: 'POST',
                body: JSON.stringify(item)
            }).catch(err => {
                console.log('Error al crear:', item.codigo, err.message);
                return null;
            });
        }
    });

    Promise.allSettled(promises)
        .then(results => {
            showLoading(false);
            closeImportModal();
            categoriasExpandidas = {};
            
            const procesados = results.filter(r => r.status === 'fulfilled' && r.value?.success !== false).length;
            showToast(`✅ ${procesados} ítems procesados (importados/actualizados)`);
            
            const conStock = importData.filter(i => i.inicial > 0).length;
            console.log(`📦 ${conStock} ítems tienen stock inicial > 0`);
            
            loadDataFromServer();
        })
        .catch(err => {
            showLoading(false);
            showToast('❌ Error al importar: ' + err.message, false);
        });
}

// ============================================================
//  PLANILLA DE TRABAJO - CON SERVIDOR Y TIEMPO REAL
// ============================================================

function cargarPlanillasDesdeServidor() {
    if (!token) return Promise.resolve([]);
    
    return apiCall('/api/planillas')
        .then(data => {
            planillas = data || [];
            guardarPlanillasLocal();
            return planillas;
        })
        .catch(err => {
            console.log('Error al cargar planillas:', err);
            return [];
        });
}

function guardarPlanillasLocal() {
    localStorage.setItem('panol_planillas', JSON.stringify(planillas));
}

function iniciarPollingPlanillas() {
    detenerPollingPlanillas();
    if (!token) return;
    
    planillasInterval = setInterval(() => {
        if (!document.hidden) {
            sincronizarPlanillas();
        }
    }, 5000);
}

function detenerPollingPlanillas() {
    if (planillasInterval) {
        clearInterval(planillasInterval);
        planillasInterval = null;
    }
}

function sincronizarPlanillas() {
    if (!token) return;
    
    apiCall('/api/planillas')
        .then(data => {
            const nuevasPlanillas = data || [];
            if (JSON.stringify(planillas) !== JSON.stringify(nuevasPlanillas)) {
                planillas = nuevasPlanillas;
                guardarPlanillasLocal();
                
                if (currentTab === 'planillasRecibidas' && currentUser?.rol === 'admin') {
                    renderPlanillasRecibidasUI(document.getElementById('planillasRecibidasList'));
                }
                if (currentTab === 'planilla') {
                    actualizarContadorPlanillas();
                }
            }
        })
        .catch(() => {});
}

function actualizarContadorPlanillas() {
    const badge = document.querySelector('.tab-btn[data-tab="planillasRecibidas"] .badge-count-tab');
    if (!badge && currentUser?.rol === 'admin') {
        const span = document.createElement('span');
        span.className = 'badge-count-tab';
        span.style.cssText = `background:var(--rojo);color:#fff;border-radius:50%;padding:0px 6px;font-size:9px;font-weight:700;margin-left:4px;`;
        document.querySelector('.tab-btn[data-tab="planillasRecibidas"]')?.appendChild(span);
    }
    const badgeEl = document.querySelector('.tab-btn[data-tab="planillasRecibidas"] .badge-count-tab');
    if (badgeEl) {
        badgeEl.textContent = planillas.length > 0 ? planillas.length : '';
    }
}

function registrarPlanilla() {
    if (!currentUser) {
        showToast('Debés iniciar sesión', false);
        return;
    }
    
    const fecha = document.getElementById('planillaFecha').value;
    const tipo = document.getElementById('planillaTipo').value;
    const modulo = document.getElementById('planillaModulo').value.trim();
    const descripcion = document.getElementById('planillaDescripcion').value.trim();
    const horas = parseFloat(document.getElementById('planillaHoras').value);
    const repuesto = document.getElementById('planillaRepuesto').value.trim();
    const observaciones = document.getElementById('planillaObservaciones').value.trim();
    
    if (!tipo) { showToast('Seleccioná un tipo de trabajo', false); return; }
    if (!modulo) { showToast('Ingresá el módulo intervenido', false); return; }
    if (!descripcion) { showToast('Ingresá la descripción de la tarea', false); return; }
    if (!horas || horas <= 0) { showToast('Ingresá las horas invertidas', false); return; }
    
    showLoading(true);
    
    apiCall('/api/planillas', {
        method: 'POST',
        body: JSON.stringify({ fecha, tipo, modulo, descripcion, horas, repuesto, observaciones })
    })
    .then(data => {
        showLoading(false);
        if (data.success) {
            planillas.unshift(data.planilla);
            guardarPlanillasLocal();
            showToast('✅ Planilla registrada correctamente');
            
            document.getElementById('planillaTipo').value = '';
            document.getElementById('planillaModulo').value = '';
            document.getElementById('planillaDescripcion').value = '';
            document.getElementById('planillaHoras').value = '';
            document.getElementById('planillaRepuesto').value = '';
            document.getElementById('planillaObservaciones').value = '';
            initPlanillaFecha();
            
            if (currentUser?.rol === 'admin' && currentTab === 'planillasRecibidas') {
                renderPlanillasRecibidasUI(document.getElementById('planillasRecibidasList'));
            }
            actualizarContadorPlanillas();
        }
    })
    .catch(err => {
        showLoading(false);
        showToast('❌ Error al registrar: ' + err.message, false);
    });
}

function renderPlanillasRecibidas() {
    const container = document.getElementById('planillasRecibidasList');
    if (!container) return;
    
    if (currentUser?.rol === 'admin') {
        showLoading(true);
        apiCall('/api/planillas')
            .then(data => {
                planillas = data || [];
                guardarPlanillasLocal();
                showLoading(false);
                renderPlanillasRecibidasUI(container);
                if (!planillasInterval) iniciarPollingPlanillas();
            })
            .catch(err => {
                showLoading(false);
                showToast('Error al cargar planillas', false);
                renderPlanillasRecibidasUI(container);
            });
    } else {
        renderPlanillasRecibidasUI(container);
    }
}

function renderPlanillasRecibidasUI(container) {
    if (!container) return;
    
    const filtroEmpleado = document.getElementById('planillaFiltroEmpleado');
    const filtroFecha = document.getElementById('planillaFiltroFecha');
    const empleados = [...new Set(planillas.map(p => p.usuario))];
    const empleadoActual = filtroEmpleado?.value || '';
    const fechaActual = filtroFecha?.value || '';
    
    if (filtroEmpleado) {
        filtroEmpleado.innerHTML = `
            <option value="">Todos los empleados</option>
            ${empleados.map(e => `<option value="${e}" ${e === empleadoActual ? 'selected' : ''}>${e}</option>`).join('')}
        `;
    }
    
    let planillasFiltradas = [...planillas];
    if (empleadoActual) planillasFiltradas = planillasFiltradas.filter(p => p.usuario === empleadoActual);
    if (fechaActual) planillasFiltradas = planillasFiltradas.filter(p => p.fecha === fechaActual);
    
    const empleadosFiltrados = [...new Set(planillasFiltradas.map(p => p.usuario))];
    
    if (empleadosFiltrados.length === 0) {
        container.innerHTML = `
            <div class="planilla-vacia">
                <div class="icono">📭</div>
                <div class="titulo">Sin planillas registradas</div>
                <p>Los empleados aún no han registrado trabajos.</p>
            </div>
        `;
        return;
    }
    
    let html = '';
    empleadosFiltrados.forEach(empleado => {
        const planillasEmpleado = planillasFiltradas
            .filter(p => p.usuario === empleado)
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        const planillasPorDia = {};
        const planillasMostrar = [];
        
        planillasEmpleado.forEach(p => {
            const dia = p.fecha;
            if (!planillasPorDia[dia]) planillasPorDia[dia] = 0;
            if (planillasPorDia[dia] < 7) {
                planillasPorDia[dia]++;
                planillasMostrar.push(p);
            }
        });
        
        const totalPlanillas = planillasEmpleado.length;
        const totalHoras = planillasEmpleado.reduce((sum, p) => sum + p.horas, 0);
        
        html += `
            <div class="empleado-planilla-card">
                <div class="empleado-planilla-header" onclick="togglePlanillasEmpleado('${empleado}')">
                    <span class="nombre">👤 ${empleado}</span>
                    <span class="badge-count">${totalPlanillas} trabajos · ${totalHoras}h</span>
                    <span class="toggle-icon" id="toggleIcon_${empleado}">+</span>
                </div>
                <div class="empleado-planilla-body" id="planillasBody_${empleado}">
                    ${planillasMostrar.length > 0 ? planillasMostrar.map(p => `
                        <div class="planilla-item" style="${p.id === planillas[0]?.id ? 'background:var(--verdeC);border-left:3px solid var(--verdeM);' : ''}">
                            <span class="fecha">${p.fecha}</span>
                            <span class="tipo ${p.tipo.toLowerCase()}">${p.tipo}</span>
                            <span class="modulo">${p.modulo}</span>
                            <span class="horas">${p.horas}h</span>
                            <span class="repuesto">${p.repuesto || '—'}</span>
                            <div class="acciones">
                                <button onclick="verPlanillaDetalle('${p.id}')" title="Ver detalle">👁️</button>
                                ${currentUser?.rol === 'admin' ? `<button onclick="eliminarPlanilla('${p.id}')" title="Eliminar">🗑️</button>` : ''}
                            </div>
                        </div>
                    `).join('') : `
                        <div class="planilla-vacia" style="padding:12px;">
                            <p>Sin trabajos registrados</p>
                        </div>
                    `}
                    ${totalPlanillas > 7 ? `<div style="text-align:center;font-size:12px;color:var(--sub);padding:8px;">... y ${totalPlanillas - 7} trabajos más (mostrando últimos 7)</div>` : ''}
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
    actualizarContadorPlanillas();
}

function togglePlanillasEmpleado(empleado) {
    const body = document.getElementById(`planillasBody_${empleado}`);
    const icon = document.getElementById(`toggleIcon_${empleado}`);
    if (body) {
        body.classList.toggle('open');
        if (icon) {
            icon.textContent = body.classList.contains('open') ? '✕' : '+';
            icon.classList.toggle('open');
        }
    }
}

function verPlanillaDetalle(id) {
    const planilla = planillas.find(p => p.id === id);
    if (!planilla) { showToast('Planilla no encontrada', false); return; }
    
    const detalle = `📋 PLANILLA DE TRABAJO
━━━━━━━━━━━━━━━━━━━━━
📅 Fecha: ${planilla.fecha}
👤 Técnico: ${planilla.tecnico}
🔧 Tipo: ${planilla.tipo}
📌 Módulo: ${planilla.modulo}
📝 Descripción: ${planilla.descripcion}
⏱ Horas: ${planilla.horas}
🔩 Repuesto: ${planilla.repuesto || 'Ninguno'}
💬 Observaciones: ${planilla.observaciones || '—'}`;
    alert(detalle);
}

function eliminarPlanilla(id) {
    if (currentUser?.rol !== 'admin') {
        showToast('Solo administradores pueden eliminar', false);
        return;
    }
    if (!confirm('¿Eliminar esta planilla permanentemente?')) return;
    
    showLoading(true);
    apiCall(`/api/planillas/${id}`, { method: 'DELETE' })
        .then(() => {
            showLoading(false);
            planillas = planillas.filter(p => p.id !== id);
            guardarPlanillasLocal();
            renderPlanillasRecibidasUI(document.getElementById('planillasRecibidasList'));
            showToast('✅ Planilla eliminada');
        })
        .catch(err => {
            showLoading(false);
            showToast('❌ Error: ' + err.message, false);
        });
}

function filtrarPlanillasPorEmpleado() {
    renderPlanillasRecibidasUI(document.getElementById('planillasRecibidasList'));
}

function filtrarPlanillasPorFecha() {
    renderPlanillasRecibidasUI(document.getElementById('planillasRecibidasList'));
}

function exportarPlanillasExcel() {
    if (planillas.length === 0) {
        showToast('No hay planillas para exportar', false);
        return;
    }
    
    const filtroEmpleado = document.getElementById('planillaFiltroEmpleado')?.value || '';
    const filtroFecha = document.getElementById('planillaFiltroFecha')?.value || '';
    
    let datosExportar = [...planillas];
    if (filtroEmpleado) datosExportar = datosExportar.filter(p => p.usuario === filtroEmpleado);
    if (filtroFecha) datosExportar = datosExportar.filter(p => p.fecha === filtroFecha);
    
    if (datosExportar.length === 0) {
        showToast('No hay planillas con los filtros seleccionados', false);
        return;
    }
    
    const wb = XLSX.utils.book_new();
    
    const data = datosExportar.map(p => ({
        'Fecha': p.fecha,
        'Técnico': p.tecnico,
        'Tipo': p.tipo,
        'Módulo': p.modulo,
        'Descripción': p.descripcion,
        'Horas': p.horas,
        'Repuesto': p.repuesto || 'Ninguno',
        'Observaciones': p.observaciones || '',
        'Registrado por': p.usuario
    }));
    
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [
        { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 20 },
        { wch: 40 }, { wch: 10 }, { wch: 20 }, { wch: 30 }, { wch: 15 }
    ];
    
    XLSX.utils.book_append_sheet(wb, ws, 'Planillas');
    
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    
    let nombreArchivo = 'planillas_trabajo';
    if (filtroEmpleado) nombreArchivo += `_${filtroEmpleado}`;
    if (filtroFecha) nombreArchivo += `_${filtroFecha}`;
    nombreArchivo += `.xlsx`;
    
    link.download = nombreArchivo;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(link.href), 100);
    
    showToast('✅ Planillas exportadas a Excel');
}

function initPlanillaFecha() {
    const fechaInput = document.getElementById('planillaFecha');
    if (fechaInput) {
        const hoy = new Date();
        const year = hoy.getFullYear();
        const month = String(hoy.getMonth() + 1).padStart(2, '0');
        const day = String(hoy.getDate()).padStart(2, '0');
        fechaInput.value = `${year}-${month}-${day}`;
    }
    
    const tecnicoInput = document.getElementById('planillaTecnico');
    if (tecnicoInput && currentUser) {
        tecnicoInput.value = currentUser.username;
    }
}

function actualizarVisibilidadPlanillas() {
    const planillasRecibidasBtn = document.getElementById('planillasRecibidasBtn');
    if (planillasRecibidasBtn) {
        planillasRecibidasBtn.style.display = (currentUser?.rol === 'admin') ? 'block' : 'none';
    }
    const correctivosBtn = document.getElementById('correctivosBtn');
    if (correctivosBtn) {
        correctivosBtn.style.display = (currentUser?.rol === 'admin') ? 'block' : 'none';
    }
}

// ============================================================
//  CORRECTIVOS - FUNCIONES COMPLETAS
// ============================================================

function cargarCorrectivos() {
    if (!token) return Promise.resolve([]);
    
    return apiCall('/api/correctivos')
        .then(data => {
            correctivos = data || [];
            correctivosCargados = true;
            return correctivos;
        })
        .catch(err => {
            console.log('Error al cargar correctivos:', err);
            return [];
        });
}

function getTecnicosDeCorrectivos() {
    return [...new Set(correctivos.map(c => c.tecnico).filter(Boolean))].sort();
}

function renderCorrectivosPorTecnico() {
    const container = document.getElementById('correctivosList');
    if (!container) return;
    
    const filtroBusqueda = document.getElementById('correctivosSearch')?.value?.toLowerCase() || '';
    const tecnicos = getTecnicosDeCorrectivos();
    
    if (tecnicos.length === 0) {
        container.innerHTML = `
            <div class="planilla-vacia">
                <div class="icono">📋</div>
                <div class="titulo">Sin registros correctivos</div>
                <p>Importá el archivo Excel para ver los registros.</p>
            </div>
        `;
        return;
    }
    
    let tecnicosFiltrados = tecnicos;
    if (filtroBusqueda) {
        tecnicosFiltrados = tecnicosFiltrados.filter(t => 
            t.toLowerCase().includes(filtroBusqueda)
        );
    }
    
    if (tecnicosFiltrados.length === 0) {
        container.innerHTML = `
            <div class="planilla-vacia">
                <div class="icono">🔍</div>
                <div class="titulo">No se encontraron técnicos</div>
                <p>Probá con otra búsqueda.</p>
            </div>
        `;
        return;
    }
    
    let html = '';
    tecnicosFiltrados.forEach(tecnico => {
        const registros = correctivos
            .filter(c => c.tecnico === tecnico)
            .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
        
        const registrosPorDia = {};
        const registrosMostrar = [];
        
        registros.forEach(r => {
            const dia = r.fecha;
            if (!registrosPorDia[dia]) registrosPorDia[dia] = 0;
            if (registrosPorDia[dia] < 7) {
                registrosPorDia[dia]++;
                registrosMostrar.push(r);
            }
        });
        
        const totalHoras = registros.reduce((sum, r) => sum + (parseFloat(r.tiempo) || 0), 0);
        
        html += `
            <div class="empleado-planilla-card">
                <div class="empleado-planilla-header" onclick="toggleCorrectivosTecnico('${tecnico}')">
                    <span class="nombre">👤 ${tecnico}</span>
                    <span class="badge-count">${registros.length} tareas · ${totalHoras}h</span>
                    <span class="toggle-icon" id="toggleCorrectivosIcon_${tecnico}">+</span>
                </div>
                <div class="empleado-planilla-body" id="correctivosBody_${tecnico}">
                    ${registrosMostrar.map(r => {
                        const fechaMostrar = fechaToMMDDAA(r.fecha);
                        const tipoClase = (r.tipoIntervencion || 'otro').toLowerCase();
                        return `
                        <div class="planilla-item" style="${r.id === registros[0]?.id ? 'background:var(--verdeC);border-left:3px solid var(--verdeM);' : ''}">
                            <span class="fecha">${fechaMostrar}</span>
                            <span class="tipo ${tipoClase}">${r.tipoIntervencion || '—'}</span>
                            <span class="modulo">${r.modulo || '—'}</span>
                            <span class="horas">${r.tiempo || 0}h</span>
                            <span class="repuesto">${r.maquina || '—'}</span>
                            <div class="acciones">
                                <button onclick="verCorrectivoDetalle('${r.id}')" title="Ver detalle">👁️</button>
                                <button onclick="eliminarCorrectivo('${r.id}')" title="Eliminar">🗑️</button>
                            </div>
                        </div>`;
                    }).join('')}
                    ${registros.length > 7 ? `<div style="text-align:center;font-size:12px;color:var(--sub);padding:8px;">... y ${registros.length - 7} tareas más</div>` : ''}
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

function toggleCorrectivosTecnico(tecnico) {
    const body = document.getElementById(`correctivosBody_${tecnico}`);
    const icon = document.getElementById(`toggleCorrectivosIcon_${tecnico}`);
    if (body) {
        body.classList.toggle('open');
        if (icon) {
            icon.textContent = body.classList.contains('open') ? '✕' : '+';
            icon.classList.toggle('open');
        }
    }
}

function verCorrectivoDetalle(id) {
    const registro = correctivos.find(c => c.id === id);
    if (!registro) {
        showToast('Registro no encontrado', false);
        return;
    }
    
    const detalle = `
📋 REGISTRO CORRECTIVO
━━━━━━━━━━━━━━━━━━━━━
🔢 ID: ${registro.id}
📅 Fecha: ${fechaToMMDDAA(registro.fecha)}
👤 Técnico: ${registro.tecnico}
🏭 Máquina: ${registro.maquina || '—'}
🔧 Tipo: ${registro.tipoIntervencion || '—'}
📌 Módulo: ${registro.modulo || '—'}
📝 Solución: ${registro.solucion || '—'}
✅ Operativa: ${registro.operativa ? 'Sí' : 'No'}
💬 Comentarios: ${registro.comentarios || '—'}
📋 Tipo Orden: ${registro.tipoOrden || '—'}
⏱ Tiempo: ${registro.tiempo || 0}h
    `;
    
    alert(detalle);
}

function eliminarCorrectivo(id) {
    if (currentUser?.rol !== 'admin') {
        showToast('Solo administradores pueden eliminar', false);
        return;
    }
    
    if (!confirm('¿Eliminar este registro permanentemente?')) return;
    
    showLoading(true);
    apiCall(`/api/correctivos/${id}`, { method: 'DELETE' })
        .then(() => {
            showLoading(false);
            correctivos = correctivos.filter(c => c.id !== id);
            renderCorrectivosPorTecnico();
            showToast('✅ Registro eliminado');
        })
        .catch(err => {
            showLoading(false);
            showToast('❌ Error: ' + err.message, false);
        });
}

function importarCorrectivosExcel() {
    if (currentUser?.rol !== 'admin') {
        showToast('Solo administradores pueden importar', false);
        return;
    }
    
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls';
    input.onchange = function(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = function(event) {
            try {
                const wb = XLSX.read(event.target.result, { type: 'array' });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const data = XLSX.utils.sheet_to_json(ws);
                
                if (!data || data.length === 0) {
                    showToast('El archivo está vacío', false);
                    return;
                }
                
                const registros = data.map(row => ({
                    id: parseInt(row['ID_Tarea']) || Date.now() + Math.random() * 1000,
                    fecha: row['Fecha'] ? new Date(row['Fecha']).toISOString().split('T')[0] : '',
                    tecnico: String(row['Tecnico'] || '').trim(),
                    maquina: String(row['Maquina'] || '').trim(),
                    falla: String(row['Falla'] || '').trim(),
                    turno: String(row['Turno'] || '').trim(),
                    tipoIntervencion: String(row['Tipo de intervencion'] || '').trim(),
                    modulo: String(row['Modulo Intervenido'] || '').trim(),
                    solucion: String(row['Solucion'] || '').trim(),
                    operativa: row['Operativa'] === true || row['Operativa'] === 'True' || row['Operativa'] === 1,
                    comentarios: String(row['Comentarios'] || '').trim(),
                    tipoOrden: String(row['Tipo de Orden'] || '').trim(),
                    tiempo: parseFloat(row['Tiempo de trabajo']) || 0
                }));
                
                const validos = registros.filter(r => r.tecnico && r.id);
                
                if (validos.length === 0) {
                    showToast('No se encontraron registros válidos', false);
                    return;
                }
                
                if (!confirm(`¿Importar ${validos.length} registros correctivos?`)) return;
                
                showLoading(true);
                apiCall('/api/correctivos/import', {
                    method: 'POST',
                    body: JSON.stringify({ registros: validos })
                })
                .then(result => {
                    showLoading(false);
                    showToast(`✅ ${result.agregados} registros importados (${result.total} totales)`);
                    cargarCorrectivos().then(() => {
                        renderCorrectivosPorTecnico();
                    });
                })
                .catch(err => {
                    showLoading(false);
                    showToast('❌ Error al importar: ' + err.message, false);
                });
                
            } catch (err) {
                showToast('❌ Error al leer el archivo: ' + err.message, false);
            }
        };
        reader.readAsArrayBuffer(file);
        input.value = '';
    };
    input.click();
}

function exportarCorrectivosExcel() {
    if (currentUser?.rol !== 'admin') {
        showToast('Solo administradores pueden exportar', false);
        return;
    }
    
    if (correctivos.length === 0) {
        showToast('No hay registros para exportar', false);
        return;
    }
    
    const wb = XLSX.utils.book_new();
    
    const data = correctivos.map(r => ({
        'ID': r.id,
        'Fecha': fechaToMMDDAA(r.fecha),
        'Técnico': r.tecnico,
        'Máquina': r.maquina || '',
        'Falla': r.falla || '',
        'Turno': r.turno || '',
        'Tipo Intervención': r.tipoIntervencion || '',
        'Módulo Intervenido': r.modulo || '',
        'Solución': r.solucion || '',
        'Operativa': r.operativa ? 'Sí' : 'No',
        'Comentarios': r.comentarios || '',
        'Tipo Orden': r.tipoOrden || '',
        'Tiempo (h)': r.tiempo || 0
    }));
    
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [
        { wch: 8 }, { wch: 12 }, { wch: 18 }, { wch: 15 },
        { wch: 25 }, { wch: 12 }, { wch: 18 }, { wch: 20 },
        { wch: 35 }, { wch: 10 }, { wch: 30 }, { wch: 18 }, { wch: 10 }
    ];
    
    XLSX.utils.book_append_sheet(wb, ws, 'Correctivos');
    
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `correctivos_${new Date().toLocaleDateString('es-AR').replace(/\//g, '-')}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(link.href), 100);
    
    showToast('✅ Correctivos exportados a Excel');
}

function recargarCorrectivos() {
    showLoading(true);
    cargarCorrectivos().then(() => {
        showLoading(false);
        renderCorrectivosPorTecnico();
        showToast('✅ Correctivos recargados');
    }).catch(err => {
        showLoading(false);
        showToast('❌ Error al recargar: ' + err.message, false);
    });
}

// ============================================================
//  INICIO - Verificar token guardado
// ============================================================
const savedToken = localStorage.getItem('panol_token');
if (savedToken) {
    token = savedToken;
    fetch(`${API_URL}/api/items`, { headers: { 'Authorization': token } })
        .then(res => res.json())
        .then(data => {
            if (!data.error) {
                $('loginScreen').style.display = 'none';
                $('appScreen').style.display = 'flex';
                $('userNameDisplay').textContent = '👤 usuario';
                const rolSpan = $('userRolDisplay');
                rolSpan.textContent = 'admin';
                rolSpan.className = 'rol admin-badge';
                $('adminTabBtn').style.display = 'block';
                $('planillasRecibidasBtn').style.display = 'block';
                $('correctivosBtn').style.display = 'block';
                document.querySelectorAll('.header-btn.admin-only').forEach(el => el.style.display = 'inline-block');
                loadDataFromServer();
                iniciarPing();
                initPlanillaFecha();
                cargarPlanillasDesdeServidor().then(() => {
                    iniciarPollingPlanillas();
                });
                cargarCorrectivos();
            } else {
                localStorage.removeItem('panol_token');
            }
        })
        .catch(() => {
            localStorage.removeItem('panol_token');
        });
}

// Enter para login
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && $('loginScreen').style.display !== 'none') {
        doLogin();
    }
});

console.log('🏭 Sistema de Stock Pañol ECO FACTORY');
console.log('🔗 Conectado a:', API_URL);
console.log('📱 Versión mobile optimizada');
console.log('📋 Sistema de Planillas de Trabajo con tiempo real cargado');
console.log('🔄 Polling activo cada 5 segundos para planillas');
console.log('🔧 Sistema de Registros Correctivos cargado');
console.log('💡 Para importar Excel, asegúrate que la columna se llame "Stock Inicial"');
