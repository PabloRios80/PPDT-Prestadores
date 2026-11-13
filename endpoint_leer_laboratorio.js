// ==========================================
// LECTURA DE PDF DE LABORATORIO CON CLAUDE
// ==========================================
// Requiere: npm install @napi-rs/canvas pdfjs-dist@3.11.174 @anthropic-ai/sdk

const Anthropic = require("@anthropic-ai/sdk");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
const { createCanvas } = require("@napi-rs/canvas");
const path = require("path");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Carpeta de fuentes estándar que trae pdfjs-dist. Sin esto, cualquier PDF
// que use una fuente estándar (Helvetica, Times, etc.) SIN incrustarla en
// el archivo se renderiza completamente en blanco de texto — la IA nunca
// recibe ninguna letra, solo logos/líneas/firmas. Esto pasó con el primer
// PDF de un laboratorio nuevo (MANLAB) y probablemente pase con cualquier
// laboratorio nuevo que se sume, hasta este fix.
const STANDARD_FONT_DATA_URL =
  path.join(require.resolve("pdfjs-dist/package.json"), "..", "standard_fonts") +
  "/";

// CanvasFactory personalizado: evita que pdfjs-dist intente cargar
// el paquete 'canvas' clásico (que requiere compilación nativa).
// Usa @napi-rs/canvas, que trae binarios precompilados.
class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
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
  "hepatitis_b_anti_core_valor": "SOLO el número del VALOR HALLADO del anti-core (ej: 2,30) si el informe lo da como número, o null",
  "hepatitis_b_anti_core_referencia": "el texto de valores de referencia impreso junto al anti-core, copiado tal cual (ej: Mayor a 1.00: No Reactivo / Menor o igual a 1.00: Reactivo), o null",
  "hepatitis_c": "estado en mayúsculas o null",
  "vdrl": "estado en mayúsculas o null",
  "sifilis_treponemica": "estado en mayúsculas (POSITIVO/NEGATIVO/REACTIVO/NO REACTIVO) o null — SOLO para prueba treponémica (ECLIA, TPHA, FTA-ABS). Es distinta del VDRL que es no treponémica.",
  "chagas_hai": "estado en mayúsculas o null",
  "chagas_eclia": "estado en mayúsculas o null",
  "hpv_genotipo_16": "DETECTABLE o NO DETECTABLE o null",
  "hpv_genotipo_18": "DETECTABLE o NO DETECTABLE o null",
  "hpv_otros": "DETECTABLE o NO DETECTABLE o null",
  "hemoglobina_glicosilada": "valor con unidad o null",
  "microalbuminuria": "valor con unidad o null",
  "creatinina_orina_espontanea": "valor con unidad o null — SOLO para creatinina en orina espontánea (no en sangre)",
  "rac_albumina_creatinina": "valor con unidad o null — es el RESULTADO final de la relación albúmina/creatinina, expresado en mg/g",
  "proteinuria": "valor con unidad o null",
  "clearence_creatinina": "valor con unidad o null",
  "somf": "NEGATIVO o POSITIVO (en mayúsculas) o null",
  "dni_paciente": "número de DNI del paciente tal como aparece en el informe, o null"
}

IMPORTANTE sobre Chagas - hay dos métodos distintos, no los confundas:
- "chagas_hai" es SOLO para el método HAI (Hemaglutinación) - ej: "CHAGAS AC. - HAI"
- "chagas_eclia" es SOLO para el método ECLIA/Electroquimioluminiscencia - ej: "CHAGAS AC. IGG" o "CHAGAS ANTICUERPOS (ECLIA)"
Si el informe solo tiene UNO de los dos métodos, completá solo ese campo y dejá el otro en null. NO repitas el mismo resultado en ambos campos.

Para el RAC (Relación Albúmina/Creatinina): este estudio tiene tres partes:
1. "microalbuminuria": el valor de albúmina en orina (ej: "97 mg/l")
2. "creatinina_orina_espontanea": el valor de creatinina en orina espontánea (ej: "42 mg/dl") — NO confundir con creatinina sérica
3. "rac_albumina_creatinina": el resultado final de la fórmula (ej: "228.13 mg/g")
Los tres campos son distintos y deben completarse por separado.

Para el filtrado glomerular: si el informe dice "109,00 ml/min/1,73 m2", devolvé solo "109,00 ml/min" (quitando la parte de superficie corporal /1,73 m2).

IMPORTANTE sobre Hepatitis B ANTI-CORE (anti-HBc): en electroquimioluminiscencia la escala es INVERSA a las demás serologías: un valor MAYOR a 1,00 es NO REACTIVO y un valor MENOR O IGUAL a 1,00 es REACTIVO. Guiate siempre por la referencia impresa en el informe y devolvé además el número en "hepatitis_b_anti_core_valor".

Todos los estados (NEGATIVO, REACTIVO, DETECTABLE, etc.) deben ir en MAYÚSCULAS, sin importar cómo aparezcan en el documento original.

Si un valor no aparece en el informe, poné null. Sé preciso con los números y unidades exactamente como aparecen en el documento (excepto las normalizaciones indicadas arriba).`;


// Convierte un PDF (buffer) en un array de imágenes PNG en base64, una por página
async function pdfABase64Imagenes(buffer) {
  const data = new Uint8Array(buffer);
  const canvasFactory = new NodeCanvasFactory();
  const pdf = await pdfjsLib.getDocument({
    data,
    canvasFactory,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
  }).promise;

  const imagenes = [];
  let texto = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    try {
      const tc = await page.getTextContent();
      texto += tc.items.map((x) => x.str).join(" ") + "\n";
    } catch (e) {
      /* PDF escaneado o sin capa de texto: seguimos solo con la imagen */
    }
    const viewport = page.getViewport({ scale: 2.0 });

    const canvasAndContext = canvasFactory.create(
      viewport.width,
      viewport.height,
    );

    await page.render({
      canvasContext: canvasAndContext.context,
      viewport,
      canvasFactory,
    }).promise;

    const base64 = canvasAndContext.canvas
      .toBuffer("image/png")
      .toString("base64");
    imagenes.push(base64);

    canvasFactory.destroy(canvasAndContext);
  }
  return { imagenes, texto };
}

// Envía las imágenes a Claude y devuelve el JSON de valores extraídos
async function leerValoresLaboratorioConClaude(buffer) {
  const { imagenes, texto } = await pdfABase64Imagenes(buffer);

  const content = [{ type: "text", text: PROMPT_LABORATORIO }];
  for (const img of imagenes) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: img },
    });
  }

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    messages: [{ role: "user", content }],
  });

  const textoRespuesta = response.content[0].text.trim();

  // Limpiar posibles backticks/markdown que el modelo pueda agregar
  const jsonLimpio = textoRespuesta
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/```\s*$/, "")
    .trim();

  const valores = JSON.parse(jsonLimpio);
  return corregirSerologiasECLIA(valores, texto);
}

// ==========================================
// CORRECCIÓN DETERMINÍSTICA DE SEROLOGÍAS ECLIA (sin IA)
// ==========================================
// Motivo (nov-2026): la IA invertía el anti-core de RedLab (ATEM). En ECLIA el
// anti-HBc es una prueba competitiva: COI > 1,00 = NO REACTIVO, COI <= 1,00 =
// REACTIVO. Las otras serologías (HIV, HBsAg, HCV) usan la escala directa.
// Si el PDF tiene texto, se lee el valor y la referencia impresa y se decide
// por código, pisando lo que diga la IA. Si el PDF es escaneado (sin texto),
// se usa el número que devolvió la IA para el anti-core.
function _normTexto(t) {
  return String(t || "")
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}
function _num(s) {
  return parseFloat(String(s).replace(",", "."));
}
function _leerBloqueECLIA(t, regexTitulo) {
  const m = t.match(regexTitulo);
  if (!m) return null;
  let resto = t.slice(m.index, m.index + 600);
  const v = resto.match(/VALOR HALLADO:[.\s]*([0-9]+[.,]?[0-9]*)/);
  if (!v) return null;
  // El bloque termina donde empieza la práctica siguiente ("METODO:" posterior al valor).
  // Sin este corte, la referencia de la práctica de abajo (p.ej. la escala inversa del
  // anti-core) se mezcla con la de esta práctica y la invierte.
  const fin = resto.indexOf("METODO:", v.index + v[0].length);
  if (fin > 0) resto = resto.slice(0, fin);
  const valor = _num(v[1]);
  if (isNaN(valor)) return null;
  const inversa =
    /MAYOR (A|DE) 1[.,]0+ ?: ?NO REACTIVO/.test(resto) ||
    /MENOR O IGUAL (A|DE) 1[.,]0+ ?: ?REACTIVO/.test(resto);
  const directa =
    /MENOR A 0[.,]90 ?: ?NO REACTIVO/.test(resto) ||
    /MAYOR O IGUAL A 1[.,]0+ ?: ?REACTIVO/.test(resto);
  if (inversa) return valor > 1 ? "NO REACTIVO" : "REACTIVO";
  if (directa) return valor < 0.9 ? "NO REACTIVO" : valor >= 1 ? "REACTIVO" : "INDETERMINADO";
  return null;
}
function corregirSerologiasECLIA(valores, texto) {
  const v = valores || {};
  const t = _normTexto(texto);
  const correcciones = {};
  if (t.length > 100) {
    const leidos = {
      hepatitis_b_anti_core: _leerBloqueECLIA(t, /ANTI ?-?CORE|ANTI ?-?HBC/),
      hiv: _leerBloqueECLIA(t, /\bHIV\b/),
      hepatitis_b_antigeno_superficie: _leerBloqueECLIA(t, /ANTIGENO DE SUPERFICIE|HBS ?AG/),
      hepatitis_c: _leerBloqueECLIA(t, /HEPATITIS C AC/),
    };
    for (const [campo, res] of Object.entries(leidos)) {
      if (res && v[campo] !== res) {
        correcciones[campo] = { ia: v[campo], pdf: res };
        v[campo] = res;
      }
    }
  }
  // PDF escaneado: si la IA dio el número del anti-core y la referencia impresa
  // indica escala inversa, la decisión la toma el código (no la IA)
  const refInversa = /MAYOR (A|DE) 1[.,]0+ ?:? ?NO REACTIVO|MENOR O IGUAL (A|DE) 1[.,]0+ ?:? ?REACTIVO/.test(
    _normTexto(v.hepatitis_b_anti_core_referencia),
  );
  if (!correcciones.hepatitis_b_anti_core && refInversa && v.hepatitis_b_anti_core_valor != null) {
    const n = _num(v.hepatitis_b_anti_core_valor);
    if (!isNaN(n)) {
      const res = n > 1 ? "NO REACTIVO" : "REACTIVO";
      if (v.hepatitis_b_anti_core !== res) {
        correcciones.hepatitis_b_anti_core = { ia: v.hepatitis_b_anti_core, valor: n, aplicado: res };
        v.hepatitis_b_anti_core = res;
      }
    }
  }
  delete v.hepatitis_b_anti_core_valor;
  delete v.hepatitis_b_anti_core_referencia;
  if (Object.keys(correcciones).length) {
    console.log("🔧 Serologías corregidas por lectura del PDF:", JSON.stringify(correcciones));
  }
  return v;
}

// ── ENDPOINT: Leer PDF de laboratorio y extraer valores con IA ──
// POST /leerLaboratorioPDF
// Body: { archivoBase64: "..." }
// Devuelve: { success: true, valores: {...}, paginas: N }
function registrarEndpointLeerLaboratorio(app) {
  app.post("/leerLaboratorioPDF", async (req, res) => {
    try {
      const { archivoBase64 } = req.body;
      if (!archivoBase64) {
        return res.json({
          success: false,
          message: "No se recibió ningún archivo.",
        });
      }

      const buffer = Buffer.from(archivoBase64, "base64");
      const valores = await leerValoresLaboratorioConClaude(buffer);

      res.json({ success: true, valores });
    } catch (error) {
      console.error(
        "Error leyendo PDF de laboratorio con Claude:",
        error.message,
      );
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // ── ENDPOINT: Leer PDF de laboratorio desde un link de Google Drive ──
  // POST /leerLaboratorioPDFDesdeLink
  // Body: { link: "https://drive.google.com/file/d/XXXX/view?usp=sharing" }
  // Devuelve: { success: true, valores: {...}, archivoBase64: "..." }
  // (también devuelve archivoBase64 para poder subirlo a Storage después)
  app.post("/leerLaboratorioPDFDesdeLink", async (req, res) => {
    try {
      const { link } = req.body;
      if (!link) {
        return res.json({
          success: false,
          message: "No se recibió ningún link.",
        });
      }

      const fileId = extraerIdDeDriveLink(link);
      if (!fileId) {
        return res.json({
          success: false,
          message:
            'No se pudo reconocer el link de Google Drive. Verificá que sea un link de "Compartir" válido.',
        });
      }

      const buffer = await descargarPDFDeDrive(fileId);
      const valores = await leerValoresLaboratorioConClaude(buffer);

      res.json({
        success: true,
        valores,
        archivoBase64: buffer.toString("base64"),
      });
    } catch (error) {
      console.error("Error leyendo PDF desde link de Drive:", error.message);
      res.status(500).json({ success: false, message: error.message });
    }
  });
}

// Extrae el ID de archivo de distintos formatos de link de Google Drive:
// - https://drive.google.com/file/d/FILE_ID/view?usp=sharing
// - https://drive.google.com/open?id=FILE_ID
// - https://drive.google.com/uc?id=FILE_ID&export=download
function extraerIdDeDriveLink(link) {
  let match = link.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];

  match = link.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match) return match[1];

  return null;
}

// Descarga un archivo público de Google Drive por su ID.
// Maneja la página de confirmación que Drive muestra para archivos
// que no puede "escanear" (común en PDFs).
async function descargarPDFDeDrive(fileId) {
  const axios = require("axios");
  const urlBase = `https://drive.google.com/uc?export=download&id=${fileId}`;

  let response = await axios.get(urlBase, {
    responseType: "arraybuffer",
    maxRedirects: 5,
  });

  // Si Drive devolvió HTML (página de confirmación) en lugar del PDF,
  // buscamos el token de confirmación y reintentamos.
  const contentType = response.headers["content-type"] || "";
  if (contentType.includes("text/html")) {
    const html = Buffer.from(response.data).toString("utf-8");

    // Buscar el formulario de confirmación (uuid/confirm token)
    const confirmMatch = html.match(/confirm=([0-9A-Za-z_-]+)/);
    const uuidMatch = html.match(/name="uuid" value="([0-9A-Za-z_-]+)"/);

    if (confirmMatch || uuidMatch) {
      const confirm = confirmMatch ? confirmMatch[1] : "";
      const uuid = uuidMatch ? `&uuid=${uuidMatch[1]}` : "";
      const urlConfirm = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=${confirm}${uuid}`;

      response = await axios.get(urlConfirm, {
        responseType: "arraybuffer",
        maxRedirects: 5,
      });
    } else {
      throw new Error(
        'El archivo no pudo descargarse automáticamente. Verificá que el permiso sea "Cualquiera con el enlace".',
      );
    }
  }

  return Buffer.from(response.data);
}

module.exports = {
  registrarEndpointLeerLaboratorio,
  corregirSerologiasECLIA,
  leerValoresLaboratorioConClaude,
  extraerIdDeDriveLink,
  descargarPDFDeDrive,
};