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

// ============================================================
//  DOM REFERENCIAS
// ============================================================
const $ = (id) => document.getElementById(id);

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
        
        // Mostrar admin tab solo para admin
        if (data.rol === 'admin') {
            $('adminTabBtn').style.display = 'block';
        }
        
        loadDataFromServer();
        iniciarPing();
    })
    .catch(err => {
        showLoading(false);
        showLoginError('Error al conectar con el servidor');
        console.error(err);
    });
}

function doLogout() {
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
    // Navegación por tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const tab = this.dataset.tab;
            switchTab(tab);
        });
    });
    
    // KPIs click
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
    $('search-input').value = '';
    $('category-select').value = 'Todas';
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

    tableBody.innerHTML = filtrados.map((item, idx) => {
        const actual = stockActual(item);
        const e = estadoItem(actual, item.minimo, item);
        const criticoLabel = esCritico(item) ? 'SI' : 'NO';
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
//  EDITAR
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
    // ... (resto del código de editar igual que antes)
    showToast('✅ Ítem actualizado');
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
    // ... (igual que antes)
}

function hideNewItemForm() {
    isCreatingNewItem = false;
    $('newItemForm').classList.remove('show');
    $('codigoExistenteGroup').style.opacity = '1';
    $('codigoExistenteGroup').style.pointerEvents = 'auto';
    $('toggleNewItemIcon').textContent = '➕';
    $('toggleNewItemText').textContent = 'Crear nuevo ítem';
}

function searchItem() {
    // ... (igual que antes)
}

function selectItem(codigo) {
    // ... (igual que antes)
}

function clearItemSelection() {
    // ... (igual que antes)
}

function registrarMovimiento() {
    // ... (igual que antes)
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
    
    // Ajustar ancho de columnas
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

function downloadBackup() {
    // ... (igual que antes)
}

function restoreBackup(event) {
    // ... (igual que antes)
}

function confirmRestore() {
    // ... (igual que antes)
}

function cancelRestore() {
    $('restoreInfo').style.display = 'none';
    pendingRestoreData = null;
}

// ============================================================
//  IMPORT EXCEL
// ============================================================
function openImportModal() {
    if (currentUser?.rol !== 'admin') {
        showToast('Solo administradores', false);
        return;
    }
    $('importModal').classList.add('show');
    resetImportModal();
}

function closeImportModal() {
    $('importModal').classList.remove('show');
}

function resetImportModal() {
    // ... (igual que antes)
}

function handleDrop(event) {
    event.preventDefault();
    if (event.dataTransfer.files[0]) processFile(event.dataTransfer.files[0]);
}

function handleFileSelect(event) {
    if (event.target.files[0]) processFile(event.target.files[0]);
}

function processFile(file) {
    // ... (igual que antes)
}

function confirmImport() {
    // ... (igual que antes)
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
                loadDataFromServer();
                iniciarPing();
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
