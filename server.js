const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Aumentado a 50MB para soportar imágenes en base64
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Servir archivos estáticos
app.use(express.static(path.join(__dirname)));

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================================
//  BASE DE DATOS
// ============================================================
const DATA_FILE = path.join(__dirname, 'data.json');

if (!fs.existsSync(DATA_FILE)) {
    const initialData = {
        items: [
            { codigo: "PAN-001", descripcion: "Guante de cuero Talle 9", categoria: "EPP", unidad: "Par", minimo: 5, maximo: 20, inicial: 12, ubicacion: "E1-A1", planta: "Planta 1", obs: "", critico: "NO", imagenes: [] },
            { codigo: "PAN-002", descripcion: "Casco de seguridad blanco", categoria: "EPP", unidad: "Unidad", minimo: 3, maximo: 15, inicial: 7, ubicacion: "E1-A2", planta: "Planta 1", obs: "", critico: "NO", imagenes: [] },
            { codigo: "PAN-003", descripcion: "Lente de seguridad claro", categoria: "EPP", unidad: "Unidad", minimo: 10, maximo: 40, inicial: 23, ubicacion: "E1-A3", planta: "Planta 1", obs: "", critico: "NO", imagenes: [] },
            { codigo: "PAN-005", descripcion: "Grasa litio multiuso 500g", categoria: "Lubricantes", unidad: "Kg", minimo: 3, maximo: 10, inicial: 5, ubicacion: "E3-A1", planta: "Planta 1", obs: "", critico: "NO", imagenes: [] },
            { codigo: "PAN-006", descripcion: "Aceite hidráulico ISO 46 20L", categoria: "Lubricantes", unidad: "Bidón", minimo: 1, maximo: 5, inicial: 2, ubicacion: "E3-A2", planta: "Planta 1", obs: "", critico: "SI", imagenes: [] },
            { codigo: "PAN-010", descripcion: "Disco de corte 115mm", categoria: "Abrasivos", unidad: "Unidad", minimo: 20, maximo: 80, inicial: 35, ubicacion: "E5-A1", planta: "Planta 1", obs: "", critico: "NO", imagenes: [] },
            { codigo: "PAN-015", descripcion: "Rodamiento 6205 ZZ", categoria: "Rodamientos", unidad: "Unidad", minimo: 2, maximo: 8, inicial: 1, ubicacion: "E7-A2", planta: "Planta 1", obs: "", critico: "SI", imagenes: [] },
            { codigo: "PAN-016", descripcion: "Filtro hidráulico HF7", categoria: "Filtros", unidad: "Unidad", minimo: 1, maximo: 6, inicial: 3, ubicacion: "E8-A1", planta: "Planta 1", obs: "", critico: "NO", imagenes: [] }
        ],
        movimientos: [],
        planillas: [],
        correctivos: [],
        usuarios: {
            admin: { password: 'admin123', rol: 'admin' },
            empleado1: { password: 'empleado123', rol: 'empleado' },
            empleado2: { password: 'empleado123', rol: 'empleado' }
        }
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
    console.log('📦 Base de datos inicial creada');
}

function readData() {
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('❌ Error al leer datos:', error);
        return { items: [], movimientos: [], planillas: [], correctivos: [], usuarios: {} };
    }
}

function writeData(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('❌ Error al guardar datos:', error);
        return false;
    }
}

// ============================================================
//  MIDDLEWARE DE AUTENTICACIÓN
// ============================================================
function authenticate(req, res, next) {
    const token = req.headers['authorization'];
    if (!token) {
        return res.status(401).json({ error: 'Token no proporcionado' });
    }
    const data = readData();
    const user = Object.entries(data.usuarios).find(([username, userData]) => {
        return userData.token === token;
    });
    if (!user) {
        return res.status(401).json({ error: 'Token inválido' });
    }
    req.user = { username: user[0], ...user[1] };
    next();
}

// ============================================================
//  RUTAS API - AUTENTICACIÓN
// ============================================================

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const data = readData();
    
    if (!data.usuarios[username]) {
        return res.status(401).json({ error: 'Usuario no encontrado' });
    }
    
    const user = data.usuarios[username];
    if (user.password !== password) {
        return res.status(401).json({ error: 'Contraseña incorrecta' });
    }
    
    const token = Buffer.from(`${username}:${Date.now()}`).toString('base64');
    user.token = token;
    user.lastLogin = new Date().toISOString();
    writeData(data);
    
    res.json({ success: true, token: token, username: username, rol: user.rol });
});

app.post('/api/logout', authenticate, (req, res) => {
    const data = readData();
    if (data.usuarios[req.user.username]) {
        delete data.usuarios[req.user.username].token;
        writeData(data);
    }
    res.json({ success: true });
});

// ============================================================
//  RUTAS API - STOCK
// ============================================================

app.get('/api/items', authenticate, (req, res) => {
    const data = readData();
    res.json(data.items);
});

app.get('/api/movimientos', authenticate, (req, res) => {
    const data = readData();
    res.json(data.movimientos);
});

app.post('/api/movimiento', authenticate, (req, res) => {
    const { codigo, descripcion, tipo, cantidad, responsable, ot, sector, obs, categoria, unidad, minimo, maximo, ubicacion, planta, critico } = req.body;
    
    if (!codigo || !descripcion || !tipo || !cantidad) {
        return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }
    
    const data = readData();
    
    // Validar stock para SALIDA
    if (tipo === 'SALIDA') {
        const item = data.items.find(i => i.codigo === codigo);
        if (!item) {
            return res.status(404).json({ error: 'Ítem no encontrado' });
        }
        const stockActual = data.movimientos.reduce((acc, m) => {
            if (m.codigo !== codigo) return acc;
            if (m.tipo === 'ENTRADA' || m.tipo === 'DEVOLUCIÓN') return acc + Number(m.cantidad);
            if (m.tipo === 'SALIDA') return acc - Number(m.cantidad);
            return acc;
        }, item.inicial || 0);
        
        if (cantidad > stockActual) {
            return res.status(400).json({ error: 'Stock insuficiente' });
        }
    }
    
    const movimiento = {
        id: Date.now(),
        fecha: new Date().toLocaleDateString('es-AR'),
        hora: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
        tipo,
        codigo,
        descripcion,
        cantidad: Number(cantidad),
        responsable: responsable || req.user.username,
        ot: ot || '',
        sector: sector || '',
        obs: obs || '',
        usuario: req.user.username
    };
    
    data.movimientos.unshift(movimiento);
    
    // Si es ENTRADA o DEVOLUCIÓN y el ítem no existe, crearlo
    if (tipo === 'ENTRADA' || tipo === 'DEVOLUCIÓN') {
        const itemExistente = data.items.find(i => i.codigo === codigo);
        if (!itemExistente) {
            data.items.push({
                codigo: codigo,
                descripcion: descripcion,
                categoria: categoria || 'Sin categoría',
                unidad: unidad || 'Unidad',
                minimo: minimo || 1,
                maximo: maximo || 10,
                inicial: Number(cantidad),
                ubicacion: ubicacion || '',
                planta: planta || 'Planta 1',
                critico: critico || 'NO',
                obs: obs || '',
                imagenes: []
            });
        }
    }
    
    writeData(data);
    res.json({ success: true, movimiento });
});

app.post('/api/items', authenticate, (req, res) => {
    if (req.user.rol !== 'admin') {
        return res.status(403).json({ error: 'Solo administradores pueden crear ítems' });
    }
    
    const data = readData();
    const nuevoItem = req.body;
    
    if (!nuevoItem.codigo || !nuevoItem.descripcion) {
        return res.status(400).json({ error: 'Código y descripción son obligatorios' });
    }
    
    if (data.items.find(i => i.codigo === nuevoItem.codigo)) {
        return res.status(400).json({ error: 'El código ya existe' });
    }
    
    // Asegurar que tenga el campo imagenes
    if (!nuevoItem.imagenes) {
        nuevoItem.imagenes = [];
    }
    
    data.items.push(nuevoItem);
    writeData(data);
    res.json({ success: true, item: nuevoItem });
});

app.put('/api/items/:codigo', authenticate, (req, res) => {
    if (req.user.rol !== 'admin') {
        return res.status(403).json({ error: 'Solo administradores pueden editar ítems' });
    }
    
    const data = readData();
    const index = data.items.findIndex(i => i.codigo === req.params.codigo);
    
    if (index === -1) {
        return res.status(404).json({ error: 'Ítem no encontrado' });
    }
    
    // Actualizar el ítem
    data.items[index] = { ...data.items[index], ...req.body };
    
    // Asegurar que tenga el campo imagenes
    if (!data.items[index].imagenes) {
        data.items[index].imagenes = [];
    }
    
    writeData(data);
    res.json({ success: true, item: data.items[index] });
});

app.delete('/api/items/:codigo', authenticate, (req, res) => {
    if (req.user.rol !== 'admin') {
        return res.status(403).json({ error: 'Solo administradores pueden eliminar ítems' });
    }
    
    const data = readData();
    const index = data.items.findIndex(i => i.codigo === req.params.codigo);
    
    if (index === -1) {
        return res.status(404).json({ error: 'Ítem no encontrado' });
    }
    
    data.items.splice(index, 1);
    writeData(data);
    res.json({ success: true });
});

// ============================================================
//  RUTAS API - IMÁGENES (NUEVO)
// ============================================================

// Endpoint específico para actualizar solo las imágenes de un ítem
app.put('/api/items/:codigo/imagenes', authenticate, (req, res) => {
    if (req.user.rol !== 'admin') {
        return res.status(403).json({ error: 'Solo administradores pueden editar' });
    }
    
    const { imagenes } = req.body;
    if (!Array.isArray(imagenes)) {
        return res.status(400).json({ error: 'Se espera un array de imágenes' });
    }
    
    // Validar cantidad máxima
    if (imagenes.length > 5) {
        return res.status(400).json({ error: 'Máximo 5 imágenes por ítem' });
    }
    
    // Validar tamaño total
    const tamañoTotal = imagenes.reduce((total, img) => {
        if (img && img.startsWith('data:image')) {
            const base64 = img.split(',')[1] || '';
            return total + Math.round((base64.length * 3) / 4);
        }
        return total;
    }, 0);
    
    if (tamañoTotal > 25 * 1024 * 1024) {
        return res.status(400).json({ error: 'Las imágenes exceden el tamaño máximo (25MB)' });
    }
    
    const data = readData();
    const index = data.items.findIndex(i => i.codigo === req.params.codigo);
    
    if (index === -1) {
        return res.status(404).json({ error: 'Ítem no encontrado' });
    }
    
    data.items[index].imagenes = imagenes;
    // Mantener compatibilidad con campo "imagen" único
    data.items[index].imagen = imagenes.length > 0 ? imagenes[0] : null;
    
    writeData(data);
    res.json({ success: true, item: data.items[index] });
});

// ============================================================
//  RUTAS API - BACKUP
// ============================================================

app.get('/api/backup', authenticate, (req, res) => {
    if (req.user.rol !== 'admin') {
        return res.status(403).json({ error: 'Solo administradores pueden descargar backups' });
    }
    
    const data = readData();
    res.json(data);
});

app.post('/api/backup/restore', authenticate, (req, res) => {
    if (req.user.rol !== 'admin') {
        return res.status(403).json({ error: 'Solo administradores pueden restaurar backups' });
    }
    
    const backupData = req.body;
    if (!backupData.items || !backupData.movimientos || !backupData.usuarios) {
        return res.status(400).json({ error: 'Datos inválidos' });
    }
    
    // Asegurar que todos los ítems tengan el campo imagenes
    backupData.items = backupData.items.map(item => ({
        ...item,
        imagenes: item.imagenes || []
    }));
    
    writeData(backupData);
    res.json({ success: true });
});

app.get('/api/stats', authenticate, (req, res) => {
    const data = readData();
    const items = data.items;
    const movimientos = data.movimientos;
    
    const stats = {
        totalItems: items.length,
        sinStock: items.filter(i => {
            const stock = movimientos.reduce((acc, m) => {
                if (m.codigo !== i.codigo) return acc;
                if (m.tipo === 'ENTRADA' || m.tipo === 'DEVOLUCIÓN') return acc + Number(m.cantidad);
                if (m.tipo === 'SALIDA') return acc - Number(m.cantidad);
                return acc;
            }, i.inicial || 0);
            return stock <= 0;
        }).length,
        criticos: items.filter(i => i.critico && i.critico.toUpperCase() === 'SI').length,
        totalMovimientos: movimientos.length,
        categorias: [...new Set(items.map(i => i.categoria || 'Sin categoría'))].length
    };
    
    res.json(stats);
});

// ============================================================
//  RUTAS API - PLANILLAS DE TRABAJO
// ============================================================

app.get('/api/planillas', authenticate, (req, res) => {
    const data = readData();
    const planillas = data.planillas || [];
    
    if (req.user.rol === 'admin') {
        res.json(planillas);
    } else {
        res.json(planillas.filter(p => p.usuario === req.user.username));
    }
});

app.post('/api/planillas', authenticate, (req, res) => {
    const { fecha, tipo, clasificacion, modulo, descripcion, horas, repuesto, observaciones, tecnico } = req.body;
    
    if (!fecha || !tipo || !modulo || !descripcion || !horas) {
        return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }
    
    const data = readData();
    if (!data.planillas) data.planillas = [];
    
    const nuevaPlanilla = {
        id: Date.now(),
        fecha,
        tipo,
        clasificacion: clasificacion || 'Orden de Trabajo',
        modulo,
        descripcion,
        horas: Number(horas),
        repuesto: repuesto || '',
        observaciones: observaciones || '',
        usuario: req.user.username,
        tecnico: tecnico || req.user.username,
        timestamp: new Date().toISOString()
    };
    
    data.planillas.unshift(nuevaPlanilla);
    writeData(data);
    res.json({ success: true, planilla: nuevaPlanilla });
});

app.delete('/api/planillas/:id', authenticate, (req, res) => {
    if (req.user.rol !== 'admin') {
        return res.status(403).json({ error: 'Solo administradores pueden eliminar planillas' });
    }
    
    const data = readData();
    if (!data.planillas) data.planillas = [];
    
    const index = data.planillas.findIndex(p => p.id === parseInt(req.params.id));
    if (index === -1) {
        return res.status(404).json({ error: 'Planilla no encontrada' });
    }
    
    data.planillas.splice(index, 1);
    writeData(data);
    res.json({ success: true });
});

app.get('/api/planillas/usuario/:username', authenticate, (req, res) => {
    if (req.user.rol !== 'admin') {
        return res.status(403).json({ error: 'Solo administradores pueden ver planillas de otros usuarios' });
    }
    
    const data = readData();
    const planillas = (data.planillas || []).filter(p => p.usuario === req.params.username);
    res.json(planillas);
});

// ============================================================
//  RUTAS API - REGISTROS CORRECTIVOS
// ============================================================

app.get('/api/correctivos', authenticate, (req, res) => {
    const data = readData();
    const correctivos = data.correctivos || [];
    
    if (req.user.rol === 'admin') {
        res.json(correctivos);
    } else {
        res.json(correctivos.filter(c => c.tecnico === req.user.username));
    }
});

app.post('/api/correctivos/import', authenticate, (req, res) => {
    if (req.user.rol !== 'admin') {
        return res.status(403).json({ error: 'Solo administradores pueden importar' });
    }
    
    const { registros } = req.body;
    if (!registros || !Array.isArray(registros)) {
        return res.status(400).json({ error: 'Datos inválidos' });
    }
    
    const data = readData();
    if (!data.correctivos) data.correctivos = [];
    
    const idsExistentes = new Set(data.correctivos.map(c => c.id));
    let agregados = 0;
    
    registros.forEach(r => {
        if (!idsExistentes.has(r.id)) {
            data.correctivos.push({
                ...r,
                _importedAt: new Date().toISOString()
            });
            idsExistentes.add(r.id);
            agregados++;
        }
    });
    
    writeData(data);
    res.json({ success: true, agregados, total: data.correctivos.length });
});

app.get('/api/correctivos/tecnicos', authenticate, (req, res) => {
    if (req.user.rol !== 'admin') {
        return res.status(403).json({ error: 'Solo administradores' });
    }
    
    const data = readData();
    const correctivos = data.correctivos || [];
    const tecnicos = [...new Set(correctivos.map(c => c.tecnico).filter(Boolean))];
    res.json(tecnicos.sort());
});

app.get('/api/correctivos/tecnico/:nombre', authenticate, (req, res) => {
    if (req.user.rol !== 'admin') {
        return res.status(403).json({ error: 'Solo administradores' });
    }
    
    const data = readData();
    const correctivos = data.correctivos || [];
    const filtrados = correctivos.filter(c => c.tecnico === req.params.nombre);
    res.json(filtrados);
});

app.delete('/api/correctivos/:id', authenticate, (req, res) => {
    if (req.user.rol !== 'admin') {
        return res.status(403).json({ error: 'Solo administradores pueden eliminar' });
    }
    
    const data = readData();
    if (!data.correctivos) data.correctivos = [];
    
    const index = data.correctivos.findIndex(c => c.id === parseInt(req.params.id));
    if (index === -1) {
        return res.status(404).json({ error: 'Registro no encontrado' });
    }
    
    data.correctivos.splice(index, 1);
    writeData(data);
    res.json({ success: true });
});

app.get('/api/correctivos/export', authenticate, (req, res) => {
    if (req.user.rol !== 'admin') {
        return res.status(403).json({ error: 'Solo administradores' });
    }
    
    const data = readData();
    res.json(data.correctivos || []);
});

// ============================================================
//  MANEJO DE ERRORES
// ============================================================

app.use((err, req, res, next) => {
    console.error('❌ Error:', err);
    if (err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Los datos enviados son demasiado grandes. Máximo 50MB.' });
    }
    res.status(500).json({ error: 'Error interno del servidor' });
});

// ============================================================
//  INICIAR SERVIDOR
// ============================================================

app.listen(PORT, () => {
    console.log(`✅ Servidor corriendo en puerto ${PORT}`);
    console.log(`📦 Datos guardados en: ${DATA_FILE}`);
    console.log(`🖼️  Soporte de imágenes múltiples: ACTIVADO (máx 25MB total)`);
    console.log(`👥 Usuarios: admin/admin123, empleado1/empleado123, empleado2/empleado123`);
});
