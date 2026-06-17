// ── ENDPOINT GENÉRICO: Descargar PDF desde link de Drive ──
// Reutiliza extraerIdDeDriveLink y descargarPDFDeDrive ya definidas
// en endpoint_leer_laboratorio.js para cualquier práctica (no solo laboratorio).
// POST /descargarPDFDesdeLink
// Body: { link: "https://drive.google.com/file/d/XXXX/view" }
// Devuelve: { success: true, archivoBase64: "..." }
function registrarEndpointDescargarPDFGenerico(app, extraerIdDeDriveLink, descargarPDFDeDrive) {
    app.post('/descargarPDFDesdeLink', async (req, res) => {
        try {
            const { link } = req.body;
            if (!link) {
                return res.json({ success: false, message: 'No se recibió ningún link.' });
            }

            const fileId = extraerIdDeDriveLink(link);
            if (!fileId) {
                return res.json({ success: false, message: 'Link de Google Drive no reconocido.' });
            }

            const buffer = await descargarPDFDeDrive(fileId);
            res.json({ success: true, archivoBase64: buffer.toString('base64') });

        } catch (error) {
            console.error('Error descargando PDF desde link:', error.message);
            res.status(500).json({ success: false, message: error.message });
        }
    });
}

module.exports = { registrarEndpointDescargarPDFGenerico };