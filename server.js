require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const express = require("express");
const axios = require("axios");
const https = require("https");
const agenteIapos = new https.Agent({ rejectUnauthorized: false });
const path = require("path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const {
  registrarEndpointLeerLaboratorio,
  leerValoresLaboratorioConClaude,
  extraerIdDeDriveLink,
  descargarPDFDeDrive,
} = require("./endpoint_leer_laboratorio");
const {
  registrarEndpointGuardarLaboratorio,
} = require("./endpoint_guardar_laboratorio");
const {
  registrarEndpointDescargarPDFGenerico,
} = require("./endpoint_descargar_pdf_generico");

const app = express();
const PORT = process.env.PORT || 3002;
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(express.static(path.join(__dirname, "public")));
registrarEndpointLeerLaboratorio(app);
registrarEndpointGuardarLaboratorio(app, supabase);
registrarEndpointDescargarPDFGenerico(
  app,
  extraerIdDeDriveLink,
  descargarPDFDeDrive,
);

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

// ── VERIFICAR AFILIADO IAPOS ──
app.get("/verificar-afiliado/:dni", async (req, res) => {
  const dni = req.params.dni;
  const hoy = new Date().toISOString().split("T")[0];
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
      "https://aswe.santafe.gov.ar/iapos-sw-srvt/servlet/abewsvalidaafi",
      soapBody,
      {
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: "IAPOS_WSaction/ABEWSVALIDAAFI.Execute",
        },
        timeout: 10000,
        httpsAgent: agenteIapos,
      },
    );
    const xml = response.data;
    const get = (tag) => {
      const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`));
      return m ? m[1].trim() : null;
    };
    const estado = get("Estado");
    res.json({
      esActivo: estado === "A",
      estado,
      nombre: get("Apenom"),
      edad: get("Edad"),
      sexo: get("Sexo"),
      localidad: get("Localidad"),
      mensaje: get("Msgdsc"),
    });
  } catch (e) {
    res.status(500).json({ esActivo: false, error: e.message });
  }
});

// ── LOGIN PRESTADOR ──
app.post("/loginPrestador", async (req, res) => {
  try {
    const { usuario, password } = req.body;
    const { data, error } = await supabase
      .from("prestadores_institucionales")
      .select("*")
      .eq("usuario", usuario)
      .eq("activo", true)
      .single();

    if (error || !data) {
      return res.json({
        success: false,
        message: "Usuario o contraseña incorrectos.",
      });
    }

    res.json({
      success: true,
      prestador: {
        id: data.id,
        nombre: data.nombre,
        especialidad: data.especialidad,
        ciudad: data.ciudad,
      },
    });
  } catch (error) {
    console.error("Error en /loginPrestador:", error.message);
    res.status(500).json({ success: false, message: "Error de conexión." });
  }
});

// ── OBTENER PRÁCTICAS POR ESPECIALIDAD ──
app.get("/getPracticasPrestador/:dni/:especialidad", async (req, res) => {
  const { dni, especialidad } = req.params;
  const { id_prestador } = req.query;

  const KEYWORDS_POR_CATEGORIA = {
    laboratorio: [
      "glucemia",
      "colesterol",
      "creatinina",
      "filtrado",
      "trigliceridos",
      "anti_VIH",
      "hepatitis",
      "chagas",
      "VDRL",
      "PSA",
      "HPV",
      "hemoglobina",
      "microalbuminuria",
      "proteinuria",
      "clearence",
      "SOMF",
    ],
    imagenes: ["mamografia", "ecografia", "abdominal"],
    mamografia: ["mamografia"],
    ecografia_abdominal: ["ecografia", "abdominal"],
    ecografia_mamaria: ["ecografia", "mamaria"],
    densitometria: ["densitometria", "osea"],
    gastro: ["colonoscopia", "VCC"],
    vcc: ["colonoscopia", "VCC"],
    biopsias: ["biopsia"],
    papanicolau: ["papanicolau", "pap"],
    oftalmologia: ["vision", "visual", "oftalm"],
    espirometria: ["espirometria"],
    coordinacion_dp: [
      "Topicación con flúor",
      "Enseñanza técnica H.O.",
      "Práctica bioquímica",
      "SOMF",
      "papanicolau",
      "Módulo Día Preventivo",
      "Módulo Seguimiento",
      "Telereceta",
    ],
  };

  // Mapeo de los nombres "bonitos" viejos (login PV, especialidad textual)
  // a las claves reales de prestador_practicas, para no romper compatibilidad.
  const ALIAS_ESPECIALIDAD = {
    "Laboratorio Bioquimico": "laboratorio",
    "Diagnostico por Imagenes": "imagenes",
    Densitometria: "densitometria",
    Gastroenterologia: "gastro",
    Biopsias: "biopsias",
    Papanicolau: "papanicolau",
    Oftalmologia: "oftalmologia",
    Espirometria: "espirometria",
    "Coordinacion DP": "coordinacion_dp",
  };

  try {
    let keywords = [];

    if (id_prestador) {
      // Prestador real: combinar TODAS sus categorías asignadas
      const { data: asignadas } = await supabase
        .from("prestador_practicas")
        .select("practica")
        .eq("id_prestador", id_prestador);

      (asignadas || []).forEach((a) => {
        keywords = keywords.concat(KEYWORDS_POR_CATEGORIA[a.practica] || []);
      });
    }

    // Respaldo: si no vino id_prestador o no tiene nada asignado, usar el
    // comportamiento anterior por especialidad (compatibilidad).
    if (keywords.length === 0) {
      const claveNormalizada = ALIAS_ESPECIALIDAD[especialidad] || especialidad;
      keywords = KEYWORDS_POR_CATEGORIA[claveNormalizada] || [];
    }

    // Si no hay prácticas autorizadas, generarlas automáticamente
    const { data: existing } = await supabase
      .from("practicas_autorizadas")
      .select("id")
      .eq("dni", dni)
      .limit(1);

    if (!existing || existing.length === 0) {
      console.log(`Sin prácticas para DNI ${dni}, generando plan...`);
      await axios.get(`http://localhost:${PORT}/getPreventivePlan/${dni}`);
    }

    const { data, error } = await supabase
      .from("practicas_autorizadas")
      .select("*")
      .eq("dni", dni)
      .or(keywords.map((k) => `descripcion_practica.ilike.%${k}%`).join(","));

    if (error) throw error;

    const { data: afiliado } = await supabase
      .from("afiliados")
      .select("nombre, apellido")
      .eq("dni", dni)
      .single();

    const practicasConNombre = (data || []).map((p) => ({
      ...p,
      nombre_completo: afiliado
        ? `${afiliado.apellido} ${afiliado.nombre}`
        : p.nombre_completo,
    }));

    res.json({ success: true, practicas: practicasConNombre });
  } catch (error) {
    console.error("Error en /getPracticasPrestador:", error.message);
    res.status(500).json({ success: false, message: "Error de conexión." });
  }
});

// ── GENERAR PLAN PREVENTIVO ──
app.get("/getPreventivePlan/:dni", async (req, res) => {
  const dni = req.params.dni;
  console.log(`Generando plan preventivo para DNI: ${dni}`);

  try {
    const { data: afiliado, error: errorAfiliado } = await supabase
      .from("afiliados")
      .select("*")
      .eq("dni", dni)
      .single();

    if (errorAfiliado || !afiliado) {
      return res.json({ success: false, message: "Afiliado no encontrado." });
    }

    const { data: historial } = await supabase
      .from("historial_dia_preventivo")
      .select("*")
      .eq("dni", dni)
      .order("fechax", { ascending: false });

    const { data: practicasHistoricas } = await supabase
      .from("practicas_historicas")
      .select("*")
      .eq("dni", dni)
      .order("fecha", { ascending: false });

    const { data: practicasYaAutorizadas } = await supabase
      .from("practicas_autorizadas")
      .select("*")
      .eq("dni", dni)
      .in("estado", ["AUTORIZADA", "REALIZADA"]);

    const { data: reglas } = await supabase
      .from("reglas_preventivas")
      .select("*");

    const practicasAutorizar = evaluarReglas(
      afiliado,
      historial || [],
      practicasHistoricas || [],
      practicasYaAutorizadas || [],
      reglas || [],
    );

    if (practicasAutorizar.length === 0) {
      return res.json({
        success: true,
        message: "El afiliado está al día.",
        autorizadas: 0,
      });
    }

    const nombreCompleto =
      `${afiliado.apellido || ""} ${afiliado.nombre || ""}`.trim();
    const nuevasPracticas = practicasAutorizar.map((p) => ({
      dni,
      nombre_completo: nombreCompleto,
      descripcion_practica: p.practica,
      codigo_prestacion: p.codigo || null,
      estado: "AUTORIZADA",
      fecha_autorizacion: new Date().toISOString(),
    }));

    const { error: errorInsert } = await supabase
      .from("practicas_autorizadas")
      .insert(nuevasPracticas);

    if (errorInsert) {
      console.error("Error insertando prácticas:", errorInsert);
      return res
        .status(500)
        .json({ success: false, message: "Error al guardar prácticas." });
    }

    console.log(
      `✅ ${nuevasPracticas.length} prácticas autorizadas para DNI ${dni}`,
    );
    res.json({
      success: true,
      autorizadas: nuevasPracticas.length,
      practicas: nuevasPracticas,
    });
  } catch (error) {
    console.error("Error en /getPreventivePlan:", error.message);
    res
      .status(500)
      .json({ success: false, message: "Error al generar el plan." });
  }
});

// ── ALGORITMO DE REGLAS ──
function evaluarReglas(
  afiliado,
  historial,
  practicasHistoricas,
  practicasYaAutorizadas,
  reglas,
) {
  const hoy = new Date();
  const practicasAutorizar = [];
  const ultimoDP = historial.length > 0 ? historial[0] : null;
  const yaAutorizadas = new Set(
    practicasYaAutorizadas.map((p) =>
      p.descripcion_practica.toLowerCase().trim(),
    ),
  );

  for (const regla of reglas) {
    const edad = parseInt(afiliado.edad) || 0;
    if (regla.edad_desde && edad < regla.edad_desde) continue;
    if (regla.edad_hasta && edad > regla.edad_hasta) continue;

    if (regla.sexo_aplica && regla.sexo_aplica !== "ambos") {
      const sexo = (afiliado.sexo_biologico || "").toLowerCase();
      if (regla.sexo_aplica === "femenino" && !sexo.includes("fem")) continue;
      if (regla.sexo_aplica === "masculino" && !sexo.includes("mas")) continue;
    }

    if (regla.condicion_campo && regla.condicion_valor) {
      const valorAfiliado = (afiliado[regla.condicion_campo] || "")
        .toString()
        .toLowerCase();
      const valoresAceptados = regla.condicion_valor
        .toLowerCase()
        .split(",")
        .map((v) => v.trim());
      if (!valoresAceptados.some((v) => valorAfiliado.includes(v))) continue;
    }
    if (
      regla.historial_condicion_campo &&
      regla.historial_condicion_valor &&
      ultimoDP
    ) {
      const campoHistorial = regla.historial_condicion_campo;
      const valorHistorial = (ultimoDP[campoHistorial] || "")
        .toString()
        .toLowerCase();
      const valoresAceptados = regla.historial_condicion_valor
        .toLowerCase()
        .split(",")
        .map((v) => v.trim());
      if (!valoresAceptados.some((v) => valorHistorial.includes(v))) continue;
    }
    if (regla.excluir_si_historial_es && ultimoDP) {
      const campoHistorial = mapearCampoHistorial(
        regla.historial_condicion_campo,
      );
      if (campoHistorial) {
        const valorHistorial = (ultimoDP[campoHistorial] || "").toLowerCase();
        if (
          valorHistorial.includes(regla.excluir_si_historial_es.toLowerCase())
        )
          continue;
      }
    }

    if (regla.frecuencia_anios && regla.frecuencia_anios > 0) {
      const ultimaRealizacion = buscarUltimaRealizacion(
        regla.practica,
        practicasHistoricas,
        historial,
      );
      if (ultimaRealizacion) {
        const diasDesdeUltima =
          (hoy - new Date(ultimaRealizacion)) / (1000 * 60 * 60 * 24);
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
    "Cáncer cérvico uterino - HPV": "cancer_cervico_hpv",
    "Cáncer cérvico uterino - PAP": "cancer_cervico_pap",
    SOMF: "somf",
    VIH: "vih",
    "Hepatitis B": "hepatitis_b",
    "Hepatitis C": "hepatitis_c",
    Chagas: "chagas",
    Dislipemias: "dislipemias",
    Diabetes: "diabetes",
    "Presión Arterial": "presion_arterial",
    Microalbuminuria: "microalbuminuria",
    "RAC - Relación Albúmina/Creatinina": "rac_albumina_creatinina",
  };
  return MAPA[campo] || null;
}

function buscarUltimaRealizacion(practica, practicasHistoricas, historial) {
  const practicaNorm = practica.toLowerCase();
  const MAPA_TIPO = {
    mamografia: "mamografia",
    "ecografia mamaria": "eco_mamaria",
    papanicolau: "papanicolau",
    "test hpv": "papanicolau",
    "densitometria osea": "densitometria",
    videocolonoscopia: "vcc",
    "sangre oculta en materia fecal": "laboratorio",
  };
  for (const [key, value] of Object.entries(MAPA_TIPO)) {
    if (practicaNorm.includes(key)) {
      const encontrada = practicasHistoricas.find(
        (p) => p.tipo_practica === value && p.fecha,
      );
      if (encontrada) return encontrada.fecha;
    }
  }
  return null;
}
// ── Genera un PDF simple con el resultado de SOMF, cuando el bioquímico
// carga el resultado en texto libre en vez de subir un archivo/link. ──
async function generarPdfInformeSomf({
  nombrePaciente,
  dniPaciente,
  resultado,
  nombreBioquimico,
  matriculaBioquimico,
  fecha,
}) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 400]); // A4 aprox, altura recortada
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  let y = 350;
  const margenX = 50;

  page.drawText("Día Preventivo IAPOS", {
    x: margenX,
    y,
    size: 18,
    font: fontBold,
    color: rgb(0.01, 0.25, 0.54),
  });
  y -= 22;
  page.drawText(
    "Informe de resultado — Sangre Oculta en Materia Fecal (SOMF)",
    {
      x: margenX,
      y,
      size: 12,
      font: fontRegular,
      color: rgb(0.3, 0.3, 0.3),
    },
  );
  y -= 40;

  const linea = (etiqueta, valor) => {
    page.drawText(etiqueta, { x: margenX, y, size: 11, font: fontBold });
    page.drawText(String(valor || "-"), {
      x: margenX + 150,
      y,
      size: 11,
      font: fontRegular,
    });
    y -= 24;
  };

  linea("Paciente:", nombrePaciente);
  linea("DNI:", dniPaciente);
  linea("Fecha:", fecha);
  y -= 10;

  page.drawText("Resultado:", { x: margenX, y, size: 13, font: fontBold });
  const colorResultado =
    (resultado || "").toUpperCase() === "POSITIVO"
      ? rgb(0.7, 0.1, 0.1)
      : rgb(0.1, 0.5, 0.2);
  page.drawText(String(resultado || "-").toUpperCase(), {
    x: margenX + 150,
    y,
    size: 13,
    font: fontBold,
    color: colorResultado,
  });
  y -= 50;

  page.drawText("Profesional responsable:", {
    x: margenX,
    y,
    size: 11,
    font: fontBold,
  });
  y -= 20;
  linea("Nombre:", nombreBioquimico);
  linea("Matrícula:", matriculaBioquimico);

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

// ── Busca nombre y matrícula del bioquímico responsable, ya sea que haya
// cargado como profesional individual o como institución (usa el
// responsable declarado por la institución en ese caso). ──
async function obtenerDatosBioquimicoResponsable(idPrestador) {
  try {
    const { data: prof } = await supabase
      .from("profesionales")
      .select("nombre, apellido, matricula")
      .eq("id", idPrestador)
      .maybeSingle();

    if (prof) {
      return {
        nombre: `${prof.nombre} ${prof.apellido}`.trim(),
        matricula: prof.matricula || "-",
      };
    }

    const { data: institucion } = await supabase
      .from("prestadores_institucionales")
      .select("nombre_responsable, matricula_responsable")
      .eq("id", idPrestador)
      .maybeSingle();

    if (institucion) {
      return {
        nombre: institucion.nombre_responsable || "-",
        matricula: institucion.matricula_responsable || "-",
      };
    }
  } catch (e) {
    console.warn(
      "No se pudo obtener datos del bioquímico responsable:",
      e.message,
    );
  }
  return { nombre: "-", matricula: "-" };
}

app.post("/savePracticeResult", async (req, res) => {
  const {
    dni,
    descripcion,
    resultadoValor,
    archivoBase64,
    archivoNombre,
    idPrestador,
    nombrePrestador,
  } = req.body;

  const MAPA_LAB_HISTORICAS = {
    somf: "somf",
    "sangre oculta": "somf",
    glucemia: "glucemia",
    creatinina: "creatinina",
    "filtrado glomerular": "indice_filtrado_glomerular",
    "colesterol total": "colesterol_total",
    hdl: "colesterol_hdl",
    ldl: "colesterol_ldl",
    trigliceridos: "trigliceridos",
    vih: "hiv",
    anti_vih: "hiv",
    "hepatitis b antigeno": "hepatitis_b_antigeno",
    "hepatitis b anti core": "hepatitis_b_anti_core",
    "hepatitis c": "hepatitis_c",
    vdrl: "vdrl",
    psa: "psa",
    "chagas hai": "chagas_hai",
    "chagas eclia": "chagas_eclia",
    "hpv genotipo 16": "hpv_genotipo_16",
    "hpv genotipo 18": "hpv_genotipo_18",
    "hpv otros": "hpv_otros",
    "hemoglobina glicosilada": "hemoglobina_glicosilada",
    microalbuminuria: "microalbuminuria",
    "creatinina orina": "creatinina_orina_espontanea",
    rac: "rac_albumina_creatinina",
    "relacion albumina": "rac_albumina_creatinina",
    proteinuria: "proteinuria",
    clearence: "clearence_creatinina",
  };

  const descLowerValidacion = (descripcion || "").toLowerCase();
  const esSomfValidacion =
    descLowerValidacion.includes("somf") ||
    descLowerValidacion.includes("sangre oculta");

  if (!esSomfValidacion && !archivoBase64) {
    return res.status(400).json({
      success: false,
      message:
        "Esta práctica requiere adjuntar un PDF o link con el resultado. Solo SOMF admite carga únicamente con texto.",
    });
  }

  try {
    let enlacePdf = null;
    if (archivoBase64) {
      const buffer = Buffer.from(archivoBase64, "base64");
      const fileName = `${dni}/${Date.now()}_${archivoNombre}`;
      const { error: uploadError } = await supabase.storage
        .from("resultados-practicas")
        .upload(fileName, buffer, { contentType: "application/pdf" });
      if (!uploadError) {
        const { data: urlData } = supabase.storage
          .from("resultados-practicas")
          .getPublicUrl(fileName);
        enlacePdf = urlData.publicUrl;
      }
    }

    const descLowerParaSomf = (descripcion || "").toLowerCase();
    const esSomf =
      descLowerParaSomf.includes("somf") ||
      descLowerParaSomf.includes("sangre oculta");

    // Generar PDF automático solo para SOMF, solo si no se subió archivo/link,
    // y solo si vino un resultado en texto libre.
    if (esSomf && !enlacePdf && resultadoValor) {
      try {
        const { data: afiliadoPdf } = await supabase
          .from("afiliados")
          .select("nombre, apellido")
          .eq("dni", dni)
          .single();
        const nombrePacientePdf = afiliadoPdf
          ? `${afiliadoPdf.apellido} ${afiliadoPdf.nombre}`
          : dni;

        const { nombre: nombreBioq, matricula: matriculaBioq } =
          await obtenerDatosBioquimicoResponsable(idPrestador);

        const hoyLegible = new Date().toLocaleDateString("es-AR");

        const pdfBuffer = await generarPdfInformeSomf({
          nombrePaciente: nombrePacientePdf,
          dniPaciente: dni,
          resultado: resultadoValor,
          nombreBioquimico: nombreBioq,
          matriculaBioquimico: matriculaBioq,
          fecha: hoyLegible,
        });

        const fileNamePdf = `${dni}/${Date.now()}_informe_somf.pdf`;
        const { error: uploadPdfError } = await supabase.storage
          .from("resultados-practicas")
          .upload(fileNamePdf, pdfBuffer, { contentType: "application/pdf" });

        if (!uploadPdfError) {
          const { data: urlPdfData } = supabase.storage
            .from("resultados-practicas")
            .getPublicUrl(fileNamePdf);
          enlacePdf = urlPdfData.publicUrl;
          console.log("✅ PDF automático de SOMF generado para DNI:", dni);
        } else {
          console.warn(
            "No se pudo subir el PDF automático de SOMF:",
            uploadPdfError.message,
          );
        }
      } catch (pdfErr) {
        console.error(
          "Error generando PDF automático de SOMF:",
          pdfErr.message,
        );
      }
    }

    const { data: existente } = await supabase
      .from("practicas_autorizadas")
      .select("id")
      .eq("dni", dni)
      .ilike("descripcion_practica", `%${descripcion}%`)
      .eq("estado", "AUTORIZADA")
      .single();

    if (existente) {
      await supabase
        .from("practicas_autorizadas")
        .update({
          estado: "REALIZADA",
          resultado_texto: resultadoValor,
          enlace_pdf: enlacePdf,
          fecha_carga: new Date().toISOString(),
          id_prestador: idPrestador?.toString(),
          nombre_prestador: nombrePrestador,
        })
        .eq("id", existente.id);
    } else {
      const { data: afiliado } = await supabase
        .from("afiliados")
        .select("nombre, apellido")
        .eq("dni", dni)
        .single();
      const nombreCompleto = afiliado
        ? `${afiliado.apellido} ${afiliado.nombre}`
        : null;

      const { error: insertError } = await supabase
        .from("practicas_autorizadas")
        .insert({
          dni,
          nombre_completo: nombreCompleto,
          descripcion_practica: descripcion,
          estado: "REALIZADA",
          resultado_texto: resultadoValor,
          enlace_pdf: enlacePdf,
          fecha_autorizacion: new Date().toISOString(),
          fecha_carga: new Date().toISOString(),
          id_prestador: idPrestador?.toString(),
          nombre_prestador: nombrePrestador,
          observaciones: "Cargado sin autorización previa del algoritmo",
          origen: "prestador",
        });

      if (insertError) {
        console.error(
          "Error insertando práctica sin autorización:",
          insertError.message,
        );
        return res
          .status(500)
          .json({ success: false, message: "Error al guardar." });
      }
    }

    // Actualizar practicas_historicas para prácticas de laboratorio
    const descLower = (descripcion || "").toLowerCase();
    const columnaHistorica = Object.entries(MAPA_LAB_HISTORICAS).find(([key]) =>
      descLower.includes(key),
    )?.[1];

    if (columnaHistorica) {
      const hoy = new Date().toISOString().split("T")[0];

      const { data: historico } = await supabase
        .from("practicas_historicas")
        .select("id, link_pdf_por_practica")
        .eq("dni", dni)
        .eq("tipo_practica", "laboratorio")
        .eq("fecha", hoy)
        .single();

      // El PDF de una práctica cargada individualmente NUNCA pisa el link_pdf
      // general (el de la carga masiva por IA, que cubre la mayoría de las
      // prácticas del día). Se guarda aparte, por práctica, en
      // link_pdf_por_practica — así conviven ambos sin conflicto.
      // El PDF de una práctica cargada individualmente NUNCA pisa el link_pdf
      // general (el de la carga masiva por IA, que cubre la mayoría de las
      // prácticas del día). Se guarda aparte, por práctica, en
      // link_pdf_por_practica — así conviven ambos sin conflicto.
      // SOMF queda afuera de este mapa: tiene su propio flujo exclusivo
      // (practicas_autorizadas.enlace_pdf + /obtener-estudio-somf).
      const enlacePdfParaMapa = esSomf ? null : enlacePdf;

      if (historico) {
        const mapaExistente = historico.link_pdf_por_practica || {};
        const mapaActualizado = enlacePdfParaMapa
          ? { ...mapaExistente, [columnaHistorica]: enlacePdfParaMapa }
          : mapaExistente;

        await supabase
          .from("practicas_historicas")
          .update({
            [columnaHistorica]: resultadoValor,
            es_individual: true,
            link_pdf_por_practica: mapaActualizado,
          })
          .eq("id", historico.id);
      } else {
        const { data: afil } = await supabase
          .from("afiliados")
          .select("nombre, apellido")
          .eq("dni", dni)
          .single();
        await supabase.from("practicas_historicas").insert({
          dni,
          nombre: afil?.nombre || null,
          apellido: afil?.apellido || null,
          tipo_practica: "laboratorio",
          fecha: hoy,
          prestador: nombrePrestador,
          es_individual: true,
          [columnaHistorica]: resultadoValor,
          link_pdf_por_practica: enlacePdfParaMapa
            ? { [columnaHistorica]: enlacePdfParaMapa }
            : {},
        });
      }
    }

    // Marcar en kits_seguimiento que el resultado de SOMF ya fue cargado
    if (esSomf && resultadoValor) {
      try {
        const { data: kitExistente } = await supabase
          .from("kits_seguimiento")
          .select("id")
          .eq("dni", dni)
          .eq("tipo_kit", "SOMF")
          .maybeSingle();

        if (kitExistente) {
          await supabase
            .from("kits_seguimiento")
            .update({
              resultado_cargado: true,
              resultado: resultadoValor,
              cargado_por: nombrePrestador,
              fecha_resultado: new Date().toISOString(),
            })
            .eq("id", kitExistente.id);
        } else {
          await supabase.from("kits_seguimiento").insert({
            dni,
            tipo_kit: "SOMF",
            resultado_cargado: true,
            resultado: resultadoValor,
            cargado_por: nombrePrestador,
            fecha_resultado: new Date().toISOString(),
          });
        }
      } catch (kitErr) {
        console.warn(
          "No se pudo actualizar kits_seguimiento para SOMF:",
          kitErr.message,
        );
      }
    }

    return res.json({
      success: true,
      message: "Práctica guardada correctamente.",
    });
  } catch (error) {
    console.error("Error en /savePracticeResult:", error.message);
    res.status(500).json({ success: false, message: "Error al guardar." });
  }
});
// ── DATOS AFILIADO PARA SEMÁFORO ──
app.get("/getDatosAfiliado/:dni", async (req, res) => {
  try {
    const { data: afiliado } = await supabase
      .from("afiliados")
      .select("edad, sexo_biologico")
      .eq("dni", req.params.dni)
      .single();

    if (!afiliado) return res.json({ success: false });
    res.json({ success: true, afiliado });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error de conexión." });
  }
});

// ── FACTURACIÓN ──
app.get("/getFacturacion/:idPrestador/:mes/:anio", async (req, res) => {
  try {
    const { idPrestador, mes, anio } = req.params;
    const { data, error } = await supabase
      .from("practicas_autorizadas")
      .select("*")
      .eq("id_prestador", idPrestador)
      .eq("estado", "REALIZADA")
      .neq("estado_facturacion", "FACTURADA");

    if (error) throw error;

    const practicasFiltradas = (data || []).filter((p) => {
      if (!p.fecha_carga) return false;
      const fecha = new Date(p.fecha_carga);
      return (
        fecha.getMonth() + 1 === parseInt(mes) &&
        fecha.getFullYear() === parseInt(anio)
      );
    });

    res.json({
      success: true,
      practicas: practicasFiltradas,
      total: practicasFiltradas.length,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error de conexión." });
  }
});

app.post("/marcarFacturadas", async (req, res) => {
  try {
    const { idPrestador, practicas } = req.body;
    let marcadas = 0;

    for (const p of practicas) {
      const { data: existente } = await supabase
        .from("practicas_autorizadas")
        .select("id")
        .eq("dni", p.dni)
        .ilike("descripcion_practica", p.descripcion)
        .eq("id_prestador", idPrestador)
        .single();

      if (existente) {
        await supabase
          .from("practicas_autorizadas")
          .update({ estado_facturacion: "FACTURADA" })
          .eq("id", existente.id);
        marcadas++;
      }
    }

    res.json({ success: true, marcadas });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error de conexión." });
  }
});

// ── GOOGLE DRIVE: LISTAR PDFs DE LABORATORIO ──
const { google } = require("googleapis");
function getDriveClient() {
  const jsonStr = Buffer.from(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64,
    "base64",
  ).toString("utf-8");
  const credentials = JSON.parse(jsonStr);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  return google.drive({ version: "v3", auth });
}

app.get("/listarPDFsLaboratorio", async (req, res) => {
  try {
    const drive = getDriveClient();

    // Buscar la carpeta "laboratorio" por nombre
    const carpetaRes = await drive.files.list({
      q: `name = 'laboratorio' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "files(id, name)",
      pageSize: 5,
    });

    if (!carpetaRes.data.files.length) {
      return res.json({
        success: false,
        message: "Carpeta laboratorio no encontrada.",
      });
    }

    const carpetaId = carpetaRes.data.files[0].id;

    // Listar PDFs directamente en esa carpeta (Mega) y subcarpetas
    const pdfRes = await drive.files.list({
      q: `'${carpetaId}' in parents and mimeType = 'application/pdf' and trashed = false`,
      fields: "files(id, name, createdTime, modifiedTime)",
      orderBy: "modifiedTime desc",
      pageSize: 50,
    });

    // También listar subcarpetas para el Italiano
    const subcarpetasRes = await drive.files.list({
      q: `'${carpetaId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "files(id, name)",
    });

    let todosPDFs = pdfRes.data.files.map((f) => ({
      ...f,
      carpeta: "laboratorio",
    }));

    // PDFs dentro de subcarpetas
    for (const sub of subcarpetasRes.data.files) {
      if (sub.name.toLowerCase().includes("atem")) continue; // ignorar ATEM

      const subPDFs = await drive.files.list({
        q: `'${sub.id}' in parents and mimeType = 'application/pdf' and trashed = false`,
        fields: "files(id, name, createdTime, modifiedTime)",
        orderBy: "modifiedTime desc",
        pageSize: 50,
      });
      subPDFs.data.files.forEach((f) => {
        todosPDFs.push({ ...f, carpeta: sub.name });
      });
    }

    res.json({ success: true, archivos: todosPDFs });
  } catch (error) {
    console.error("Error listando PDFs Drive:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ── GOOGLE DRIVE: DESCARGAR Y EXTRAER TEXTO DE UN PDF ──
app.get("/procesarPDFDrive/:fileId", async (req, res) => {
  try {
    const drive = getDriveClient();
    const pdfParse = require("pdf-parse").default || require("pdf-parse");

    // Descargar el PDF como buffer
    const response = await drive.files.get(
      { fileId: req.params.fileId, alt: "media" },
      { responseType: "arraybuffer" },
    );

    const buffer = Buffer.from(response.data);
    console.log("Tamaño del buffer:", buffer.length, "bytes");
    console.log("Primeros bytes:", buffer.slice(0, 10).toString());
    const pdfData = await pdfParse(buffer);

    res.json({
      success: true,
      texto: pdfData.text,
      paginas: pdfData.numpages,
    });
  } catch (error) {
    console.error("Error procesando PDF Drive:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ── EXTRAER TEXTO DE PDF SUBIDO ──
app.post("/extraerTextoPDF", async (req, res) => {
  try {
    const { archivoBase64 } = req.body;
    if (!archivoBase64) {
      return res.json({
        success: false,
        message: "No se recibió ningún archivo.",
      });
    }

    const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
    const buffer = Buffer.from(archivoBase64, "base64");
    const data = new Uint8Array(buffer);

    const pdf = await pdfjsLib.getDocument({ data }).promise;
    let textoCompleto = "";

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const textoPagina = content.items.map((item) => item.str).join(" ");
      textoCompleto += textoPagina + "\n";
    }

    res.json({ success: true, texto: textoCompleto, paginas: pdf.numPages });
  } catch (error) {
    console.error("Error extrayendo texto de PDF:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/verificarPracticasDuplicadas", async (req, res) => {
  try {
    const { dni, practicas } = req.body;
    const duplicadas = [];

    for (const practica of practicas) {
      const { data } = await supabase
        .from("practicas_autorizadas")
        .select("id")
        .eq("dni", dni)
        .ilike("descripcion_practica", `%${practica.descripcion}%`)
        .eq("estado", "REALIZADA");

      if (data && data.length > 0) {
        duplicadas.push(practica.descripcion);
      }
    }

    res.json({ success: true, duplicadas });
  } catch (e) {
    res.status(500).json({ success: false, duplicadas: [] });
  }
});

app.get("/api/mi-actividad/:mes/:anio", async (req, res) => {
  const { mes, anio } = req.params;
  const nombrePrestador = req.query.nombre;

  const fechaInicio = `${anio}-${mes.toString().padStart(2, "0")}-01`;
  const fechaFin = new Date(anio, mes, 0).toISOString().split("T")[0];

  try {
    const { data: cargadas } = await supabase
      .from("practicas_autorizadas")
      .select(
        "dni, nombre_completo, descripcion_practica, fecha_carga, nombre_prestador",
      )
      .eq("estado", "REALIZADA")
      .eq("nombre_prestador", nombrePrestador)
      .gte("fecha_carga", fechaInicio)
      .lte("fecha_carga", fechaFin)
      .order("fecha_carga", { ascending: false });

    const { data: pendientes } = await supabase
      .from("practicas_autorizadas")
      .select("dni, nombre_completo, descripcion_practica")
      .eq("estado", "AUTORIZADA")
      .eq("nombre_prestador", nombrePrestador);

    res.json({
      success: true,
      cargadas: cargadas || [],
      pendientes: pendientes || [],
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
app.delete("/eliminarPractica/:id", async (req, res) => {
  try {
    const { data: fila } = await supabase
      .from("practicas_autorizadas")
      .select("dni, descripcion_practica, fecha_carga")
      .eq("id", req.params.id)
      .maybeSingle();

    if (fila && fila.descripcion_practica === "Práctica bioquímica") {
      // Este evento genera DOS filas gemelas (B040103 + 679900) con el
      // mismo fecha_carga: hay que borrar el par completo, no solo la
      // fila cuyo id llegó desde el frontend, para no dejar huérfana la
      // otra y bloquear sin querer que otro bioquímico la vuelva a cargar.
      const { error } = await supabase
        .from("practicas_autorizadas")
        .delete()
        .eq("dni", fila.dni)
        .eq("descripcion_practica", "Práctica bioquímica")
        .eq("fecha_carga", fila.fecha_carga);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("practicas_autorizadas")
        .delete()
        .eq("id", req.params.id);
      if (error) throw error;
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
app.post("/api/bioquimico/registrar-extraccion", async (req, res) => {
  const { dni, modulo, psa, hpv, somf, idPrestador, nombrePrestador } =
    req.body;

  const hoy = new Date().toISOString().split("T")[0];
  const seMarcoModulo = !!modulo;

  try {
    const { data: registro } = await supabase
      .from("tablero_dia")
      .select("id")
      .eq("dni", dni)
      .gte("fecha", hoy)
      .lte("fecha", hoy)
      .maybeSingle();

    if (registro) {
      const updatePayload = {
        bio_paso: seMarcoModulo,
        bio_modulo: modulo || null,
        bio_cargado_analisis: true,
      };
      // Solo escribimos estos campos si vienen en TRUE — nunca los pisamos a false
      // desde acá, porque también los puede haber puesto en true la entrega/recepción
      // de kit (marcarKitEnTableroDia). Para apagarlos se usa el botón de borrar.
      if (psa) updatePayload.bio_psa = true;
      if (hpv) updatePayload.bio_hpv = true;
      if (somf) updatePayload.bio_somf = true;

      await supabase
        .from("tablero_dia")
        .update(updatePayload)
        .eq("id", registro.id);
    }

    // El código facturable (679900 / B040103) solo corresponde si se marcó
    // Módulo o HPV — SOMF y PSA solos no lo disparan.
    if (seMarcoModulo || hpv) {
      // Chequeo global por DNI (no por prestador ni por día): el Acto
      // Bioquímico se factura una sola vez por paciente, sin importar quién
      // ni cuándo lo cargó. Si el bioquímico necesita repetir la extracción
      // (ej. paciente sin ayuno), puede seguir marcando resultados
      // individuales normalmente, pero no se vuelve a generar la
      // facturación si ya existe.
      const { data: yaExiste } = await supabase
        .from("practicas_autorizadas")
        .select("id")
        .eq("dni", dni)
        .eq("descripcion_practica", "Práctica bioquímica")
        .eq("estado", "REALIZADA")
        .in("codigo_prestacion", ["B040103", "679900"])
        .limit(1)
        .maybeSingle();

      if (!yaExiste) {
        const { data: afiliado } = await supabase
          .from("afiliados")
          .select("nombre, apellido")
          .eq("dni", dni)
          .single();

        const nombreCompleto = afiliado
          ? `${afiliado.apellido} ${afiliado.nombre}`
          : null;
        const fechaCargaISO = new Date().toISOString();

        // La sede no viene del frontend: se toma de la admisión más
        // reciente del paciente en tablero_dia (mismo criterio que el
        // backfill general).
        const { data: admisionReciente } = await supabase
          .from("tablero_dia")
          .select("id_sede_dp")
          .eq("dni", dni)
          .order("fecha", { ascending: false })
          .limit(1)
          .maybeSingle();
        const idSedeBioquimica = admisionReciente?.id_sede_dp || null;

        // Dos líneas de facturación por el mismo evento, con el MISMO
        // fecha_carga (permite identificarlas como par al deshacer):
        // - B040103: pago interno al bioquímico (por cada Día Preventivo).
        // - 679900: Acto Bioquímico a cargar en SIOS, se liquida al pagador/
        //   institución, no se traslada al profesional.
        await supabase.from("practicas_autorizadas").insert([
          {
            dni,
            nombre_completo: nombreCompleto,
            descripcion_practica: "Práctica bioquímica",
            codigo_prestacion: "B040103",
            estado: "REALIZADA",
            fecha_autorizacion: hoy,
            fecha_carga: fechaCargaISO,
            id_prestador: idPrestador?.toString(),
            nombre_prestador: nombrePrestador,
            id_sede_dp: idSedeBioquimica,
          },
          {
            dni,
            nombre_completo: nombreCompleto,
            descripcion_practica: "Práctica bioquímica",
            codigo_prestacion: "679900",
            estado: "REALIZADA",
            fecha_autorizacion: hoy,
            fecha_carga: fechaCargaISO,
            id_prestador: idPrestador?.toString(),
            nombre_prestador: nombrePrestador,
            id_sede_dp: idSedeBioquimica,
          },
        ]);
      }
    }

    // 679915 (PSA) — se dispara solo por marcar PSA, con o sin módulo,
    // exclusivo a SIOS (sin código interno de pago asociado).
    if (psa) {
      const { data: yaExistePsa } = await supabase
        .from("practicas_autorizadas")
        .select("id")
        .eq("dni", dni)
        .eq("descripcion_practica", "PSA (Antígeno prostático específico)")
        .eq("id_prestador", idPrestador?.toString())
        .gte("fecha_carga", `${hoy}T00:00:00`)
        .maybeSingle();

      if (!yaExistePsa) {
        const { data: afiliadoPsa } = await supabase
          .from("afiliados")
          .select("nombre, apellido")
          .eq("dni", dni)
          .single();

        await supabase.from("practicas_autorizadas").insert({
          dni,
          nombre_completo: afiliadoPsa
            ? `${afiliadoPsa.apellido} ${afiliadoPsa.nombre}`
            : null,
          descripcion_practica: "PSA (Antígeno prostático específico)",
          estado: "REALIZADA",
          fecha_autorizacion: hoy,
          fecha_carga: new Date().toISOString(),
          id_prestador: idPrestador?.toString(),
          nombre_prestador: nombrePrestador,
        });
      }
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

async function marcarKitEnTableroDia(dni, tipoKit) {
  const campo =
    tipoKit === "HPV" ? "bio_hpv" : tipoKit === "SOMF" ? "bio_somf" : null;
  if (!campo) return;
  const hoy = new Date().toISOString().split("T")[0];
  const { data: registro } = await supabase
    .from("tablero_dia")
    .select("id")
    .eq("dni", dni)
    .gte("fecha", hoy)
    .lte("fecha", hoy)
    .maybeSingle();
  if (registro) {
    await supabase
      .from("tablero_dia")
      .update({ [campo]: true })
      .eq("id", registro.id);
  }
}
app.post("/api/kits/entregar", async (req, res) => {
  const { dni, tipo_kit, entregado_por, rol_entrego } = req.body;
  if (!dni || !tipo_kit) {
    return res.status(400).json({ success: false, message: "Faltan datos." });
  }
  try {
    const { data: existente } = await supabase
      .from("kits_seguimiento")
      .select("id")
      .eq("dni", dni)
      .eq("tipo_kit", tipo_kit)
      .maybeSingle();

    const fechaEntrega = new Date().toISOString();

    if (existente) {
      await supabase
        .from("kits_seguimiento")
        .update({
          entregado: true,
          entregado_por,
          rol_entrego,
          fecha_entrega: fechaEntrega,
        })
        .eq("id", existente.id);
    } else {
      await supabase.from("kits_seguimiento").insert({
        dni,
        tipo_kit,
        entregado: true,
        entregado_por,
        rol_entrego,
        fecha_entrega: fechaEntrega,
      });
    }

    await marcarKitEnTableroDia(dni, tipo_kit);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post("/api/kits/recibir", async (req, res) => {
  const { dni, tipo_kit, recibido_por } = req.body;
  if (!dni || !tipo_kit) {
    return res.status(400).json({ success: false, message: "Faltan datos." });
  }
  try {
    const { data: existente } = await supabase
      .from("kits_seguimiento")
      .select("id")
      .eq("dni", dni)
      .eq("tipo_kit", tipo_kit)
      .maybeSingle();

    if (existente) {
      await supabase
        .from("kits_seguimiento")
        .update({
          recibido: true,
          recibido_por,
          fecha_recepcion: new Date().toISOString(),
        })
        .eq("id", existente.id);
    } else {
      await supabase.from("kits_seguimiento").insert({
        dni,
        tipo_kit,
        recibido: true,
        recibido_por,
        fecha_recepcion: new Date().toISOString(),
      });
    }

    await marcarKitEnTableroDia(dni, tipo_kit); // ← ÚNICA LÍNEA NUEVA

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get("/api/kits/pendientes-alarma", async (req, res) => {
  const limite = new Date();
  limite.setDate(limite.getDate() - 7);
  try {
    const { data, error } = await supabase
      .from("kits_seguimiento")
      .select("dni, tipo_kit, entregado_por, rol_entrego, fecha_entrega")
      .eq("entregado", true)
      .eq("recibido", false)
      .lte("fecha_entrega", limite.toISOString())
      .order("fecha_entrega", { ascending: true });
    if (error) throw error;

    const dnis = [...new Set((data || []).map((k) => k.dni))];
    let nombres = {};
    if (dnis.length) {
      const { data: afiliados } = await supabase
        .from("afiliados")
        .select("dni, nombre, apellido")
        .in("dni", dnis);
      (afiliados || []).forEach((a) => {
        nombres[a.dni] = `${a.apellido} ${a.nombre}`;
      });
    }

    const pendientes = (data || []).map((k) => ({
      ...k,
      nombre_completo: nombres[k.dni] || null,
      dias_pendiente: Math.floor(
        (Date.now() - new Date(k.fecha_entrega).getTime()) / 86400000,
      ),
    }));

    res.json({ success: true, pendientes });
  } catch (e) {
    res.status(500).json({ success: false, pendientes: [] });
  }
});
app.post("/api/kits/deshacer", async (req, res) => {
  const { dni, tipo_kit, accion } = req.body; // accion: "entrega" | "recepcion"
  if (!dni || !tipo_kit || !accion) {
    return res.status(400).json({ success: false, message: "Faltan datos." });
  }
  try {
    const { data: registro } = await supabase
      .from("kits_seguimiento")
      .select("*")
      .eq("dni", dni)
      .eq("tipo_kit", tipo_kit)
      .maybeSingle();

    if (!registro) return res.json({ success: true });

    // Guardamos la fecha REAL de la acción antes de anularla, para buscar
    // la fila correcta de tablero_dia (puede ser de días atrás, no de hoy).
    const fechaAccion =
      accion === "entrega" ? registro.fecha_entrega : registro.fecha_recepcion;

    if (accion === "entrega") {
      if (registro.recibido) {
        return res.status(400).json({
          success: false,
          message:
            "Este kit ya tiene recepción cargada. Borrá primero la recepción.",
        });
      }
      await supabase
        .from("kits_seguimiento")
        .update({
          entregado: false,
          entregado_por: null,
          rol_entrego: null,
          fecha_entrega: null,
        })
        .eq("id", registro.id);
    } else if (accion === "recepcion") {
      await supabase
        .from("kits_seguimiento")
        .update({ recibido: false, recibido_por: null, fecha_recepcion: null })
        .eq("id", registro.id);
    }

    const { data: actualizado } = await supabase
      .from("kits_seguimiento")
      .select("entregado, recibido")
      .eq("id", registro.id)
      .single();

    if (actualizado && !actualizado.entregado && !actualizado.recibido) {
      const campo =
        tipo_kit === "HPV"
          ? "bio_hpv"
          : tipo_kit === "SOMF"
            ? "bio_somf"
            : null;
      if (campo && fechaAccion) {
        const fechaFila = fechaAccion.split("T")[0]; // fecha real de la fila en tablero_dia
        const { data: td } = await supabase
          .from("tablero_dia")
          .select("id")
          .eq("dni", dni)
          .gte("fecha", fechaFila)
          .lte("fecha", fechaFila)
          .maybeSingle();
        if (td)
          await supabase
            .from("tablero_dia")
            .update({ [campo]: false })
            .eq("id", td.id);
      }
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post("/api/bioquimico/deshacer-extraccion", async (req, res) => {
  const { id, dni } = req.body;
  if (!id || !dni) {
    return res.status(400).json({ success: false, message: "Faltan datos." });
  }
  try {
    const { data: fila } = await supabase
      .from("practicas_autorizadas")
      .select("dni, fecha_autorizacion, fecha_carga, descripcion_practica")
      .eq("id", id)
      .maybeSingle();

    if (fila && fila.descripcion_practica === "Práctica bioquímica") {
      // Este evento genera DOS filas gemelas (B040103 + 679900) con el
      // mismo fecha_carga: hay que borrar el par completo, no solo la
      // fila cuyo id llegó desde el frontend, para no dejar huérfana la otra.
      await supabase
        .from("practicas_autorizadas")
        .delete()
        .eq("dni", fila.dni)
        .eq("descripcion_practica", "Práctica bioquímica")
        .eq("fecha_carga", fila.fecha_carga);
    } else {
      await supabase.from("practicas_autorizadas").delete().eq("id", id);
    }

    if (!fila) return res.json({ success: true });

    const fechaFila = fila.fecha_autorizacion.split("T")[0]; // fecha REAL de la práctica, no "hoy"
    const { data: td } = await supabase
      .from("tablero_dia")
      .select("id")
      .eq("dni", dni)
      .gte("fecha", fechaFila)
      .lte("fecha", fechaFila)
      .maybeSingle();

    if (td) {
      const { data: kits } = await supabase
        .from("kits_seguimiento")
        .select("tipo_kit, entregado, recibido")
        .eq("dni", dni)
        .in("tipo_kit", ["HPV", "SOMF"]);

      const tieneKitPropio = (tipo) =>
        (kits || []).some(
          (k) => k.tipo_kit === tipo && (k.entregado || k.recibido),
        );

      const update = {
        bio_paso: false,
        bio_modulo: null,
        bio_psa: false,
        bio_cargado_analisis: false,
      };
      if (!tieneKitPropio("HPV")) update.bio_hpv = false;
      if (!tieneKitPropio("SOMF")) update.bio_somf = false;

      await supabase.from("tablero_dia").update(update).eq("id", td.id);
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── KITS HPV / SOMF (recepción, compartido con enfermería) ──
app.get("/api/kits-estado/:dni", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("kits_seguimiento")
      .select("*")
      .eq("dni", req.params.dni);
    if (error) throw error;
    res.json({ success: true, kits: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post("/api/kits/recibir", async (req, res) => {
  const { dni, tipo_kit, recibido_por } = req.body;
  if (!dni || !tipo_kit) {
    return res.status(400).json({ success: false, message: "Faltan datos." });
  }
  try {
    const { data: existente } = await supabase
      .from("kits_seguimiento")
      .select("id")
      .eq("dni", dni)
      .eq("tipo_kit", tipo_kit)
      .maybeSingle();

    if (existente) {
      await supabase
        .from("kits_seguimiento")
        .update({
          recibido: true,
          recibido_por,
          fecha_recepcion: new Date().toISOString(),
        })
        .eq("id", existente.id);
    } else {
      // Caso raro: recibieron un kit que nunca quedó registrado como entregado.
      // Lo creamos igual, para no perder el dato.
      await supabase.from("kits_seguimiento").insert({
        dni,
        tipo_kit,
        recibido: true,
        recibido_por,
        fecha_recepcion: new Date().toISOString(),
      });
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
const CATALOGO_SEGUIMIENTO_BIO = [
  "antigeno prostatico especifico total - PSA",
  "colesterol total",
  "creatinina",
  "creatinina, formula filtrado glomerular",
  "formula filtrado glomerular",
  "glucemia en ayunas",
  "HDL/colesterol",
  "hemoglobina glicosilada",
  "LDL/colesterol",
  "microalbuminuria",
  "RAC - creatinina orina",
  "RAC - Relación Albúmina/Creatinina",
  "sangre oculta en materia fecal - SOMF",
  "trigliceridos",
];

app.get("/api/bioquimico/seguimiento/:dni", async (req, res) => {
  const { dni } = req.params;
  const hace30dias = new Date();
  hace30dias.setDate(hace30dias.getDate() - 30);

  try {
    const { data } = await supabase
      .from("practicas_autorizadas")
      .select("id, descripcion_practica, fecha_autorizacion")
      .eq("dni", dni)
      .eq("estado", "AUTORIZADA")
      .in("descripcion_practica", CATALOGO_SEGUIMIENTO_BIO)
      .gte("fecha_autorizacion", hace30dias.toISOString().split("T")[0])
      .order("fecha_autorizacion", { ascending: false });

    const ultimaPorDescripcion = {};
    (data || []).forEach((d) => {
      if (!ultimaPorDescripcion[d.descripcion_practica]) {
        ultimaPorDescripcion[d.descripcion_practica] = {
          fecha: d.fecha_autorizacion,
          id: d.id,
        };
      }
    });

    const catalogo = CATALOGO_SEGUIMIENTO_BIO.map((desc) => ({
      descripcion: desc,
      marcada: !!ultimaPorDescripcion[desc],
      fecha: ultimaPorDescripcion[desc]?.fecha || null,
      id: ultimaPorDescripcion[desc]?.id || null,
    }));
    res.json({ catalogo });
  } catch (e) {
    res.status(500).json({ catalogo: [] });
  }
});

app.post("/api/bioquimico/seguimiento/marcar", async (req, res) => {
  const { dni, descripcion } = req.body;
  const hoy = new Date().toISOString().split("T")[0];
  try {
    const { data: afiliado } = await supabase
      .from("afiliados")
      .select("nombre, apellido")
      .eq("dni", dni)
      .single();

    await supabase.from("practicas_autorizadas").insert({
      dni,
      nombre_completo: afiliado
        ? `${afiliado.apellido} ${afiliado.nombre}`
        : null,
      descripcion_practica: descripcion,
      estado: "AUTORIZADA",
      fecha_autorizacion: hoy,
      observaciones: "Indicado por bioquímico - seguimiento",
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
app.patch("/api/indicacion-practica/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("practicas_autorizadas")
      .update(req.body)
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false });
  }
});
app.get("/api/bioquimico/ultima-extraccion/:dni", async (req, res) => {
  const { dni } = req.params;
  const hace30dias = new Date();
  hace30dias.setDate(hace30dias.getDate() - 30);

  try {
    const { data } = await supabase
      .from("practicas_autorizadas")
      .select("id, fecha_carga, nombre_prestador")
      .eq("dni", dni)
      .eq("descripcion_practica", "Práctica bioquímica")
      .gte("fecha_carga", hace30dias.toISOString())
      .order("fecha_carga", { ascending: false })
      .limit(1)
      .maybeSingle();

    res.json({ ultima: data || null });
  } catch (e) {
    res.status(500).json({ ultima: null });
  }
});
app.listen(PORT, () =>
  console.log(`Portal Prestadores corriendo en http://localhost:${PORT}`),
);