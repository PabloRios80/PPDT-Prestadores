require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const { createCanvas } = require('canvas');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function pdfAPaginaImagen(rutaPdf) {
    const buffer = fs.readFileSync(rutaPdf);
    const data = new Uint8Array(buffer);
    const pdf = await pdfjsLib.getDocument({ data }).promise;

    const imagenes = [];
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2.0 }); // alta resolución

        const canvas = createCanvas(viewport.width, viewport.height);
        const context = canvas.getContext('2d');

        await page.render({ canvasContext: context, viewport }).promise;

        const base64 = canvas.toBuffer('image/png').toString('base64');
        imagenes.push(base64);
    }
    return imagenes;
}

async function main() {
    const rutaPdf = path.join(process.env.USERPROFILE, 'Downloads', 'SANTA CRUZ MARIA.pdf');
    console.log('Convirtiendo PDF a imágenes...');
    const imagenes = await pdfAPaginaImagen(rutaPdf);
    console.log(`Se generaron ${imagenes.length} imágenes.`);
const content = [
    {
        type: 'text',
        text: `Esto es un informe de laboratorio médico (puede tener varias páginas/imágenes). Extraé los siguientes valores si están presentes en el informe, y devolvé SOLO un JSON (sin texto adicional, sin markdown, sin backticks) con esta estructura exacta:

{
  "glucemia": "valor con unidad o null",
  "trigliceridos": "valor con unidad o null",
  "colesterol_total": "valor con unidad o null",
  "colesterol_hdl": "valor con unidad o null",
  "colesterol_ldl": "valor con unidad o null",
  "creatinina": "valor con unidad o null",
  "indice_filtrado_glomerular": "SOLO el número y ml/min, sin la parte /1,73 m2, o null",
  "hiv": "NEGATIVO o POSITIVO o NO REACTIVO o REACTIVO (en mayúsculas) o null",
  "hepatitis_b_antigeno_superficie": "estado en mayúsculas o null",
  "hepatitis_b_anti_core": "estado en mayúsculas o null",
  "hepatitis_c": "estado en mayúsculas o null",
  "vdrl": "estado en mayúsculas o null",
  "chagas_hai": "estado en mayúsculas o null",
  "chagas_eclia": "estado en mayúsculas o null",
  "hpv_genotipo_16": "DETECTABLE o NO DETECTABLE o null",
  "hpv_genotipo_18": "DETECTABLE o NO DETECTABLE o null",
  "hpv_otros": "DETECTABLE o NO DETECTABLE o null"
}

IMPORTANTE sobre Chagas - hay dos métodos distintos, no los confundas:
- "chagas_hai" es SOLO para el método HAI (Hemaglutinación) - ej: "CHAGAS AC. - HAI"
- "chagas_eclia" es SOLO para el método ECLIA/Electroquimioluminiscencia - ej: "CHAGAS AC. IGG" o "CHAGAS ANTICUERPOS (ECLIA)"
Si el informe solo tiene UNO de los dos métodos, completá solo ese campo y dejá el otro en null. NO repitas el mismo resultado en ambos campos.

Para el filtrado glomerular: si el informe dice "109,00 ml/min/1,73 m2", devolvé solo "109,00 ml/min" (quitando la parte de superficie corporal /1,73 m2).

Todos los estados (NEGATIVO, REACTIVO, DETECTABLE, etc.) deben ir en MAYÚSCULAS, sin importar cómo aparezcan en el documento original.

Si un valor no aparece en el informe, poné null. Sé preciso con los números y unidades exactamente como aparecen en el documento (excepto las normalizaciones indicadas arriba).`
    }
];

    for (const img of imagenes) {
        content.push({
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: img }
        });
    }

    console.log('Enviando a Claude...');
    const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{ role: 'user', content }]
    });

    console.log('\n=== RESPUESTA ===');
    console.log(response.content[0].text);
}

main().catch(console.error);