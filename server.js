require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const axios = require('axios');
const path = require('path');
const { registrarEndpointLeerLaboratorio } = require('./endpoint_leer_laboratorio');

const app = express();
const PORT = process.env.PORT || 3002;

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
registrarEndpointLeerLaboratorio(app);

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

// ── VERIFICAR AFILIADO IAPOS ──
app.get('/verificar-afiliado/:dni', async (req, res) => {
    const dni = req.params.dni;
    const hoy = new Date().toISOString().split('T')[0];
    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
    <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
        <BEWsValidaAfi.Execute xmlns="IAPOS_WS">
            <Usuario>CONSULTAPDP</Usuario>
            <Passwd>1Qaz</Passwd>
            <Nafiliado>${dni}</Nafiliado>
            <Badocnumdo>${dni}</Badocnumdo>
            <Tidocodigo_de_documento>96</Tidocodigo_de_documento>
            <Ogorcodigo>1</Ogorcodigo>
            <Fechpresta>${hoy}</Fechpresta>
        </BEWsValidaAfi.Execute>
    </soap:Body>
    </soap:Envelope>`;
    try {
        const response = await axios.post(
            'https://aswe.santafe.gov.ar/iapos-sw-srvt/servlet/abewsvalidaafi',
            soapBody,
            {
                headers: {
                    'Content-Type': 'text/xml; charset=utf-8',
                    'SOAPAction': 'IAPOS_WSaction/ABEWSVALIDAAFI.Execute'
                },
                timeout: 10000
            }
        );
        const xml = response.data;
        const get = (tag) => {
            const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`));
            return m ? m[1].trim() : null;
        };
        const estado = get('Estado');
        res.json({
            esActivo: estado === 'A',
            estado,
            nombre: get('Apenom'),
            edad: get('Edad'),
            sexo: get('Sexo'),
            localidad: get('Localidad'),
            mensaje: get('Msgdsc')
        });
    } catch(e) {
        res.status(500).json({ esActivo: false, error: e.message });
    }
});

// ── LOGIN PRESTADOR ──
app.post('/loginPrestador', async (req, res) => {
    try {
        const { usuario, password } = req.body;
        const { data, error } = await supabase
            .from('prestadores')
            .select('*')
            .eq('usuario', usuario)
            .eq('password', password)
            .eq('activo', true)
            .single();

        if (error || !data) {
            return res.json({ success: false, message: 'Usuario o contraseña incorrectos.' });
        }

        res.json({
            success: true,
            prestador: {
                id: data.id,
                nombre: data.nombre,
                especialidad: data.especialidad,
                ciudad: data.ciudad
            }
        });
    } catch (error) {
        console.error('Error en /loginPrestador:', error.message);
        res.status(500).json({ success: false, message: 'Error de conexión.' });
    }
});

// ── OBTENER PRÁCTICAS POR ESPECIALIDAD ──
app.get('/getPracticasPrestador/:dni/:especialidad', async (req, res) => {
    const { dni, especialidad } = req.params;

    const PRACTICAS_POR_ESPECIALIDAD = {
        'Laboratorio Bioquimico': [
            'glucemia', 'colesterol', 'creatinina', 'filtrado', 'trigliceridos',
            'anti_VIH', 'hepatitis', 'chagas', 'VDRL', 'PSA', 'HPV',
            'hemoglobina', 'microalbuminuria', 'proteinuria', 'clearence', 'SOMF'
        ],
        'Diagnostico por Imagenes': ['mamografia', 'ecografia', 'densitometria', 'aorta'],
        'Gastroenterologia': ['colonoscopia', 'VCC'],
        'Medicina': ['TA', 'IMC', 'espirometria', 'PAP', 'HPV', 'consejeria', 'vision'],
        'Odontologia': ['odontologico', 'dental'],
        'Prestador PPDT': ['vacunas']
    };

    try {
        const keywords = PRACTICAS_POR_ESPECIALIDAD[especialidad] || [];

        // Si no hay prácticas autorizadas, generarlas automáticamente
        const { data: existing } = await supabase
            .from('practicas_autorizadas')
            .select('id')
            .eq('dni', dni)
            .limit(1);

        if (!existing || existing.length === 0) {
            console.log(`Sin prácticas para DNI ${dni}, generando plan...`);
            await axios.get(`http://localhost:${PORT}/getPreventivePlan/${dni}`);
        }

        const { data, error } = await supabase
            .from('practicas_autorizadas')
            .select('*')
            .eq('dni', dni)
            .or(keywords.map(k => `descripcion_practica.ilike.%${k}%`).join(','));

        if (error) throw error;

        const { data: afiliado } = await supabase
            .from('afiliados')
            .select('nombre, apellido')
            .eq('dni', dni)
            .single();

        const practicasConNombre = (data || []).map(p => ({
            ...p,
            nombre_completo: afiliado ? `${afiliado.apellido} ${afiliado.nombre}` : p.nombre_completo
        }));

        res.json({ success: true, practicas: practicasConNombre });

    } catch (error) {
        console.error('Error en /getPracticasPrestador:', error.message);
        res.status(500).json({ success: false, message: 'Error de conexión.' });
    }
});

// ── GENERAR PLAN PREVENTIVO ──
app.get('/getPreventivePlan/:dni', async (req, res) => {
    const dni = req.params.dni;
    console.log(`Generando plan preventivo para DNI: ${dni}`);

    try {
        const { data: afiliado, error: errorAfiliado } = await supabase
            .from('afiliados').select('*').eq('dni', dni).single();

        if (errorAfiliado || !afiliado) {
            return res.json({ success: false, message: 'Afiliado no encontrado.' });
        }

        const { data: historial } = await supabase
            .from('historial_dia_preventivo').select('*')
            .eq('dni', dni).order('fechax', { ascending: false });

        const { data: practicasHistoricas } = await supabase
            .from('practicas_historicas').select('*')
            .eq('dni', dni).order('fecha', { ascending: false });

        const { data: practicasYaAutorizadas } = await supabase
            .from('practicas_autorizadas').select('*')
            .eq('dni', dni).in('estado', ['AUTORIZADA', 'REALIZADA']);

        const { data: reglas } = await supabase
            .from('reglas_preventivas').select('*');

        const practicasAutorizar = evaluarReglas(
            afiliado,
            historial || [],
            practicasHistoricas || [],
            practicasYaAutorizadas || [],
            reglas || []
        );

        if (practicasAutorizar.length === 0) {
            return res.json({ success: true, message: 'El afiliado está al día.', autorizadas: 0 });
        }

        const nombreCompleto = `${afiliado.apellido || ''} ${afiliado.nombre || ''}`.trim();
        const nuevasPracticas = practicasAutorizar.map(p => ({
            dni,
            nombre_completo: nombreCompleto,
            descripcion_practica: p.practica,
            codigo_prestacion: p.codigo || null,
            estado: 'AUTORIZADA',
            fecha_autorizacion: new Date().toISOString()
        }));

        const { error: errorInsert } = await supabase
            .from('practicas_autorizadas').insert(nuevasPracticas);

        if (errorInsert) {
            console.error('Error insertando prácticas:', errorInsert);
            return res.status(500).json({ success: false, message: 'Error al guardar prácticas.' });
        }

        console.log(`✅ ${nuevasPracticas.length} prácticas autorizadas para DNI ${dni}`);
        res.json({ success: true, autorizadas: nuevasPracticas.length, practicas: nuevasPracticas });

    } catch (error) {
        console.error('Error en /getPreventivePlan:', error.message);
        res.status(500).json({ success: false, message: 'Error al generar el plan.' });
    }
});

// ── ALGORITMO DE REGLAS ──
function evaluarReglas(afiliado, historial, practicasHistoricas, practicasYaAutorizadas, reglas) {
    const hoy = new Date();
    const practicasAutorizar = [];
    const ultimoDP = historial.length > 0 ? historial[0] : null;
    const yaAutorizadas = new Set(
        practicasYaAutorizadas.map(p => p.descripcion_practica.toLowerCase().trim())
    );

    for (const regla of reglas) {
        const edad = parseInt(afiliado.edad) || 0;
        if (regla.edad_desde && edad < regla.edad_desde) continue;
        if (regla.edad_hasta && edad > regla.edad_hasta) continue;

        if (regla.sexo_aplica && regla.sexo_aplica !== 'ambos') {
            const sexo = (afiliado.sexo_biologico || '').toLowerCase();
            if (regla.sexo_aplica === 'femenino' && !sexo.includes('fem')) continue;
            if (regla.sexo_aplica === 'masculino' && !sexo.includes('mas')) continue;
        }

        if (regla.condicion_campo && regla.condicion_valor) {
            const valorAfiliado = (afiliado[regla.condicion_campo] || '').toString().toLowerCase();
            const valoresAceptados = regla.condicion_valor.toLowerCase().split(',').map(v => v.trim());
            if (!valoresAceptados.some(v => valorAfiliado.includes(v))) continue;
        }

        if (regla.excluir_si_historial_es && ultimoDP) {
            const campoHistorial = mapearCampoHistorial(regla.historial_condicion_campo);
            if (campoHistorial) {
                const valorHistorial = (ultimoDP[campoHistorial] || '').toLowerCase();
                if (valorHistorial.includes(regla.excluir_si_historial_es.toLowerCase())) continue;
            }
        }

        if (regla.frecuencia_anios && regla.frecuencia_anios > 0) {
            const ultimaRealizacion = buscarUltimaRealizacion(regla.practica, practicasHistoricas, historial);
            if (ultimaRealizacion) {
                const diasDesdeUltima = (hoy - new Date(ultimaRealizacion)) / (1000 * 60 * 60 * 24);
                if (diasDesdeUltima < regla.frecuencia_anios * 365) continue;
            }
        }

        const practicaNorm = regla.practica.toLowerCase().trim();
        if (yaAutorizadas.has(practicaNorm)) continue;

        practicasAutorizar.push({ practica: regla.practica });
        yaAutorizadas.add(practicaNorm);
    }

    return practicasAutorizar;
}

function mapearCampoHistorial(campo) {
    if (!campo) return null;
    const MAPA = {
        'Cáncer cérvico uterino - HPV': 'cancer_cervico_hpv',
        'Cáncer cérvico uterino - PAP': 'cancer_cervico_pap',
        'SOMF': 'somf', 'VIH': 'vih',
        'Hepatitis B': 'hepatitis_b', 'Hepatitis C': 'hepatitis_c',
        'Chagas': 'chagas', 'Dislipemias': 'dislipemias',
        'Diabetes': 'diabetes', 'Presión Arterial': 'presion_arterial',
    };
    return MAPA[campo] || null;
}

function buscarUltimaRealizacion(practica, practicasHistoricas, historial) {
    const practicaNorm = practica.toLowerCase();
    const MAPA_TIPO = {
        'mamografia': 'mamografia', 'ecografia mamaria': 'eco_mamaria',
        'papanicolau': 'papanicolau', 'test hpv': 'papanicolau',
        'densitometria osea': 'densitometria', 'videocolonoscopia': 'vcc',
        'sangre oculta en materia fecal': 'laboratorio',
    };
    for (const [key, value] of Object.entries(MAPA_TIPO)) {
        if (practicaNorm.includes(key)) {
            const encontrada = practicasHistoricas.find(p => p.tipo_practica === value && p.fecha);
            if (encontrada) return encontrada.fecha;
        }
    }
    return null;
}

// ── GUARDAR RESULTADO INDIVIDUAL ──
app.post('/savePracticeResult', async (req, res) => {
    const { dni, descripcion, resultadoValor, archivoBase64, archivoNombre, idPrestador, nombrePrestador } = req.body;

    try {
        let enlacePdf = null;
        if (archivoBase64) {
            const buffer = Buffer.from(archivoBase64, 'base64');
            const fileName = `${dni}/${Date.now()}_${archivoNombre}`;
            const { data: uploadData, error: uploadError } = await supabase.storage
                .from('resultados-practicas')
                .upload(fileName, buffer, { contentType: 'application/pdf' });
            if (!uploadError) {
                const { data: urlData } = supabase.storage
                    .from('resultados-practicas').getPublicUrl(fileName);
                enlacePdf = urlData.publicUrl;
            }
        }

        const { data: existente } = await supabase
            .from('practicas_autorizadas').select('id')
            .eq('dni', dni)
            .ilike('descripcion_practica', `%${descripcion}%`)
            .eq('estado', 'AUTORIZADA').single();

        if (existente) {
            await supabase.from('practicas_autorizadas')
                .update({
                    estado: 'REALIZADA',
                    resultado_texto: resultadoValor,
                    enlace_pdf: enlacePdf,
                    fecha_carga: new Date().toISOString(),
                    id_prestador: idPrestador?.toString(),
                    nombre_prestador: nombrePrestador
                }).eq('id', existente.id);
            res.json({ success: true, message: 'Práctica guardada correctamente.' });
        } else {
            res.json({ success: false, message: 'Práctica no encontrada o ya realizada.' });
        }
    } catch (error) {
        console.error('Error en /savePracticeResult:', error.message);
        res.status(500).json({ success: false, message: 'Error al guardar.' });
    }
});

// ── GUARDAR PRÁCTICAS DE LABORATORIO (CARGA PDF) ──
app.post('/savePracticasLaboratorio', async (req, res) => {
    try {
        const { dni, practicas, idPrestador, nombrePrestador } = req.body;
        console.log('Guardando prácticas de laboratorio para DNI:', dni);

        // Backup Google Sheets (no bloqueante)
        axios.post(APPS_SCRIPT_URL, {
            action: 'guardarPracticasLaboratorio',
            payload: req.body
        }).catch(e => console.warn('Backup Google Sheets falló:', e.message));

        // Deduplicar
        const practicasDedup = {};
        for (const p of practicas) {
            const key = p.descripcion.toLowerCase().trim();
            if (!practicasDedup[key]) {
                practicasDedup[key] = p;
            } else {
                const vNuevo = (p.valor || '').toUpperCase();
                if (vNuevo.includes('DETECTABLE') && !vNuevo.includes('NO DETECTABLE')) practicasDedup[key] = p;
                if (vNuevo.includes('POSITIVO')) practicasDedup[key] = p;
            }
        }
        const practicasUnicas = Object.values(practicasDedup);
        console.log('Prácticas únicas a guardar:', practicasUnicas.length);

        let guardadas = 0;
        let noAutorizadas = 0;

        for (const practica of practicasUnicas) {
            const { data: existente } = await supabase
                .from('practicas_autorizadas').select('id')
                .eq('dni', dni)
                .ilike('descripcion_practica', `%${practica.descripcion}%`)
                .eq('estado', 'AUTORIZADA').single();

            if (existente) {
                await supabase.from('practicas_autorizadas')
                    .update({
                        estado: 'REALIZADA',
                        resultado_texto: practica.valor,
                        fecha_carga: new Date().toISOString(),
                        id_prestador: idPrestador?.toString(),
                        nombre_prestador: nombrePrestador
                    }).eq('id', existente.id);
                guardadas++;
            } else {
                noAutorizadas++;
            }
        }

        res.json({ success: true, guardadas, noAutorizadas, message: `${guardadas} prácticas guardadas.` });

    } catch (error) {
        console.error('Error en /savePracticasLaboratorio:', error.message);
        res.status(500).json({ success: false, message: 'Error de conexión.' });
    }
});

// ── DATOS AFILIADO PARA SEMÁFORO ──
app.get('/getDatosAfiliado/:dni', async (req, res) => {
    try {
        const { data: afiliado } = await supabase
            .from('afiliados').select('edad, sexo_biologico')
            .eq('dni', req.params.dni).single();

        if (!afiliado) return res.json({ success: false });
        res.json({ success: true, afiliado });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error de conexión.' });
    }
});

// ── FACTURACIÓN ──
app.get('/getFacturacion/:idPrestador/:mes/:anio', async (req, res) => {
    try {
        const { idPrestador, mes, anio } = req.params;
        const { data, error } = await supabase
            .from('practicas_autorizadas')
            .select('*')
            .eq('id_prestador', idPrestador)
            .eq('estado', 'REALIZADA')
            .neq('estado_facturacion', 'FACTURADA');

        if (error) throw error;

        const practicasFiltradas = (data || []).filter(p => {
            if (!p.fecha_carga) return false;
            const fecha = new Date(p.fecha_carga);
            return fecha.getMonth() + 1 === parseInt(mes) &&
                   fecha.getFullYear() === parseInt(anio);
        });

        res.json({ success: true, practicas: practicasFiltradas, total: practicasFiltradas.length });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error de conexión.' });
    }
});

app.post('/marcarFacturadas', async (req, res) => {
    try {
        const { idPrestador, practicas } = req.body;
        let marcadas = 0;

        for (const p of practicas) {
            const { data: existente } = await supabase
                .from('practicas_autorizadas').select('id')
                .eq('dni', p.dni)
                .ilike('descripcion_practica', p.descripcion)
                .eq('id_prestador', idPrestador)
                .single();

            if (existente) {
                await supabase.from('practicas_autorizadas')
                    .update({ estado_facturacion: 'FACTURADA' })
                    .eq('id', existente.id);
                marcadas++;
            }
        }

        res.json({ success: true, marcadas });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error de conexión.' });
    }
});

// ── GOOGLE DRIVE: LISTAR PDFs DE LABORATORIO ──
const { google } = require('googleapis');
function getDriveClient() {
    const jsonStr = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64, 'base64').toString('utf-8');
    const credentials = JSON.parse(jsonStr);
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/drive.readonly']
    });
    return google.drive({ version: 'v3', auth });
}

app.get('/listarPDFsLaboratorio', async (req, res) => {
    try {
        const drive = getDriveClient();

        // Buscar la carpeta "laboratorio" por nombre
        const carpetaRes = await drive.files.list({
            q: `name = 'laboratorio' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'files(id, name)',
            pageSize: 5
        });

        if (!carpetaRes.data.files.length) {
            return res.json({ success: false, message: 'Carpeta laboratorio no encontrada.' });
        }

        const carpetaId = carpetaRes.data.files[0].id;

        // Listar PDFs directamente en esa carpeta (Mega) y subcarpetas
        const pdfRes = await drive.files.list({
            q: `'${carpetaId}' in parents and mimeType = 'application/pdf' and trashed = false`,
            fields: 'files(id, name, createdTime, modifiedTime)',
            orderBy: 'modifiedTime desc',
            pageSize: 50
        });

        // También listar subcarpetas para el Italiano
        const subcarpetasRes = await drive.files.list({
            q: `'${carpetaId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'files(id, name)',
        });

        let todosPDFs = pdfRes.data.files.map(f => ({ ...f, carpeta: 'laboratorio' }));

        // PDFs dentro de subcarpetas
        for (const sub of subcarpetasRes.data.files) {
            if (sub.name.toLowerCase().includes('atem')) continue; // ignorar ATEM

            const subPDFs = await drive.files.list({
                q: `'${sub.id}' in parents and mimeType = 'application/pdf' and trashed = false`,
                fields: 'files(id, name, createdTime, modifiedTime)',
                orderBy: 'modifiedTime desc',
                pageSize: 50
            });
            subPDFs.data.files.forEach(f => {
                todosPDFs.push({ ...f, carpeta: sub.name });
            });
        }

        res.json({ success: true, archivos: todosPDFs });

    } catch (error) {
        console.error('Error listando PDFs Drive:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ── GOOGLE DRIVE: DESCARGAR Y EXTRAER TEXTO DE UN PDF ──
app.get('/procesarPDFDrive/:fileId', async (req, res) => {
    try {
        const drive = getDriveClient();
        const pdfParse = require('pdf-parse').default || require('pdf-parse');

        // Descargar el PDF como buffer
        const response = await drive.files.get(
            { fileId: req.params.fileId, alt: 'media' },
            { responseType: 'arraybuffer' }
        );

        const buffer = Buffer.from(response.data);
        console.log('Tamaño del buffer:', buffer.length, 'bytes');
        console.log('Primeros bytes:', buffer.slice(0, 10).toString());
        const pdfData = await pdfParse(buffer);

        res.json({
            success: true,
            texto: pdfData.text,
            paginas: pdfData.numpages
        });

    } catch (error) {
        console.error('Error procesando PDF Drive:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ── EXTRAER TEXTO DE PDF SUBIDO ──
app.post('/extraerTextoPDF', async (req, res) => {
    try {
        const { archivoBase64 } = req.body;
        if (!archivoBase64) {
            return res.json({ success: false, message: 'No se recibió ningún archivo.' });
        }

        const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
        const buffer = Buffer.from(archivoBase64, 'base64');
        const data = new Uint8Array(buffer);

        const pdf = await pdfjsLib.getDocument({ data }).promise;
        let textoCompleto = '';

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            const textoPagina = content.items.map(item => item.str).join(' ');
            textoCompleto += textoPagina + '\n';
        }

        res.json({ success: true, texto: textoCompleto, paginas: pdf.numPages });

    } catch (error) {
        console.error('Error extrayendo texto de PDF:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.listen(PORT, () => console.log(`Portal Prestadores corriendo en http://localhost:${PORT}`));