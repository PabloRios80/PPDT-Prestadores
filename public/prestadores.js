let practicaActual = null;
let prestadorActual = null;
let facturacionData = [];

const PRACTICAS_LAB_DISPONIBLES = [
  "glucemia en ayunas",
  "colesterol total",
  "HDL/colesterol",
  "LDL/colesterol",
  "trigliceridos",
  "creatinina",
  "formula filtrado glomerular",
  "hemoglobina glicosilada",
  "microalbuminuria",
  "RAC - creatinina orina",
  "RAC - Relación Albúmina/Creatinina",
  "anticuerpos anti_VIH",
  "hepatitis b antigeno de superficie_AGHB",
  "hepatitis b anti core",
  "hepatitis c _HCV_AC_IGG",
  "VDRL",
  "sifilis prueba treponemica ECLIA",
  "test chagas HAI",
  "test chagas ECLIA",
  "test HPV genotipo 16",
  "test HPV genotipo 18",
  "test HPV otros genotipos alto riesgo",
  "antigeno prostatico especifico total - PSA",
  "sangre oculta en materia fecal - SOMF",
];

// ==========================================
// LOGIN
// ==========================================
async function hacerLogin() {
  const usuario = document.getElementById("loginUsuario").value.trim();
  const password = document.getElementById("loginPassword").value.trim();
  const errorDiv = document.getElementById("loginError");

  if (!usuario || !password) {
    errorDiv.textContent = "Ingrese usuario y contraseña.";
    errorDiv.classList.remove("hidden");
    return;
  }

  try {
    const response = await fetch("/loginPrestador", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario, password }),
    });
    const data = await response.json();

    if (data.success) {
      prestadorActual = data.prestador;
      sessionStorage.setItem("prestador", JSON.stringify(prestadorActual));
      mostrarPortal();
    } else {
      errorDiv.textContent =
        data.message || "Usuario o contraseña incorrectos.";
      errorDiv.classList.remove("hidden");
    }
  } catch (e) {
    errorDiv.textContent = "Error de conexión. Intentá de nuevo.";
    errorDiv.classList.remove("hidden");
  }
}

function mostrarPortal() {
  document.getElementById("pantallaLogin").classList.add("hidden");
  document.getElementById("portalPrincipal").classList.remove("hidden");
  document.getElementById("headerNombre").textContent = prestadorActual.nombre;
  document.getElementById("headerAcciones").classList.remove("hidden");
  document.getElementById("headerEspecialidad").textContent =
    prestadorActual.especialidad +
    (prestadorActual.ciudad ? " — " + prestadorActual.ciudad : "");
}

function cerrarSesion() {
  sessionStorage.removeItem("prestador");
  sessionStorage.removeItem("modoPreventivista");
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  if (token) {
    fetch("https://acceso.diapreventivoiapos.com/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => {});
  }
  window.location.href =
    "https://acceso.diapreventivoiapos.com/login.html?redirect=prestadores";
}

// ==========================================
// BUSCAR PRÁCTICAS
// ==========================================
async function buscarPracticas() {
  const dni = document.getElementById("dniSearch").value.trim();
  const lista = document.getElementById("listaPracticas");
  const loading = document.getElementById("loading");
  const infoAfiliado = document.getElementById("infoAfiliado");

  if (!dni) return alert("Ingrese un DNI");
  if (!prestadorActual) return alert("Sesión expirada. Ingrese nuevamente.");

  lista.innerHTML = "";
  infoAfiliado.classList.add("hidden");
  loading.classList.remove("hidden");

  try {
    const iaposRes = await fetch(`/verificar-afiliado/${dni}`);
    const iaposData = await iaposRes.json();

    if (!iaposData.esActivo) {
      loading.classList.add("hidden");
      lista.innerHTML = `
        <div class="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <i class="fas fa-times-circle text-red-500 text-2xl mb-2"></i>
          <p class="font-bold text-red-700">DNI no corresponde a un afiliado activo de IAPOS.</p>
          <p class="text-sm text-red-500 mt-1">Verificá el número ingresado.</p>
        </div>`;
      return;
    }

    document.getElementById("nombreAfiliado").textContent =
      "👤 " + (iaposData.nombre || "DNI: " + dni);
    document.getElementById("especialidadVista").textContent =
      "Prácticas de " + prestadorActual.especialidad;
    infoAfiliado.classList.remove("hidden");
  } catch (e) {
    console.warn("No se pudo verificar IAPOS, continuando...", e.message);
  }

  try {
    const response = await fetch(
      `/getPracticasPrestador/${dni}/${encodeURIComponent(prestadorActual.especialidad)}`,
    );
    const data = await response.json();
    loading.classList.add("hidden");

    if (data.success && data.practicas.length > 0) {
      const modoCarga = document.getElementById("modoCargaLab");
      if (prestadorActual.especialidad === "Laboratorio Bioquimico") {
        modoCarga.classList.remove("hidden");
      } else {
        modoCarga.classList.add("hidden");
      }

      const pendientes = data.practicas.filter(
        (p) => (p.estado || "").toUpperCase() === "AUTORIZADA",
      );
      const realizadas = data.practicas.filter(
        (p) => (p.estado || "").toUpperCase() === "REALIZADA",
      );

      if (pendientes.length > 0) {
        const tituloPendientes = document.createElement("h3");
        tituloPendientes.className =
          "font-bold text-gray-600 text-sm uppercase tracking-wide mt-2 mb-2";
        tituloPendientes.innerHTML = `<i class="fas fa-clock text-blue-500 mr-1"></i> Pendientes de carga (${pendientes.length})`;
        lista.appendChild(tituloPendientes);

        pendientes.forEach((p) => {
          const div = document.createElement("div");
          div.className =
            "bg-white p-4 rounded-lg shadow border-l-4 border-blue-600 flex justify-between items-center";

          const info = document.createElement("div");
          info.innerHTML = `
            <p class="font-bold text-gray-800">${p.descripcion_practica}</p>
            <p class="text-xs text-gray-400">Cód: ${p.codigo_prestacion || "S/C"}</p>`;

          const btn = document.createElement("button");
          btn.className =
            "bg-blue-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-blue-700";
          btn.textContent = "CARGAR";
          btn.addEventListener("click", function () {
            abrirModal(p.codigo_prestacion, p.descripcion_practica);
          });

          div.appendChild(info);
          div.appendChild(btn);
          lista.appendChild(div);
        });
      }

      if (realizadas.length > 0) {
        const tituloRealizadas = document.createElement("h3");
        tituloRealizadas.className =
          "font-bold text-gray-600 text-sm uppercase tracking-wide mt-4 mb-2";
        tituloRealizadas.innerHTML = `<i class="fas fa-check-circle text-green-500 mr-1"></i> Ya cargadas (${realizadas.length})`;
        lista.appendChild(tituloRealizadas);

        realizadas.forEach((p) => {
          const div = document.createElement("div");
          div.className =
            "bg-gray-50 p-4 rounded-lg border border-gray-200 border-l-4 border-l-green-500 flex justify-between items-center opacity-75";

          const infoTexto = document.createElement("div");
          infoTexto.innerHTML = `
            <p class="font-bold text-gray-600">${p.descripcion_practica}</p>
            <p class="text-xs text-gray-400">
              Cargada: ${p.fecha_carga ? new Date(p.fecha_carga).toLocaleDateString("es-AR") : "S/F"}
            </p>`;
          div.appendChild(infoTexto);

          const derecha = document.createElement("div");
          derecha.className = "flex items-center gap-2";

          if (p.enlace_pdf) {
            const btnVer = document.createElement("a");
            btnVer.href = p.enlace_pdf;
            btnVer.target = "_blank";
            btnVer.rel = "noopener noreferrer";
            btnVer.className =
              "bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-sm font-bold hover:bg-blue-200";
            btnVer.innerHTML = '<i class="fas fa-file-pdf mr-1"></i> Ver PDF';
            derecha.appendChild(btnVer);
          }

          const badge = document.createElement("span");
          badge.className =
            "bg-green-100 text-green-700 px-3 py-1 rounded-full text-sm font-bold";
          badge.innerHTML = "✓ REALIZADA";
          derecha.appendChild(badge);

          div.appendChild(derecha);
          lista.appendChild(div);
        });
      }
      const badge = document.createElement("span");
      // ── BOTÓN AGREGAR PRÁCTICA — siempre visible para laboratorio ──
      if (prestadorActual.especialidad === "Laboratorio Bioquimico") {
        const btnAgregar = document.createElement("button");
        btnAgregar.className =
          "mt-4 bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-purple-700 w-full";
        btnAgregar.innerHTML =
          '<i class="fas fa-plus mr-1"></i> Agregar práctica no autorizada';
        btnAgregar.addEventListener("click", abrirSelectorPractica);
        lista.appendChild(btnAgregar);
      }
    } else {
      loading.classList.add("hidden");

      if (prestadorActual.especialidad === "Biopsias") {
        lista.innerHTML = "";
        const div = document.createElement("div");
        div.className =
          "bg-white p-4 rounded-lg shadow border-l-4 border-purple-600 flex justify-between items-center";
        div.innerHTML = `
          <div>
            <p class="font-bold text-gray-800">Informe de Biopsia / Anatomía Patológica</p>
            <p class="text-xs text-gray-400">No requiere autorización previa — cargá el resultado directamente.</p>
          </div>`;
        const btn = document.createElement("button");
        btn.className =
          "bg-purple-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-purple-700";
        btn.textContent = "CARGAR BIOPSIA";
        btn.addEventListener("click", function () {
          abrirModal(null, "Biopsia");
        });
        div.appendChild(btn);
        lista.appendChild(div);
        return;
      }

      loading.classList.remove("hidden");
      lista.innerHTML = "";
      try {
        await fetch(`/getPreventivePlan/${dni}`);
        const response2 = await fetch(
          `/getPracticasPrestador/${dni}/${encodeURIComponent(prestadorActual.especialidad)}`,
        );
        const data2 = await response2.json();
        loading.classList.add("hidden");

        if (data2.success && data2.practicas.length > 0) {
          buscarPracticas();
        } else {
          const msg = document.createElement("div");
          msg.className =
            "bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center";
          msg.innerHTML = `
            <i class="fas fa-info-circle text-yellow-500 text-2xl mb-2"></i>
            <p class="text-gray-600">No hay prácticas autorizadas por el algoritmo para este afiliado
            en la especialidad <strong>${prestadorActual.especialidad}</strong>.</p>
            <p class="text-sm text-gray-400 mt-2">Podés cargar igual usando el botón de abajo.</p>`;
          lista.appendChild(msg);

          if (prestadorActual.especialidad === "Laboratorio Bioquimico") {
            const btnLab = document.createElement("button");
            btnLab.className =
              "mt-4 bg-blue-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-blue-700 w-full";
            btnLab.innerHTML =
              '<i class="fas fa-flask mr-2"></i> Cargar resultados de laboratorio';
            btnLab.addEventListener("click", function () {
              modoCargaPDF();
            });
            lista.appendChild(btnLab);

            const btnAgregarExtra = document.createElement("button");
            btnAgregarExtra.className =
              "mt-2 bg-purple-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-purple-700 w-full";
            btnAgregarExtra.innerHTML =
              '<i class="fas fa-plus mr-2"></i> Agregar práctica manualmente';
            btnAgregarExtra.addEventListener("click", abrirSelectorPractica);
            lista.appendChild(btnAgregarExtra);
          }
        }
      } catch (e) {
        loading.classList.add("hidden");
        alert("Error al generar prácticas.");
      }
    }
  } catch (e) {
    loading.classList.add("hidden");
    alert("Error al conectar con el servidor.");
  }
}

// ==========================================
// MODAL CARGA INDIVIDUAL
// ==========================================
function abrirModal(codigo, descripcion) {
  practicaActual = { codigo, descripcion };
  document.getElementById("modalTitulo").textContent = descripcion;
  document.getElementById("resultadoValor").value = "";
  document.getElementById("archivoPdf").value = "";
  const linkInput = document.getElementById("linkDrivePractica");
  if (linkInput) linkInput.value = "";
  document.getElementById("modalCarga").classList.remove("hidden");
}

function cerrarModal() {
  document.getElementById("modalCarga").classList.add("hidden");
  document.getElementById("resultadoValor").value = "";
  document.getElementById("archivoPdf").value = "";
  const linkInput = document.getElementById("linkDrivePractica");
  if (linkInput) linkInput.value = "";
}

// ==========================================
// SELECTOR DE PRÁCTICA MANUAL
// ==========================================
function abrirSelectorPractica() {
  const lista = document.getElementById("listaPracticas");

  const existing = document.getElementById("selectorPracticaManual");
  if (existing) existing.remove();

  const div = document.createElement("div");
  div.id = "selectorPracticaManual";
  div.className =
    "bg-white p-4 rounded-lg shadow border-l-4 border-purple-600 mt-4";
  div.innerHTML = `
    <p class="font-bold text-gray-700 mb-2">
      <i class="fas fa-plus-circle text-purple-600 mr-1"></i> Seleccioná una práctica para cargar:
    </p>
    <select id="practicaManualSelect" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3">
      <option value="">-- Seleccionar práctica --</option>
      ${PRACTICAS_LAB_DISPONIBLES.map((p) => `<option value="${p}">${p}</option>`).join("")}
    </select>
    <div class="flex gap-2">
      <button onclick="confirmarPracticaManual()"
        class="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-purple-700">
        Cargar esta práctica
      </button>
      <button onclick="document.getElementById('selectorPracticaManual').remove()"
        class="bg-gray-400 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-gray-500">
        Cancelar
      </button>
    </div>`;
  lista.appendChild(div);
}

function confirmarPracticaManual() {
  const select = document.getElementById("practicaManualSelect");
  const descripcion = select.value;
  if (!descripcion) return alert("Seleccioná una práctica.");
  document.getElementById("selectorPracticaManual").remove();
  abrirModal(null, descripcion);
}

async function guardarPractica() {
  const valor = document.getElementById("resultadoValor").value.trim();
  const inputArchivo = document.getElementById("archivoPdf");
  const linkDrive = document.getElementById("linkDrivePractica")?.value.trim();
  const dni = document.getElementById("dniSearch").value.trim();

  const hayArchivo = inputArchivo.files && inputArchivo.files.length > 0;

  if (!valor && !hayArchivo && !linkDrive)
    return alert("Ingrese un resultado o adjunte un PDF.");

  // Verificar si ya fue cargada
  try {
    const resCheck = await fetch("/verificarPracticasDuplicadas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dni: dni,
        practicas: [{ descripcion: practicaActual.descripcion }],
      }),
    });
    const checkData = await resCheck.json();
    if (checkData.duplicadas && checkData.duplicadas.length > 0) {
      const confirmar = confirm(
        `⚠️ La práctica "${practicaActual.descripcion}" ya fue cargada para este afiliado. ¿Querés cargarla de nuevo y pisar el resultado anterior?`,
      );
      if (!confirmar) return;
    }
  } catch (e) {
    console.warn("No se pudo verificar duplicados:", e.message);
  }

  let archivoBase64 = null;
  if (hayArchivo) {
    try {
      archivoBase64 = await toBase64(inputArchivo.files[0]);
    } catch (e) {
      alert("Error al procesar el PDF.");
      return;
    }
  } else if (linkDrive) {
    try {
      const resp = await fetch("/descargarPDFDesdeLink", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link: linkDrive }),
      });
      const data = await resp.json();
      if (!data.success) {
        alert("Error al descargar el PDF del link: " + data.message);
        return;
      }
      archivoBase64 = data.archivoBase64;
    } catch (e) {
      alert("Error al descargar el PDF del link.");
      return;
    }
  }

  const payload = {
    dni: dni,
    codigo: practicaActual.codigo,
    descripcion: practicaActual.descripcion,
    resultadoValor: valor,
    archivoBase64: archivoBase64,
    archivoNombre: `Resultado_${dni}_${practicaActual.descripcion}.pdf`,
    idPrestador: prestadorActual.id,
    nombrePrestador: prestadorActual.nombre,
  };
  // Verificar si ya fue cargada
  try {
    const resCheck = await fetch("/verificarPracticasDuplicadas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dni: dni,
        practicas: [{ descripcion: practicaActual.descripcion }],
      }),
    });
    const checkData = await resCheck.json();
    if (checkData.duplicadas && checkData.duplicadas.length > 0) {
      const confirmar = confirm(
        `⚠️ La práctica "${practicaActual.descripcion}" ya fue cargada para este afiliado. ¿Querés cargarla de nuevo y pisar el resultado anterior?`,
      );
      if (!confirmar) return;
    }
  } catch (e) {
    console.warn("No se pudo verificar duplicados:", e.message);
  }
  try {
    const response = await fetch("/savePracticeResult", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const res = await response.json();
    if (res.success) {
      alert("✅ Cargado correctamente.");
      cerrarModal();
      buscarPracticas();
    } else {
      alert("Error: " + res.message);
    }
  } catch (e) {
    alert("Error al guardar.");
  }
}

// ==========================================
// FACTURACIÓN
// ==========================================
function verFacturacion() {
  const hoy = new Date();
  document.getElementById("mesFact").value = hoy.getMonth() + 1;
  document.getElementById("anioFact").value = hoy.getFullYear();
  document.getElementById("tablaFacturacion").innerHTML = "";
  document.getElementById("btnDescargarExcel").classList.add("hidden");
  document.getElementById("modalFacturacion").classList.remove("hidden");
  facturacionData = [];
}

function cerrarModalFacturacion() {
  document.getElementById("modalFacturacion").classList.add("hidden");
}

async function generarFacturacion() {
  const mes = document.getElementById("mesFact").value;
  const anio = document.getElementById("anioFact").value;
  const tablaDiv = document.getElementById("tablaFacturacion");

  tablaDiv.innerHTML =
    '<p class="text-center text-gray-500 py-4"><i class="fas fa-spinner fa-spin mr-2"></i>Cargando...</p>';

  try {
    const response = await fetch(
      `/getFacturacion/${prestadorActual.id}/${mes}/${anio}`,
    );
    const data = await response.json();

    if (data.success && data.practicas.length > 0) {
      facturacionData = data.practicas.map((p, i) => ({
        ...p,
        _incluir: true,
        _index: i,
      }));
      renderTablaFacturacion();
    } else {
      tablaDiv.innerHTML = `<p class="text-center text-gray-500 py-4">No hay prácticas realizadas pendientes de facturación en ese período.</p>`;
      document.getElementById("btnDescargarExcel").classList.add("hidden");
    }
  } catch (e) {
    tablaDiv.innerHTML =
      '<p class="text-red-500 text-center">Error al cargar datos.</p>';
  }
}

function renderTablaFacturacion() {
  const tablaDiv = document.getElementById("tablaFacturacion");
  const incluidas = facturacionData.filter((p) => p._incluir);

  if (incluidas.length === 0) {
    tablaDiv.innerHTML =
      '<p class="text-center text-gray-500 py-4">No quedan prácticas para facturar.</p>';
    document.getElementById("btnDescargarExcel").classList.add("hidden");
    return;
  }

  tablaDiv.innerHTML = `
    <p class="text-sm text-gray-500 mb-3 italic">
      <i class="fas fa-info-circle mr-1"></i>
      Podés quitar prácticas que no vas a facturar este mes haciendo click en 
      <span class="text-red-500 font-bold">✕</span>
    </p>`;

  const tabla = document.createElement("table");
  tabla.className = "w-full text-sm border-collapse";
  tabla.innerHTML = `
    <thead>
      <tr class="bg-blue-900 text-white">
        <th class="p-2 text-left">Fecha</th>
        <th class="p-2 text-left">DNI</th>
        <th class="p-2 text-left">Afiliado</th>
        <th class="p-2 text-left">Práctica</th>
        <th class="p-2 text-left">Código</th>
        <th class="p-2 text-center">Quitar</th>
      </tr>
    </thead>`;

  const tbody = document.createElement("tbody");

  incluidas.forEach((p) => {
    const fecha = p.fecha_carga
      ? new Date(p.fecha_carga).toLocaleDateString("es-AR")
      : "S/F";
    const tr = document.createElement("tr");
    tr.className = "border-b hover:bg-gray-50";
    tr.innerHTML = `
      <td class="p-2">${fecha}</td>
      <td class="p-2">${p.dni || ""}</td>
      <td class="p-2">${p.nombre_completo || ""}</td>
      <td class="p-2">${p.descripcion_practica || ""}</td>
      <td class="p-2">${p.codigo_prestacion || "S/C"}</td>
      <td class="p-2 text-center"></td>`;

    const btnQuitar = document.createElement("button");
    btnQuitar.className =
      "text-red-500 hover:text-red-700 font-bold text-lg leading-none";
    btnQuitar.textContent = "✕";
    btnQuitar.addEventListener("click", function () {
      quitarDeFacturacion(p._index);
    });
    tr.lastElementChild.appendChild(btnQuitar);
    tbody.appendChild(tr);
  });

  tabla.appendChild(tbody);
  tablaDiv.appendChild(tabla);

  const total = document.createElement("p");
  total.className = "text-right font-bold text-gray-700 mt-3";
  total.innerHTML = `Total a facturar: <span class="text-blue-900">${incluidas.length} prácticas</span>`;
  tablaDiv.appendChild(total);

  document.getElementById("btnDescargarExcel").classList.remove("hidden");
}

function quitarDeFacturacion(index) {
  facturacionData[index]._incluir = false;
  renderTablaFacturacion();
}

async function descargarExcel() {
  const incluidas = facturacionData.filter((p) => p._incluir);
  if (!incluidas.length) return alert("No hay prácticas para facturar.");

  const mes = document.getElementById("mesFact").value;
  const anio = document.getElementById("anioFact").value;

  const headers = [
    "Fecha",
    "DNI Afiliado",
    "Afiliado",
    "Práctica",
    "Código",
    "Prestador",
  ];
  const filas = incluidas.map((p) => [
    p.fecha_carga ? new Date(p.fecha_carga).toLocaleDateString("es-AR") : "",
    p.dni || "",
    p.nombre_completo || "",
    p.descripcion_practica || "",
    p.codigo_prestacion || "",
    prestadorActual.nombre,
  ]);

  const csvContent = [headers, ...filas]
    .map((fila) => fila.map((celda) => `"${celda}"`).join(","))
    .join("\n");

  const blob = new Blob(["\uFEFF" + csvContent], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Facturacion_${prestadorActual.nombre}_${mes}_${anio}.csv`;
  link.click();
  URL.revokeObjectURL(url);

  try {
    const practicasAMarcar = incluidas.map((p) => ({
      dni: p.dni,
      descripcion: p.descripcion_practica,
    }));
    await fetch("/marcarFacturadas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idPrestador: prestadorActual.id,
        practicas: practicasAMarcar,
      }),
    });
    alert(
      `✅ Planilla descargada. ${incluidas.length} prácticas marcadas como FACTURADAS.`,
    );
    cerrarModalFacturacion();
  } catch (e) {
    alert(
      "La planilla se descargó pero hubo un error al actualizar el estado.",
    );
  }
}

// ==========================================
// SEMÁFORO DE VALORES
// ==========================================
function evaluarSemaforo(campo, valor, datosAfiliado) {
  if (!valor) return null;

  const v = valor.toString().trim();
  const vUpper = v.toUpperCase();
  const vNum = parseFloat(v.replace(",", "."));
  const edad = datosAfiliado ? parseInt(datosAfiliado.edad) || 0 : 0;
  const sexo = datosAfiliado
    ? (datosAfiliado.sexo_biologico || "").toLowerCase()
    : "";

  const VERDE = {
    color: "#16a34a",
    bg: "#dcfce7",
    icono: "🟢",
    texto: "Normal",
  };
  const AMARILLO = {
    color: "#d97706",
    bg: "#fef3c7",
    icono: "🟡",
    texto: "Límite",
  };
  const ROJO = {
    color: "#dc2626",
    bg: "#fee2e2",
    icono: "🔴",
    texto: "Alterado",
  };

  if (campo === "glucemia") {
    if (isNaN(vNum)) return null;
    const glucVal = vUpper.includes("MG") ? vNum / 1000 : vNum;
    if (glucVal <= 1.0) return VERDE;
    if (glucVal <= 1.25) return AMARILLO;
    return ROJO;
  }
  if (campo === "colesterol_total") {
    if (isNaN(vNum)) return null;
    if (vNum < 200) return VERDE;
    if (vNum < 240) return AMARILLO;
    return ROJO;
  }
  if (campo === "colesterol_hdl") {
    if (isNaN(vNum)) return null;
    const hdlMin = sexo.includes("fem") ? 50 : 40;
    const hdlLimite = sexo.includes("fem") ? 40 : 35;
    if (vNum >= hdlMin) return VERDE;
    if (vNum >= hdlLimite) return AMARILLO;
    return ROJO;
  }
  if (campo === "colesterol_ldl") {
    if (isNaN(vNum)) return null;
    if (vNum < 130) return VERDE;
    if (vNum < 160) return AMARILLO;
    return ROJO;
  }
  if (campo === "trigliceridos") {
    if (isNaN(vNum)) return null;
    if (vNum < 150) return VERDE;
    if (vNum < 200) return AMARILLO;
    return ROJO;
  }
  if (campo === "creatinina") {
    if (isNaN(vNum)) return null;
    const creatMax = sexo.includes("fem") ? 0.9 : 1.2;
    const creatLimite = sexo.includes("fem") ? 1.2 : 1.5;
    if (vNum <= creatMax) return VERDE;
    if (vNum <= creatLimite) return AMARILLO;
    return ROJO;
  }
  if (campo === "indice_filtrado_glomerular") {
    if (isNaN(vNum)) return null;
    if (vNum >= 90) return VERDE;
    if (vNum >= 60 && vNum < 70) return AMARILLO;
    if (vNum >= 70) return VERDE;
    return ROJO;
  }
  if (campo === "psa") {
    if (isNaN(vNum)) return null;
    let psaNormal, psaLimite;
    if (edad <= 50) {
      psaNormal = 2.0;
      psaLimite = 3.0;
    } else if (edad <= 60) {
      psaNormal = 3.0;
      psaLimite = 4.0;
    } else if (edad <= 70) {
      psaNormal = 4.0;
      psaLimite = 5.0;
    } else {
      psaNormal = 4.5;
      psaLimite = 6.0;
    }
    if (vNum <= psaNormal) return VERDE;
    if (vNum <= psaLimite) return AMARILLO;
    return ROJO;
  }
  if (campo === "hemoglobina_glicosilada") {
    if (isNaN(vNum)) return null;
    if (vNum < 5.7) return VERDE;
    if (vNum < 6.5) return AMARILLO;
    return ROJO;
  }
  if (
    [
      "hiv",
      "hepatitis_b_antigeno_superficie",
      "hepatitis_b_anti_core",
      "hepatitis_c",
      "somf",
      "vdrl",
      "chagas_hai",
      "chagas_eclia",
    ].includes(campo)
  ) {
    if (vUpper === "NEGATIVO" || vUpper === "NO REACTIVO") return VERDE;
    if (vUpper === "POSITIVO" || vUpper === "REACTIVO") return ROJO;
    return null;
  }
  if (campo === "sifilis_treponemica") {
    if (vUpper === "POSITIVO" || vUpper === "REACTIVO") return ROJO;
    if (vUpper === "NEGATIVO" || vUpper === "NO REACTIVO") return VERDE;
    return null;
  }
  if (campo === "hpv_genotipo_16" || campo === "hpv_genotipo_18") {
    if (vUpper.includes("NO DETECTABLE")) return VERDE;
    if (vUpper.includes("DETECTABLE")) return ROJO;
    return null;
  }
  if (campo === "hpv_otros") {
    if (vUpper.includes("NO DETECTABLE")) return VERDE;
    if (vUpper.includes("DETECTABLE"))
      return {
        color: "#dc2626",
        bg: "#fee2e2",
        icono: "🔴",
        texto: "Otros genotipos de alto riesgo",
      };
    return null;
  }
  return null;
}

// ==========================================
// CARGA PDF LABORATORIO - VERSIÓN CON IA (Claude)
// ==========================================
function modoCargaIndividual() {
  document.getElementById("modoCargaLab").classList.add("hidden");
}

function modoCargaPDF() {
  document.getElementById("pdfResultado").classList.add("hidden");
  document.getElementById("pdfResultado").innerHTML = "";
  document.getElementById("contenedorInformes").innerHTML = "";
  agregarInforme();
  document.getElementById("modalPDFLab").classList.remove("hidden");
}

function cerrarModalPDFLab() {
  document.getElementById("modalPDFLab").classList.add("hidden");
  document.getElementById("contenedorInformes").innerHTML = "";
  document.getElementById("pdfResultado").classList.add("hidden");
}

function agregarInforme() {
  const contenedor = document.getElementById("contenedorInformes");
  const index = contenedor.children.length + 1;
  const div = document.createElement("div");
  div.className = "relative border border-gray-200 rounded-lg p-3";
  div.innerHTML = `
    <div class="flex justify-between items-center mb-2">
      <label class="text-sm font-bold text-gray-600">
        <i class="fas fa-file-pdf text-red-500 mr-1"></i>Informe ${index}
      </label>
      ${
        index > 1
          ? `<button onclick="this.closest('div.relative').remove()"
          class="text-red-400 hover:text-red-600 text-xs">
          <i class="fas fa-times"></i> Quitar
        </button>`
          : ""
      }
    </div>
    <input type="file" accept="application/pdf"
           class="archivoPDFItem w-full border border-gray-300 rounded-lg p-2
                  text-sm file:mr-3 file:py-1 file:px-3 file:rounded-md
                  file:border-0 file:bg-blue-50 file:text-blue-700
                  hover:file:bg-blue-100">
    <div class="flex items-center gap-2 my-2">
      <div class="flex-grow border-t border-gray-200"></div>
      <span class="text-xs text-gray-400 font-bold">O</span>
      <div class="flex-grow border-t border-gray-200"></div>
    </div>
    <input type="text"
           class="linkDriveItem w-full border border-gray-300 rounded-lg p-2 text-sm
                  outline-none focus:ring-2 focus:ring-blue-500"
           placeholder="Pegá el link de Google Drive del PDF (debe estar compartido como 'Cualquiera con el enlace')">
    <p class="text-xs text-gray-400 mt-1">Subí el PDF, o pegá el link de Drive si el informe ya está guardado ahí.</p>`;
  contenedor.appendChild(div);
}

async function procesarTodosLosInformes() {
  const bloquesInforme = document.querySelectorAll("#contenedorInformes > div");
  const dni = document.getElementById("dniSearch").value.trim();
  const resultadoDiv = document.getElementById("pdfResultado");

  if (!dni) return alert("Ingresá el DNI del paciente primero.");

  const entradas = [];
  bloquesInforme.forEach((bloque) => {
    const inputArchivo = bloque.querySelector(".archivoPDFItem");
    const inputLink = bloque.querySelector(".linkDriveItem");
    const archivo = inputArchivo && inputArchivo.files && inputArchivo.files[0];
    const link = inputLink && inputLink.value.trim();
    if (archivo) entradas.push({ tipo: "archivo", archivo });
    else if (link) entradas.push({ tipo: "link", link });
  });

  if (entradas.length === 0)
    return alert("Subí al menos un PDF o pegá un link de Drive.");

  resultadoDiv.classList.remove("hidden");
  resultadoDiv.innerHTML = `
    <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
      <i class="fas fa-spinner fa-spin text-blue-600 text-2xl mb-2"></i>
      <p class="text-blue-700">Leyendo informe${entradas.length > 1 ? "s" : ""} con IA, puede tardar unos segundos...</p>
    </div>`;

  try {
    const resultados = [];
    for (const entrada of entradas) {
      let data;
      if (entrada.tipo === "archivo") {
        const base64 = await toBase64(entrada.archivo);
        const response = await fetch("/leerLaboratorioPDF", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archivoBase64: base64 }),
        });
        data = await response.json();
        if (!data.success)
          throw new Error(data.message || "Error leyendo el PDF.");
        resultados.push({
          valores: data.valores,
          base64,
          nombre: entrada.archivo.name,
        });
      } else {
        const response = await fetch("/leerLaboratorioPDFDesdeLink", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ link: entrada.link }),
        });
        data = await response.json();
        if (!data.success)
          throw new Error(
            data.message || "Error leyendo el PDF desde el link.",
          );
        resultados.push({
          valores: data.valores,
          base64: data.archivoBase64,
          nombre: "informe_drive.pdf",
        });
      }
    }

    const dnisDiferentes = [];
    resultados.forEach((r, i) => {
      const dniDetectado = r.valores.dni_paciente;
      if (
        dniDetectado &&
        dniDetectado.replace(/\D/g, "") !== dni.replace(/\D/g, "")
      ) {
        dnisDiferentes.push({ informe: i + 1, dniDetectado });
      }
    });

    if (dnisDiferentes.length > 0) {
      const mensajes = dnisDiferentes
        .map((d) => `Informe ${d.informe}: DNI ${d.dniDetectado}`)
        .join("\n");
      const confirmar = confirm(
        `⚠️ ATENCIÓN: Se detectaron informes con DNI diferente al paciente buscado (${dni}):\n\n` +
          `${mensajes}\n\n¿Querés continuar igualmente cargando todo para el DNI ${dni}?`,
      );
      if (!confirmar) {
        resultadoDiv.classList.add("hidden");
        return;
      }
    }

    let valoresCombinados = {};
    resultados.forEach((r) => {
      Object.entries(r.valores).forEach(([campo, valor]) => {
        if (campo === "dni_paciente") return;
        if (valor && !valoresCombinados[campo])
          valoresCombinados[campo] = valor;
      });
    });

    const valoresConDatos = Object.entries(valoresCombinados).filter(
      ([k, v]) => v,
    );
    if (valoresConDatos.length === 0) {
      resultadoDiv.innerHTML = `
        <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
          <p class="text-yellow-700">No se encontraron valores en el/los informe(s). Verificá que sean los PDFs correctos.</p>
        </div>`;
      return;
    }

    window._archivosPDFLab = resultados.map((r) => ({
      base64: r.base64,
      nombre: r.nombre,
    }));

    mostrarValoresExtraidos({
      dni,
      nombre: "",
      apellido: "",
      valores: valoresCombinados,
    });
  } catch (e) {
    resultadoDiv.innerHTML = `
      <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
        <p class="text-red-600">Error: ${e.message}</p>
      </div>`;
  }
}

// ==========================================
// MOSTRAR VALORES CON SEMÁFORO
// ==========================================
function mostrarValoresExtraidos(data) {
  const resultadoDiv = document.getElementById("pdfResultado");

  const ETIQUETAS = {
    glucemia: "Glucemia",
    creatinina: "Creatinina",
    indice_filtrado_glomerular: "Índice Filtrado Glomerular",
    colesterol_total: "Colesterol Total",
    colesterol_hdl: "Colesterol HDL",
    colesterol_ldl: "Colesterol LDL",
    trigliceridos: "Triglicéridos",
    hiv: "HIV",
    hepatitis_b_antigeno_superficie: "Hepatitis B Ag Superficie",
    hepatitis_b_anti_core: "Hepatitis B Anti Core",
    hepatitis_c: "Hepatitis C",
    vdrl: "VDRL",
    sifilis_treponemica: "Sífilis - Prueba Treponémica",
    psa: "PSA",
    chagas_hai: "Chagas HAI",
    chagas_eclia: "Chagas ECLIA",
    hpv_genotipo_16: "HPV Genotipo 16",
    hpv_genotipo_18: "HPV Genotipo 18",
    hpv_otros: "HPV Otros Genotipos Alto Riesgo",
    hemoglobina_glicosilada: "Hemoglobina Glicosilada",
    microalbuminuria: "Microalbuminuria",
    proteinuria: "Proteinuria",
    clearence_creatinina: "Clearence Creatinina",
    somf: "SOMF",
    creatinina_orina_espontanea: "Creatinina Orina Espontánea",
    rac_albumina_creatinina: "RAC - Relación Albúmina/Creatinina",
  };

  const MAPEO_PRACTICAS = {
    glucemia: "glucemia en ayunas",
    creatinina: "creatinina",
    indice_filtrado_glomerular: "formula filtrado glomerular",
    colesterol_total: "colesterol total",
    colesterol_hdl: "HDL/colesterol",
    colesterol_ldl: "LDL/colesterol",
    trigliceridos: "trigliceridos",
    hiv: "anticuerpos anti_VIH",
    hepatitis_b_antigeno_superficie: "hepatitis b antigeno de superficie_AGHB",
    hepatitis_b_anti_core: "hepatitis b anti core",
    hepatitis_c: "hepatitis c _HCV_AC_IGG",
    vdrl: "VDRL",
    sifilis_treponemica: "sifilis prueba treponemica ECLIA",
    psa: "antigeno prostatico especifico total - PSA",
    chagas_hai: "test chagas HAI",
    chagas_eclia: "test chagas ECLIA",
    hpv_genotipo_16: "test HPV genotipo 16",
    hpv_genotipo_18: "test HPV genotipo 18",
    hpv_otros: "test HPV otros genotipos alto riesgo",
    hemoglobina_glicosilada: "hemoglobina glicosilada",
    microalbuminuria: "microalbuminuria",
    proteinuria: "proteinuria",
    clearence_creatinina: "clearence creatinina",
    somf: "sangre oculta en materia fecal - SOMF",
    creatinina_orina_espontanea: "RAC - creatinina orina",
    rac_albumina_creatinina: "RAC - Relación Albúmina/Creatinina",
  };

  const valores = data.valores;
  const valoresConDatos = Object.entries(valores).filter(([k, v]) => v);

  buscarDatosAfiliado(data.dni).then((datosAfiliado) => {
    const rojos = [],
      amarillos = [],
      verdes = [],
      sinSemaforo = [];

    valoresConDatos.forEach(([campo, valor]) => {
      const semaforo = evaluarSemaforo(campo, valor, datosAfiliado);
      const item = { campo, valor, semaforo };
      if (!semaforo) sinSemaforo.push(item);
      else if (semaforo.icono === "🔴") rojos.push(item);
      else if (semaforo.icono === "🟡") amarillos.push(item);
      else verdes.push(item);
    });

    const hayRojos = rojos.length > 0;

    const renderFila = (item) => {
      const { campo, valor, semaforo } = item;
      const bg = semaforo ? semaforo.bg : "#f9fafb";
      const color = semaforo ? semaforo.color : "#374151";
      const icono = semaforo ? semaforo.icono : "⚪";
      const texto = semaforo ? semaforo.texto : "";
      return `
        <div style="display:flex; justify-content:space-between; align-items:center; 
                    background:${bg}; border-left:4px solid ${color};
                    padding:8px 12px; border-radius:6px; margin-bottom:4px;">
          <span style="color:#374151; font-size:0.85rem;">${ETIQUETAS[campo] || campo}</span>
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-weight:bold; color:${color}; font-size:0.85rem;">${valor}</span>
            <span style="font-size:0.75rem; background:white; padding:2px 6px; 
                         border-radius:12px; color:${color}; font-weight:bold;
                         border:1px solid ${color};">
              ${icono} ${texto}
            </span>
          </div>
        </div>`;
    };

    let html = `
      <div class="border-t pt-3">
        <p class="font-bold text-gray-700 mb-3">
          Se encontraron <strong>${valoresConDatos.length}</strong> resultados.
          ${hayRojos ? '<span class="text-red-600 ml-2">⚠️ Hay valores alterados — revisá antes de confirmar.</span>' : ""}
        </p>`;

    if (rojos.length > 0) {
      html += `<p style="font-size:0.75rem;font-weight:bold;color:#dc2626;text-transform:uppercase;margin:8px 0 4px 0;">🔴 Valores alterados (${rojos.length})</p>`;
      rojos.forEach((item) => {
        html += renderFila(item);
      });
    }
    if (amarillos.length > 0) {
      html += `<p style="font-size:0.75rem;font-weight:bold;color:#d97706;text-transform:uppercase;margin:8px 0 4px 0;">🟡 Valores límite (${amarillos.length})</p>`;
      amarillos.forEach((item) => {
        html += renderFila(item);
      });
    }
    if (verdes.length > 0) {
      html += `<p style="font-size:0.75rem;font-weight:bold;color:#16a34a;text-transform:uppercase;margin:8px 0 4px 0;">🟢 Valores normales (${verdes.length})</p>`;
      verdes.forEach((item) => {
        html += renderFila(item);
      });
    }
    if (sinSemaforo.length > 0) {
      html += `<p style="font-size:0.75rem;font-weight:bold;color:#6b7280;text-transform:uppercase;margin:8px 0 4px 0;">⚪ Otros valores</p>`;
      sinSemaforo.forEach((item) => {
        html += renderFila(item);
      });
    }

    window._datosPDFLab = { data, mapeo: MAPEO_PRACTICAS };

    if (hayRojos) {
      html += `
        <div style="background:#fee2e2;border:1px solid #dc2626;border-radius:8px;padding:12px;margin-top:12px;text-align:center;">
          <p style="color:#dc2626;font-weight:bold;margin-bottom:8px;">
            ⚠️ Hay ${rojos.length} valor/es alterado/s. ¿Confirmás que los revisaste?
          </p>
          <button id="btnConfirmarPDF"
            style="background:#dc2626;color:white;padding:10px 24px;border-radius:8px;border:none;font-weight:bold;cursor:pointer;">
            ✓ Revisé los valores — CONFIRMAR Y GUARDAR
          </button>
        </div>`;
    } else {
      html += `
        <div style="text-align:center;margin-top:12px;">
          <button id="btnConfirmarPDF"
            style="background:#16a34a;color:white;padding:10px 24px;border-radius:8px;border:none;font-weight:bold;cursor:pointer;">
            ✓ CONFIRMAR Y GUARDAR TODO
          </button>
        </div>`;
    }

    html += `</div>`;
    resultadoDiv.classList.remove("hidden");
    resultadoDiv.innerHTML = html;

    document.getElementById("btnConfirmarPDF").addEventListener("click", () => {
      confirmarCargaPDFLab(window._datosPDFLab.data, window._datosPDFLab.mapeo);
    });
  });
}

async function buscarDatosAfiliado(dni) {
  try {
    const response = await fetch(`/getDatosAfiliado/${dni}`);
    const data = await response.json();
    if (data.success) return data.afiliado;
    return null;
  } catch (e) {
    return null;
  }
}

async function confirmarCargaPDFLab(data, mapeo) {
  const valores = data.valores;
  const dni = data.dni;
  const resultadoDiv = document.getElementById("pdfResultado");

  resultadoDiv.innerHTML = `
    <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
      <i class="fas fa-spinner fa-spin text-blue-600 text-2xl mb-2"></i>
      <p class="text-blue-700">Verificando prácticas...</p>
    </div>`;

  const practicasParaGuardar = [];
  Object.entries(valores).forEach(([campo, valor]) => {
    if (!valor) return;
    const descripcion = mapeo[campo];
    if (!descripcion) return;
    practicasParaGuardar.push({ campo, descripcion, valor });
  });

  if (practicasParaGuardar.length === 0) {
    resultadoDiv.innerHTML = `
      <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
        <p class="text-yellow-700">No hay prácticas para guardar.</p>
      </div>`;
    return;
  }

  // Verificar duplicados ANTES de guardar
  try {
    const resCheck = await fetch("/verificarPracticasDuplicadas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dni, practicas: practicasParaGuardar }),
    });
    const checkData = await resCheck.json();

    if (checkData.duplicadas && checkData.duplicadas.length > 0) {
      const listaDuplicadas = checkData.duplicadas
        .map((p) => `• ${p}`)
        .join("\n");

      resultadoDiv.innerHTML = `
        <div class="bg-yellow-50 border-2 border-yellow-400 rounded-lg p-5">
          <p class="font-bold text-yellow-800 text-lg mb-3">
            ⚠️ Las siguientes prácticas ya fueron cargadas para este paciente:
          </p>
          <div class="bg-white rounded-lg p-3 mb-4 text-sm text-gray-700">
            ${checkData.duplicadas.map((p) => `<p class="py-1 border-b border-gray-100">• ${p}</p>`).join("")}
          </div>
          <p class="text-yellow-700 text-sm mb-4">
            Si guardás de nuevo, se pisará el resultado anterior. ¿Querés continuar igual?
          </p>
          <div class="flex gap-3 justify-center">
            <button id="btnContinuarIgual"
              class="bg-yellow-500 hover:bg-yellow-600 text-white px-5 py-2 rounded-lg font-bold">
              Continuar y pisar
            </button>
            <button id="btnCancelarDuplicado"
              class="bg-gray-400 hover:bg-gray-500 text-white px-5 py-2 rounded-lg font-bold">
              Cancelar
            </button>
          </div>
        </div>`;

      document
        .getElementById("btnCancelarDuplicado")
        .addEventListener("click", () => {
          resultadoDiv.innerHTML = "";
          resultadoDiv.classList.add("hidden");
        });

      document
        .getElementById("btnContinuarIgual")
        .addEventListener("click", () => {
          ejecutarGuardadoLab(dni, practicasParaGuardar, valores, resultadoDiv);
        });
      return;
    }
  } catch (e) {
    console.warn("No se pudo verificar duplicados, continuando...", e.message);
  }

  ejecutarGuardadoLab(dni, practicasParaGuardar, valores, resultadoDiv);
}

async function ejecutarGuardadoLab(
  dni,
  practicasParaGuardar,
  valores,
  resultadoDiv,
) {
  resultadoDiv.innerHTML = `
    <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
      <i class="fas fa-spinner fa-spin text-blue-600 text-2xl mb-2"></i>
      <p class="text-blue-700">Guardando prácticas...</p>
    </div>`;

  try {
    const response = await fetch("/savePracticasLaboratorio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dni,
        practicas: practicasParaGuardar,
        valoresCompletos: valores,
        archivosPDF: window._archivosPDFLab || [],
        idPrestador: prestadorActual.id,
        nombrePrestador: prestadorActual.nombre,
      }),
    });

    const res = await response.json();
    let mensaje = "";
    if (res.success) {
      mensaje = `<p class="font-bold text-green-700">✅ ${res.guardadas} prácticas guardadas.</p>`;
    } else {
      mensaje = `<p class="text-red-600">Error: ${res.message}</p>`;
    }

    resultadoDiv.innerHTML = `
      <div class="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
        <i class="fas fa-check-circle text-green-600 text-2xl mb-2"></i>
        ${mensaje}
      </div>`;

    setTimeout(() => {
      cerrarModalPDFLab();
      buscarPracticas();
    }, 2000);
  } catch (e) {
    resultadoDiv.innerHTML = `
      <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
        <p class="text-red-600">Error de conexión. Intentá de nuevo.</p>
      </div>`;
  }
}
function mapearEspecialidad(rol) {
  const MAPA = {
    bioquimico: "Laboratorio Bioquimico",
    laboratorio: "Laboratorio Bioquimico",
    imagenes: "Diagnostico por Imagenes",
    gastro: "Gastroenterologia",
    densitometria: "Densitometria",
    biopsias: "Biopsias",
    papanicolau: "Papanicolau",
    oftalmologia: "Oftalmologia",
    espirometria: "Espirometria",
  };
  return MAPA[rol] || "Medicina";
}

// ==========================================
// UTILIDADES
// ==========================================
const toBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = (error) => reject(error);
  });

document.addEventListener("DOMContentLoaded", () => {
  if (window.dpEsPreventivista) {
    document.getElementById("selectorPreventivista").classList.remove("hidden");
  } else {
    prestadorActual = {
      nombre: window.dpProfesional,
      especialidad: mapearEspecialidad(window.dpRol),
      id: window.dpRol,
    };
    mostrarPortal();
  }

  document
    .getElementById("btnGuardarPractica")
    .addEventListener("click", guardarPractica);
  document.getElementById("dniSearch")?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") buscarPracticas();
  });
});
// ==========================================
// MI ACTIVIDAD
// ==========================================
function mostrarTabPrestador(tab) {
  document.getElementById("contenido-buscar").classList.add("hidden");
  document.getElementById("contenido-actividad").classList.add("hidden");
  document.getElementById(`contenido-${tab}`).classList.remove("hidden");
}

async function cargarActividad() {
  const mes = document.getElementById("actividadMes").value;
  const anio = document.getElementById("actividadAnio").value;
  const lista = document.getElementById("listaActividad");

  lista.innerHTML =
    '<div class="text-center py-8 text-gray-400"><i class="fas fa-spinner fa-spin text-2xl mb-2"></i><p>Cargando...</p></div>';

  try {
    const res = await fetch(
      `/api/mi-actividad/${mes}/${anio}?nombre=${encodeURIComponent(prestadorActual.nombre)}`,
    );
    const data = await res.json();

    document.getElementById("actividadCargadas").textContent =
      data.cargadas?.length || 0;
    document.getElementById("actividadPendientes").textContent =
      data.pendientes?.length || 0;

    lista.innerHTML = "";

    if (data.cargadas?.length > 0) {
      lista.innerHTML += `<h3 class="font-bold text-green-700 text-sm uppercase mb-2 mt-2">
                <i class="fas fa-check-circle mr-1"></i> Cargadas este mes (${data.cargadas.length})</h3>`;
      data.cargadas.forEach((p) => {
        lista.innerHTML += `
                    <div class="bg-green-50 border-l-4 border-green-500 rounded-lg p-3 mb-2 flex justify-between items-center">
                        <div>
                            <p class="font-bold text-gray-800 text-sm">${p.nombre_completo || p.dni}</p>
                            <p class="text-xs text-gray-500">DNI: ${p.dni} — ${p.descripcion_practica}</p>
                            <p class="text-xs text-gray-400">${p.fecha_carga ? new Date(p.fecha_carga).toLocaleDateString("es-AR") : "S/F"}</p>
                        </div>
                        <span class="bg-green-100 text-green-700 text-xs px-2 py-1 rounded-full font-bold">✓ REALIZADA</span>
                    </div>`;
      });
    }

    if (data.pendientes?.length > 0) {
      lista.innerHTML += `<h3 class="font-bold text-yellow-700 text-sm uppercase mb-2 mt-4">
                <i class="fas fa-clock mr-1"></i> Pendientes de carga (${data.pendientes.length})</h3>`;
      data.pendientes.forEach((p) => {
        lista.innerHTML += `
                    <div class="bg-yellow-50 border-l-4 border-yellow-500 rounded-lg p-3 mb-2 flex justify-between items-center">
                        <div>
                            <p class="font-bold text-gray-800 text-sm">${p.nombre_completo || p.dni}</p>
                            <p class="text-xs text-gray-500">DNI: ${p.dni} — ${p.descripcion_practica}</p>
                        </div>
                        <button onclick="document.getElementById('dniSearch').value='${p.dni}'; mostrarTabPrestador('buscar'); buscarPracticas();"
                            class="bg-blue-600 text-white text-xs px-3 py-1 rounded-lg font-bold hover:bg-blue-700">
                            Cargar
                        </button>
                    </div>`;
      });
    }

    if (!data.cargadas?.length && !data.pendientes?.length) {
      lista.innerHTML =
        '<p class="text-center text-gray-400 py-8">No hay actividad para este período.</p>';
    }
  } catch (e) {
    lista.innerHTML =
      '<p class="text-red-500 text-center">Error al cargar actividad.</p>';
  }
}
