// ============================================================
//  PLANILLA DE TRABAJO - CON CLASIFICACIÓN
// ============================================================

function registrarPlanilla() {
    if (!currentUser) {
        showToast('Debés iniciar sesión', false);
        return;
    }
    
    const fecha = document.getElementById('planillaFecha').value;
    const tipo = document.getElementById('planillaTipo').value;
    const clasificacion = document.getElementById('planillaClasificacion').value;
    const modulo = document.getElementById('planillaModulo').value.trim();
    const descripcion = document.getElementById('planillaDescripcion').value.trim();
    const tecnico = document.getElementById('planillaTecnico').value.trim() || currentUser.username;
    const horas = parseFloat(document.getElementById('planillaHoras').value);
    const repuesto = document.getElementById('planillaRepuesto').value.trim();
    const observaciones = document.getElementById('planillaObservaciones').value.trim();
    
    if (!tipo) {
        showToast('Seleccioná un tipo de trabajo', false);
        return;
    }
    if (!modulo) {
        showToast('Ingresá el módulo intervenido', false);
        return;
    }
    if (!descripcion) {
        showToast('Ingresá la descripción de la tarea', false);
        return;
    }
    if (!horas || horas <= 0) {
        showToast('Ingresá las horas invertidas', false);
        return;
    }
    
    showLoading(true);
    
    apiCall('/api/planillas', {
        method: 'POST',
        body: JSON.stringify({
            fecha,
            tipo,
            clasificacion,
            modulo,
            descripcion,
            horas,
            repuesto,
            observaciones,
            tecnico: tecnico
        })
    })
    .then(data => {
        showLoading(false);
        if (data.success) {
            planillas.unshift(data.planilla);
            guardarPlanillasLocal();
            showToast('✅ Trabajo registrado correctamente');
            
            document.getElementById('planillaTipo').value = '';
            document.getElementById('planillaModulo').value = '';
            document.getElementById('planillaDescripcion').value = '';
            document.getElementById('planillaHoras').value = '';
            document.getElementById('planillaRepuesto').value = '';
            document.getElementById('planillaObservaciones').value = '';
            initPlanillaFecha();
            
            // Actualizar órdenes si es admin
            if (currentUser?.rol === 'admin') {
                cargarOrdenesDesdePlanillas();
                renderTablaOT();
            }
        }
    })
    .catch(err => {
        showLoading(false);
        showToast('❌ Error al registrar: ' + err.message, false);
    });
}

// ============================================================
//  ÓRDENES DE TRABAJO - DESDE PLANILLAS
// ============================================================

function cargarOrdenesDesdePlanillas() {
    // Convertir planillas a órdenes
    ordenes = planillas.map(p => ({
        id: p.id || Date.now(),
        fecha: p.fecha || '',
        maquina: p.modulo || '',
        falla: p.descripcion || '',
        clasificacion: p.clasificacion || 'Orden de Trabajo',
        tecnico: p.tecnico || p.usuario || '',
        horas: p.horas || 0,
        repuestos: p.repuesto || '',
        solucion: '',
        operativa: 'SI',
        tipoOrden: p.tipo || '',
        comentarios: p.observaciones || '',
        _origen: 'planilla'
    }));
    
    guardarOTLocal();
}

function renderTablaOT() {
    // Cargar desde planillas si es admin
    if (currentUser?.rol === 'admin') {
        cargarOrdenesDesdePlanillas();
    }
    
    const search = document.getElementById('searchInputOT')?.value?.toLowerCase() || '';
    const filtroClasificacion = document.getElementById('filterClasificacionOT')?.value || '';
    const filtroMaq = document.getElementById('filterMaquinaOT')?.value || '';
    const filtroTec = document.getElementById('filterTecnicoOT')?.value || '';
    
    let filtrados = ordenes.filter(o => {
        const matchSearch = !search || 
            (o.id || '').toString().toLowerCase().includes(search) ||
            (o.maquina || '').toLowerCase().includes(search) ||
            (o.tecnico || '').toLowerCase().includes(search) ||
            (o.falla || '').toLowerCase().includes(search);
        const matchClasificacion = !filtroClasificacion || o.clasificacion === filtroClasificacion;
        const matchMaq = !filtroMaq || o.maquina === filtroMaq;
        const matchTec = !filtroTec || o.tecnico === filtroTec;
        return matchSearch && matchClasificacion && matchMaq && matchTec;
    });
    
    // KPIs
    document.getElementById('totalOT').textContent = filtrados.length;
    const horas = filtrados.map(o => parseFloat(o.horas) || 0);
    const sumHoras = horas.reduce((a, b) => a + b, 0);
    const prom = filtrados.length ? (sumHoras / filtrados.length) : 0;
    document.getElementById('promHorasOT').textContent = prom.toFixed(1);
    const repuestos = filtrados.filter(o => o.repuestos && o.repuestos.trim()).length;
    document.getElementById('totalRepuestosOT').textContent = repuestos;
    
    // Actualizar filtros
    const maquinas = [...new Set(ordenes.map(o => o.maquina).filter(Boolean))].sort();
    const tecnicos = [...new Set(ordenes.map(o => o.tecnico).filter(Boolean))].sort();
    
    const selMaq = document.getElementById('filterMaquinaOT');
    const selTec = document.getElementById('filterTecnicoOT');
    if (selMaq) {
        const curMaq = selMaq.value;
        selMaq.innerHTML = '<option value="">Todas las máquinas</option>' + maquinas.map(m => `<option value="${m}">${m}</option>`).join('');
        selMaq.value = curMaq;
    }
    if (selTec) {
        const curTec = selTec.value;
        selTec.innerHTML = '<option value="">Todos los técnicos</option>' + tecnicos.map(t => `<option value="${t}">${t}</option>`).join('');
        selTec.value = curTec;
    }
    
    const tbody = document.getElementById('tablaBodyOT');
    const empty = document.getElementById('emptyStateOT');
    
    if (filtrados.length === 0) {
        tbody.innerHTML = '';
        if (empty) empty.style.display = 'block';
        return;
    }
    if (empty) empty.style.display = 'none';
    
    tbody.innerHTML = filtrados.map((o) => {
        let fechaStr = o.fecha || '';
        if (fechaStr && fechaStr.includes('-')) {
            const partes = fechaStr.split('-');
            if (partes.length === 3) {
                fechaStr = partes[1] + '/' + partes[2] + '/' + partes[0].slice(-2);
            }
        }
        const esPreventivo = o.clasificacion === 'Preventivo';
        const badgeClass = esPreventivo ? 'badge-info' : 'badge-warning';
        const badgeText = esPreventivo ? '🛠️ Preventivo' : '📋 Orden';
        
        return `<tr>
            <td><strong style="color:var(--verde);">${o.id || '—'}</strong></td>
            <td>${fechaStr}</td>
            <td><span class="badge-ot">${o.maquina || '—'}</span></td>
            <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${o.falla || ''}">${o.falla || '—'}</td>
            <td><span class="${badgeClass}">${badgeText}</span></td>
            <td><strong>${o.tecnico || '—'}</strong></td>
            <td style="font-weight:700;color:var(--verde);">${o.horas || 0}h</td>
            <td>${o.repuestos || '—'}</td>
            <td style="text-align:center;">
                <button class="btn-accion" onclick="verDetalleOT('${o.id}')">👁️</button>
            </td>
        </tr>`;
    }).join('');
}

function verDetalleOT(id) {
    const orden = ordenes.find(o => o.id == id);
    if (!orden) {
        showToast('Registro no encontrado', false);
        return;
    }
    
    const detalle = `📋 DETALLE DE TRABAJO
━━━━━━━━━━━━━━━━━━━━━
🔢 ID: ${orden.id}
📅 Fecha: ${orden.fecha}
🏭 Máquina: ${orden.maquina || '—'}
📋 Clasificación: ${orden.clasificacion || '—'}
📝 Descripción: ${orden.falla || '—'}
👤 Técnico: ${orden.tecnico || '—'}
⏱ Horas: ${orden.horas || 0}h
🔩 Repuestos: ${orden.repuestos || '—'}
💬 Comentarios: ${orden.comentarios || '—'}`;
    
    alert(detalle);
}

function limpiarFiltrosOT() {
    const search = document.getElementById('searchInputOT');
    const clasif = document.getElementById('filterClasificacionOT');
    const maq = document.getElementById('filterMaquinaOT');
    const tec = document.getElementById('filterTecnicoOT');
    if (search) search.value = '';
    if (clasif) clasif.value = '';
    if (maq) maq.value = '';
    if (tec) tec.value = '';
    renderTablaOT();
}

function abrirFormularioOT() {
    // Solo admin puede crear OT desde aquí
    if (currentUser?.rol !== 'admin') {
        showToast('Solo administradores pueden crear órdenes', false);
        return;
    }
    
    document.getElementById('modalOT').classList.add('show');
    document.getElementById('editIndexOT').value = -1;
    document.getElementById('modalTitleOT').textContent = '➕ Nueva Orden de Trabajo';
    document.getElementById('submitBtnOT').textContent = '✅ Guardar';
    const hoy = new Date().toISOString().split('T')[0];
    document.getElementById('otFecha').value = hoy;
    document.getElementById('otId').value = Date.now();
    document.getElementById('otOperativa').value = 'SI';
    
    // Cargar selectores
    const selMaq = document.getElementById('otMaquina');
    const selTec = document.getElementById('otTecnico');
    if (selMaq) {
        selMaq.innerHTML = '<option value="">Seleccionar máquina</option>' + 
            maquinasList.map(m => `<option value="${m}">${m}</option>`).join('');
    }
    if (selTec) {
        selTec.innerHTML = '<option value="">Seleccionar técnico</option>' + 
            tecnicosList.map(t => `<option value="${t}">${t}</option>`).join('');
    }
}

function cerrarModalOT() {
    document.getElementById('modalOT').classList.remove('show');
}

function guardarOT(e) {
    e.preventDefault();
    if (currentUser?.rol !== 'admin') {
        showToast('Solo administradores pueden crear órdenes', false);
        return;
    }
    
    const id = document.getElementById('otId').value.trim() || Date.now();
    const fecha = document.getElementById('otFecha').value;
    const maquina = document.getElementById('otMaquina').value;
    const turno = document.getElementById('otTurno').value;
    const falla = document.getElementById('otFalla').value.trim();
    const clasificacion = document.getElementById('otClasificacion').value;
    const modulo = document.getElementById('otModulo').value.trim();
    const tecnico = document.getElementById('otTecnico').value;
    const horas = parseFloat(document.getElementById('otHoras').value) || 0;
    const repuestos = document.getElementById('otRepuestos').value.trim();
    const solucion = document.getElementById('otSolucion').value.trim();
    const operativa = document.getElementById('otOperativa').value;
    const tipoOrden = document.getElementById('otTipoOrden').value;
    const comentarios = document.getElementById('otComentarios').value.trim();
    
    if (!fecha || !maquina || !tecnico) {
        showToast('Completá los campos obligatorios', false);
        return;
    }
    
    const nuevaOT = {
        id: id,
        fecha: fecha,
        maquina: maquina,
        falla: falla,
        clasificacion: clasificacion,
        tecnico: tecnico,
        horas: horas,
        repuestos: repuestos || '',
        solucion: solucion || '',
        operativa: operativa,
        tipoOrden: tipoOrden || '',
        comentarios: comentarios || '',
        turno: turno || '',
        modulo: modulo || '',
        _origen: 'admin'
    };
    
    ordenes.push(nuevaOT);
    guardarOTLocal();
    cerrarModalOT();
    renderTablaOT();
    showToast('✅ Orden creada correctamente');
}

// ============================================================
//  EXPORTAR ÓRDENES A EXCEL
// ============================================================

function exportarOTXLSX() {
    if (ordenes.length === 0) {
        showToast('No hay datos para exportar', false);
        return;
    }
    
    const datos = ordenes.map(o => ({
        'ID': o.id || '',
        'Fecha': o.fecha || '',
        'Máquina': o.maquina || '',
        'Falla': o.falla || '',
        'Clasificación': o.clasificacion || '',
        'Técnico': o.tecnico || '',
        'Horas': o.horas || 0,
        'Repuestos': o.repuestos || '',
        'Solución': o.solucion || '',
        'Operativa': o.operativa || '',
        'Comentarios': o.comentarios || ''
    }));
    
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(datos);
    ws['!cols'] = Object.keys(datos[0]).map(() => ({ wch: 18 }));
    XLSX.utils.book_append_sheet(wb, ws, 'Órdenes');
    
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `ordenes_${new Date().toLocaleDateString('es-AR').replace(/\//g, '-')}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(link.href), 100);
    
    showToast('✅ Órdenes exportadas a Excel');
}

// ============================================================
//  IMPORTAR ÓRDENES DESDE EXCEL
// ============================================================

let importDataOT = null;

function abrirImportadorOT() {
    document.getElementById('importModalOT').classList.add('show');
    document.getElementById('dropZoneOT').classList.remove('loaded');
    document.getElementById('dropIconOT').textContent = '📊';
    document.getElementById('dropTextOT').textContent = 'Hacé clic o arrastrá tu archivo Excel';
    document.getElementById('importInfoOT').style.display = 'none';
    document.getElementById('previewContainerOT').style.display = 'none';
    document.getElementById('importButtonsOT').style.display = 'none';
    importDataOT = null;
}

function cerrarImportadorOT() {
    document.getElementById('importModalOT').classList.remove('show');
}

function handleDropOT(e) {
    e.preventDefault();
    if (e.dataTransfer.files[0]) processFileOT(e.dataTransfer.files[0]);
}

function handleFileSelectOT(e) {
    if (e.target.files[0]) processFileOT(e.target.files[0]);
}

function processFileOT(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const wb = XLSX.read(e.target.result, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const data = XLSX.utils.sheet_to_json(ws);
            
            if (!data || data.length === 0) {
                showToast('El archivo está vacío', false);
                return;
            }
            
            importDataOT = data.map(row => ({
                id: row['ID'] || Date.now() + Math.random() * 1000,
                fecha: row['Fecha'] || '',
                maquina: row['Máquina'] || '',
                falla: row['Falla'] || '',
                clasificacion: row['Clasificación'] || 'Orden de Trabajo',
                tecnico: row['Técnico'] || '',
                horas: parseFloat(row['Horas']) || 0,
                repuestos: row['Repuestos'] || '',
                solucion: row['Solución'] || '',
                operativa: row['Operativa'] || 'SI',
                comentarios: row['Comentarios'] || ''
            }));
            
            if (importDataOT.length === 0) {
                showToast('No se encontraron datos válidos', false);
                return;
            }
            
            document.getElementById('dropZoneOT').classList.add('loaded');
            document.getElementById('dropIconOT').textContent = '✅';
            document.getElementById('dropTextOT').textContent = file.name + ' (' + importDataOT.length + ' registros)';
            document.getElementById('importButtonsOT').style.display = 'flex';
            
            const preview = document.getElementById('previewContainerOT');
            preview.style.display = 'block';
            preview.innerHTML = `
                <div style="font-size:12px;font-weight:700;color:var(--sub);margin:8px 0;">Vista previa (${importDataOT.length} registros)</div>
                <div class="preview-table-wrap">
                    <table>
                        <thead><tr><th>ID</th><th>Fecha</th><th>Máquina</th><th>Clasificación</th><th>Técnico</th><th>Horas</th></tr></thead>
                        <tbody>
                            ${importDataOT.slice(0, 10).map(o => `
                                <tr>
                                    <td>${o.id}</td>
                                    <td>${o.fecha}</td>
                                    <td>${o.maquina}</td>
                                    <td>${o.clasificacion}</td>
                                    <td>${o.tecnico}</td>
                                    <td>${o.horas}</td>
                                </tr>
                            `).join('')}
                            ${importDataOT.length > 10 ? `<tr><td colspan="6" style="text-align:center;color:var(--sub);">... y ${importDataOT.length - 10} más</td></tr>` : ''}
                        </tbody>
                    </table>
                </div>
            `;
        } catch (err) {
            showToast('❌ Error al leer el archivo: ' + err.message, false);
        }
    };
    reader.readAsArrayBuffer(file);
    document.getElementById('fileInputOT').value = '';
}

function confirmarImportacionOT() {
    if (!importDataOT || importDataOT.length === 0) {
        showToast('No hay datos para importar', false);
        return;
    }
    
    importDataOT.forEach(o => {
        ordenes.push(o);
    });
    
    guardarOTLocal();
    cerrarImportadorOT();
    renderTablaOT();
    showToast('✅ ' + importDataOT.length + ' órdenes importadas');
}

// ============================================================
//  INICIALIZACIÓN
// ============================================================

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
    const ordenesBtn = document.getElementById('ordenesBtn');
    if (ordenesBtn) {
        ordenesBtn.style.display = (currentUser?.rol === 'admin') ? 'block' : 'none';
    }
}

// Modificar switchTab
const originalSwitchTab = switchTab;
switchTab = function(tab) {
    originalSwitchTab(tab);
    if (tab === 'ordenes' && currentUser?.rol === 'admin') {
        renderTablaOT();
    }
    if (tab === 'planilla') {
        initPlanillaFecha();
    }
};

// Inicializar órdenes
function initOrdenes() {
    if (currentUser?.rol === 'admin') {
        cargarOrdenesDesdePlanillas();
        renderTablaOT();
    }
}

// Agregar al doLogin
const originalDoLogin = doLogin;
doLogin = function() {
    originalDoLogin();
    setTimeout(() => {
        actualizarVisibilidadPlanillas();
        initPlanillaFecha();
        if (currentUser?.rol === 'admin') {
            cargarOrdenesDesdePlanillas();
            renderTablaOT();
        }
    }, 500);
};

console.log('📋 Sistema actualizado: Preventivos y Órdenes integrados');
