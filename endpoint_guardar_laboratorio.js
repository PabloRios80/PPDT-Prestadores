// ==========================================
// GUARDAR RESULTADOS DE LABORATORIO
// ==========================================
// Reemplaza el endpoint /savePracticasLaboratorio existente.
//
// Recibe:
// {
//   dni, practicas: [{campo, descripcion, valor}, ...],
//   valoresCompletos: { glucemia: "...", colesterol_total: "...", ... },
//   archivosPDF: [{ base64, nombre }, ...],
//   idPrestador, nombrePrestador
// }
//
// Hace:
// 1. Sube cada PDF a Supabase Storage (bucket 'resultados-practicas')
// 2. Actualiza practicas_autorizadas (estado -> REALIZADA) por cada práctica detectada,
//    con su enlace_pdf correspondiente
// 3. Inserta UN registro en practicas_historicas con todas las columnas de valores
//    y link_pdf = JSON.stringify([url1, url2, ...])

// Mapeo de campo (clave del JSON de Claude) -> columna en practicas_historicas
const MAPEO_COLUMNAS_HISTORICAS = {
  glucemia: "glucemia",
  creatinina: "creatinina",
  indice_filtrado_glomerular: "indice_filtrado_glomerular",
  colesterol_total: "colesterol_total",
  colesterol_hdl: "colesterol_hdl",
  colesterol_ldl: "colesterol_ldl",
  trigliceridos: "trigliceridos",
  hiv: "hiv",
  hepatitis_b_antigeno_superficie: "hepatitis_b_antigeno",
  hepatitis_b_anti_core: "hepatitis_b_anti_core",
  hepatitis_c: "hepatitis_c",
  vdrl: "vdrl",
  sifilis_treponemica: "sifilis_treponemica",
  psa: "psa",
  chagas_hai: "chagas_hai",
  chagas_eclia: "chagas_eclia",
  hpv_genotipo_16: "hpv_genotipo_16",
  hpv_genotipo_18: "hpv_genotipo_18",
  hpv_otros: "hpv_otros",
  hemoglobina_glicosilada: "hemoglobina_glicosilada",
  microalbuminuria: "microalbuminuria",
  creatinina_orina_espontanea: "creatinina_orina_espontanea",
  rac_albumina_creatinina: "rac_albumina_creatinina",
  proteinuria: "proteinuria",
  clearence_creatinina: "clearence_creatinina",
  somf: "somf",
};

function registrarEndpointGuardarLaboratorio(app, supabase) {
  app.post("/savePracticasLaboratorio", async (req, res) => {
    try {
      const {
        dni,
        practicas,
        valoresCompletos,
        archivosPDF,
        idPrestador,
        nombrePrestador,
      } = req.body;

      console.log("Guardando prácticas de laboratorio para DNI:", dni);

      // ── 1. SUBIR PDFs A STORAGE ──
      const linksSubidos = [];
      if (Array.isArray(archivosPDF)) {
        for (const archivo of archivosPDF) {
          try {
            const buffer = Buffer.from(archivo.base64, "base64");
            const nombreLimpio = (archivo.nombre || "informe.pdf").replace(
              /[^a-zA-Z0-9._-]/g,
              "_",
            );
            const fileName = `${dni}/laboratorio_${Date.now()}_${nombreLimpio}`;

            const { error: uploadError } = await supabase.storage
              .from("resultados-practicas")
              .upload(fileName, buffer, { contentType: "application/pdf" });

            if (!uploadError) {
              const { data: urlData } = supabase.storage
                .from("resultados-practicas")
                .getPublicUrl(fileName);
              linksSubidos.push(urlData.publicUrl);
            } else {
              console.warn(
                "Error subiendo PDF a Storage:",
                uploadError.message,
              );
            }
          } catch (e) {
            console.warn("Error procesando archivo PDF:", e.message);
          }
        }
      }

      const linkPdfJSON = JSON.stringify(linksSubidos);
      const enlacePdfPrincipal = linksSubidos[0] || null;

      // ── 2. ACTUALIZAR practicas_autorizadas (deduplicado) ──
      const practicasDedup = {};
      for (const p of practicas || []) {
        const key = p.descripcion.toLowerCase().trim();
        if (!practicasDedup[key]) {
          practicasDedup[key] = p;
        } else {
          const vNuevo = (p.valor || "").toUpperCase();
          if (
            vNuevo.includes("DETECTABLE") &&
            !vNuevo.includes("NO DETECTABLE")
          )
            practicasDedup[key] = p;
          if (vNuevo.includes("POSITIVO")) practicasDedup[key] = p;
        }
      }
      const practicasUnicas = Object.values(practicasDedup);

      let guardadas = 0;
      let noAutorizadas = 0;
      for (const practica of practicasUnicas) {
        // Verificar si ya fue cargada como REALIZADA
        const { data: yaRealizada } = await supabase
          .from("practicas_autorizadas")
          .select("id, fecha_carga")
          .eq("dni", dni)
          .ilike("descripcion_practica", `%${practica.descripcion}%`)
          .eq("estado", "REALIZADA");

        if (yaRealizada && yaRealizada.length > 0) {
          noAutorizadas++;
          continue;
        }

        const { data: existentes } = await supabase
          .from("practicas_autorizadas")
          .select("id")
          .eq("dni", dni)
          .ilike("descripcion_practica", `%${practica.descripcion}%`)
          .eq("estado", "AUTORIZADA");

        const existente =
          existentes && existentes.length > 0 ? existentes[0] : null;

        if (existente) {
          await supabase
            .from("practicas_autorizadas")
            .update({
              estado: "REALIZADA",
              resultado_texto: practica.valor,
              enlace_pdf: enlacePdfPrincipal,
              fecha_carga: new Date().toISOString(),
              id_prestador: idPrestador?.toString(),
              nombre_prestador: nombrePrestador,
            })
            .eq("id", existente.id);
          guardadas++;
        } else {
          // Sin autorización previa: crear directamente como REALIZADA
          const { data: afil } = await supabase
            .from("afiliados")
            .select("nombre, apellido")
            .eq("dni", dni)
            .single();

          const nombreCompleto = afil
            ? `${afil.apellido} ${afil.nombre}`
            : null;
          await supabase.from("practicas_autorizadas").insert({
            dni,
            nombre_completo: nombreCompleto,
            descripcion_practica: practica.descripcion,
            estado: "REALIZADA",
            resultado_texto: practica.valor,
            enlace_pdf: enlacePdfPrincipal,
            fecha_autorizacion: new Date().toISOString(),
            fecha_carga: new Date().toISOString(),
            id_prestador: idPrestador?.toString(),
            nombre_prestador: nombrePrestador,
            observaciones: "Cargado sin autorización previa del algoritmo",
            origen: "prestador",
          });
          noAutorizadas++;
          guardadas++;
        }
      }
      // ── 3. INSERTAR EN practicas_historicas ──
      const { data: afiliado } = await supabase
        .from("afiliados")
        .select("nombre, apellido")
        .eq("dni", dni)
        .single();

      const registroHistorico = {
        dni,
        nombre: afiliado?.nombre || null,
        apellido: afiliado?.apellido || null,
        tipo_practica: "laboratorio",
        fecha: new Date().toISOString().split("T")[0],
        prestador: nombrePrestador,
        es_individual: true,
        link_pdf: linkPdfJSON,
      };

      // Mapear cada valor extraído a su columna correspondiente
      if (valoresCompletos) {
        Object.entries(valoresCompletos).forEach(([campo, valor]) => {
          const columna = MAPEO_COLUMNAS_HISTORICAS[campo];
          if (columna && valor) {
            registroHistorico[columna] = valor;
          }
        });
      }

      const { error: errorHistorico } = await supabase
        .from("practicas_historicas")
        .insert(registroHistorico);

      if (errorHistorico) {
        console.error(
          "Error insertando en practicas_historicas:",
          errorHistorico.message,
        );
        // No bloqueamos la respuesta: practicas_autorizadas ya se guardó.
      }

      res.json({
        success: true,
        guardadas,
        noAutorizadas,
        pdfsSubidos: linksSubidos.length,
        message: `${guardadas} prácticas guardadas.`,
      });
    } catch (error) {
      console.error("Error en /savePracticasLaboratorio:", error.message);
      res.status(500).json({ success: false, message: "Error de conexión." });
    }
  });
}

module.exports = { registrarEndpointGuardarLaboratorio };
