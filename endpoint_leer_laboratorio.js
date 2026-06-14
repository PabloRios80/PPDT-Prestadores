// ==========================================
// LECTURA DE PDF DE LABORATORIO CON CLAUDE
// ==========================================
// Requiere: npm install @napi-rs/canvas pdfjs-dist@3.11.174 @anthropic-ai/sdk

const Anthropic = require('@anthropic-ai/sdk');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const { createCanvas } = require('@napi-rs/canvas');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// CanvasFactory personalizado: evita que pdfjs-dist intente cargar
// el paquete 'canvas' clásico (que requiere compilación nativa).
// Usa @napi-rs/canvas, que trae binarios precompilados.
class NodeCanvasFactory {
    create(width, height) {
        const canvas = createCanvas(width, height);
        const context = canvas.getContext('2d');
        return { canvas, context };
    }
    reset(canvasAndContext, width, height) {
        canvasAndContext.canvas.width = width;
        canvasAndContext.canvas.height = height;
    }
    destroy(canvasAndContext) {
        canvasAndContext.canvas.width = 0;
        canvasAndContext.canvas.height = 0;
        canvasAndContext.canvas = null;
        canvasAndContext.context = null;
    }
}

const PROMPT_LABORATORIO = `Esto es un informe de laboratorio médico (puede tener varias páginas/imágenes). Extraé los siguientes valores si están presentes en el informe, y devolvé SOLO un JSON (sin texto adicional, sin markdown, sin backticks) con esta estructura exacta:

{
  "glucemia": "valor con unidad o null",
  "trigliceridos": "valor con unidad o null",
  "colesterol_total": "valor con unidad o null",
  "colesterol_hdl": "valor con unidad o null",
  "colesterol_ldl": "valor con unidad o null",
  "creatinina": "valor con unidad o null",
  "indice_filtrado_glomerular": "SOLO el número y ml/min, sin la parte /1,73 m2, o null",
  "psa": "valor con unidad o null",
  "hiv": "NEGATIVO o POSITIVO o NO REACTIVO o REACTIVO (en mayúsculas) o null",
  "hepatitis_b_antigeno_superficie": "estado en mayúsculas o null",
  "hepatitis_b_anti_core": "estado en mayúsculas o null",
  "hepatitis_c": "estado en mayúsculas o null",
  "vdrl": "estado en mayúsculas o null",
  "chagas_hai": "estado en mayúsculas o null",
  "chagas_eclia": "estado en mayúsculas o null",
  "hpv_genotipo_16": "DETECTABLE o NO DETECTABLE o null",
  "hpv_genotipo_18": "DETECTABLE o NO DETECTABLE o null",
  "hpv_otros": "DETECTABLE o NO DETECTABLE o null",
  "hemoglobina_glicosilada": "valor con unidad o null",
  "microalbuminuria": "valor con unidad o null",
  "proteinuria": "valor con unidad o null",
  "clearence_creatinina": "valor con unidad o null",
  "somf": "NEGATIVO o POSITIVO (en mayúsculas) o null",
  "dni_paciente": "número de DNI del paciente tal como aparece en el informe, o null"
}

IMPORTANTE sobre Chagas - hay dos métodos distintos, no los confundas:
- "chagas_hai" es SOLO para el método HAI (Hemaglutinación) - ej: "CHAGAS AC. - HAI"
- "chagas_eclia" es SOLO para el método ECLIA/Electroquimioluminiscencia - ej: "CHAGAS AC. IGG" o "CHAGAS ANTICUERPOS (ECLIA)"
Si el informe solo tiene UNO de los dos métodos, completá solo ese campo y dejá el otro en null. NO repitas el mismo resultado en ambos campos.

Para el filtrado glomerular: si el informe dice "109,00 ml/min/1,73 m2", devolvé solo "109,00 ml/min" (quitando la parte de superficie corporal /1,73 m2).

Todos los estados (NEGATIVO, REACTIVO, DETECTABLE, etc.) deben ir en MAYÚSCULAS, sin importar cómo aparezcan en el documento original.

Si un valor no aparece en el informe, poné null. Sé preciso con los números y unidades exactamente como aparecen en el documento (excepto las normalizaciones indicadas arriba).`;

// Convierte un PDF (buffer) en un array de imágenes PNG en base64, una por página
async function pdfABase64Imagenes(buffer) {
    const data = new Uint8Array(buffer);
    const canvasFactory = new NodeCanvasFactory();
    const pdf = await pdfjsLib.getDocument({ data, canvasFactory }).promise;

    const imagenes = [];
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2.0 });

        const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);

        await page.render({
            canvasContext: canvasAndContext.context,
            viewport,
            canvasFactory
        }).promise;

        const base64 = canvasAndContext.canvas.toBuffer('image/png').toString('base64');
        imagenes.push(base64);

        canvasFactory.destroy(canvasAndContext);
    }
    return imagenes;
}

// Envía las imágenes a Claude y devuelve el JSON de valores extraídos
async function leerValoresLaboratorioConClaude(buffer) {
    const imagenes = await pdfABase64Imagenes(buffer);

    const content = [{ type: 'text', text: PROMPT_LABORATORIO }];
    for (const img of imagenes) {
        content.push({
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: img }
        });
    }

    const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{ role: 'user', content }]
    });

    const textoRespuesta = response.content[0].text.trim();

    // Limpiar posibles backticks/markdown que el modelo pueda agregar
    const jsonLimpio = textoRespuesta
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/, '')
        .replace(/```\s*$/, '')
        .trim();

    return JSON.parse(jsonLimpio);
}

// ── ENDPOINT: Leer PDF de laboratorio y extraer valores con IA ──
// POST /leerLaboratorioPDF
// Body: { archivoBase64: "..." }
// Devuelve: { success: true, valores: {...}, paginas: N }
function registrarEndpointLeerLaboratorio(app) {
    app.post('/leerLaboratorioPDF', async (req, res) => {
        try {
            const { archivoBase64 } = req.body;
            if (!archivoBase64) {
                return res.json({ success: false, message: 'No se recibió ningún archivo.' });
            }

            const buffer = Buffer.from(archivoBase64, 'base64');
            const valores = await leerValoresLaboratorioConClaude(buffer);

            res.json({ success: true, valores });

        } catch (error) {
            console.error('Error leyendo PDF de laboratorio con Claude:', error.message);
            res.status(500).json({ success: false, message: error.message });
        }
    });
}

module.exports = { registrarEndpointLeerLaboratorio, leerValoresLaboratorioConClaude };