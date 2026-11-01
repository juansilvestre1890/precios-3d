/* ===== Precios 3D — lógica de la aplicación ===== */
(function () {
  "use strict";

  var CONFIG = window.PRECIOS3D_CONFIG || {};
  var Calc = window.Precios3DCalc;
  var CACHE_STORAGE = "p3d_productos_cache";
  var REQUEST_TIMEOUT_MS = 25000;
  var FIELDS = ["rollo", "peso", "extra", "impresion", "personal"];

  var $ = function (sel) { return document.querySelector(sel); };

  var state = {
    productos: [],       // última lista recibida del servidor
    cargado: false,      // ¿se recibió alguna vez la lista en esta sesión?
    editId: null,        // id del producto en edición (null = nuevo)
    calc: null,          // último resultado calculado
    calcFirma: null,     // firma de las variables usadas en ese cálculo
    guardando: false
  };

  /* ---------------- Utilidades ---------------- */
  var fmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function dinero(n) { return "RD$ " + fmt.format(Number(n) || 0); }

  /** Convierte texto a número. Acepta "1,234.50", "1234,5" o "1234.5". Devuelve NaN si no es válido. */
  function parseNumero(texto) {
    var s = String(texto == null ? "" : texto).trim().replace(/\s|RD\$|\$/gi, "");
    if (s === "") return NaN;
    if (s.indexOf(",") > -1 && s.indexOf(".") > -1) s = s.replace(/,/g, "");
    else if (s.indexOf(",") > -1) s = s.replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(s) && !/^\d*\.\d+$/.test(s)) return NaN;
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  function apiConfigurada() {
    var url = String(CONFIG.API_URL || "");
    return /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url);
  }


  function leerCache() {
    try { var raw = localStorage.getItem(CACHE_STORAGE); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function escribirCache(lista) {
    try { localStorage.setItem(CACHE_STORAGE, JSON.stringify({ fecha: new Date().toISOString(), productos: lista })); } catch (e) { /* nada */ }
  }

  /* ---------------- Avisos ---------------- */
  var toastTimer = null;
  function toast(msg, tipo, accion) {
    var el = $("#toast");
    el.className = "toast" + (tipo ? " " + tipo : "");
    el.textContent = msg;
    if (accion) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = accion.texto;
      b.addEventListener("click", function () { el.hidden = true; accion.fn(); });
      el.appendChild(b);
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    if (!accion) toastTimer = setTimeout(function () { el.hidden = true; }, tipo === "error" ? 5200 : 3200);
  }

  /* ---------------- Diálogo ---------------- */
  function dialogo(opts) {
    return new Promise(function (resolve) {
      var back = $("#dialog"), ok = $("#dialog-ok"), cancel = $("#dialog-cancel");
      $("#dialog-title").textContent = opts.titulo || "";
      $("#dialog-msg").textContent = opts.mensaje || "";
      ok.textContent = opts.ok || "Aceptar";
      ok.className = "btn " + (opts.peligro ? "btn-danger" : "btn-primary");
      cancel.textContent = opts.cancelar || "Cancelar";
      back.hidden = false;
      setTimeout(function () { cancel.focus(); }, 50);

      function cerrar(valor) {
        back.hidden = true;
        ok.removeEventListener("click", onOk);
        cancel.removeEventListener("click", onCancel);
        back.removeEventListener("click", onBack);
        document.removeEventListener("keydown", onKey);
        resolve(valor);
      }
      function onOk() { cerrar(true); }
      function onCancel() { cerrar(false); }
      function onBack(e) { if (e.target === back) onCancel(); }
      function onKey(e) { if (e.key === "Escape") onCancel(); }
      ok.addEventListener("click", onOk);
      cancel.addEventListener("click", onCancel);
      back.addEventListener("click", onBack);
      document.addEventListener("keydown", onKey);
    });
  }

  /* ---------------- Comunicación con Apps Script ---------------- */
  function ApiError(codigo, mensaje) { this.codigo = codigo; this.message = mensaje; }

  function llamar(accion, datos) {
    if (!apiConfigurada()) {
      return Promise.reject(new ApiError("SIN_CONFIG",
        "La aplicación aún no está conectada a Google Sheets. Falta pegar el enlace /exec en js/config.js."));
    }
    if (!navigator.onLine) {
      return Promise.reject(new ApiError("OFFLINE", "Sin conexión a internet. No se realizó ningún cambio."));
    }
    return enviar(accion, datos);
  }

  function enviar(accion, datos) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, REQUEST_TIMEOUT_MS) : null;
    // text/plain sin cabeceras personalizadas => petición "simple", sin preflight CORS.
    return fetch(CONFIG.API_URL, {
      method: "POST",
      body: JSON.stringify({ action: accion, data: datos || {} }),
      redirect: "follow",
      cache: "no-store",
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      if (!res.ok) throw new ApiError("HTTP", "El servidor respondió con un error (" + res.status + ").");
      return res.text();
    }).then(function (texto) {
      var json;
      try { json = JSON.parse(texto); } catch (e) {
        throw new ApiError("RESPUESTA", "Respuesta inesperada del servidor. Revisa que Apps Script esté implementado con acceso para «Cualquier usuario».");
      }
      if (!json || json.ok !== true) {
        var e = (json && json.error) || {};
        throw new ApiError(e.code || "SERVIDOR", e.message || "No se pudo completar la operación.");
      }
      return json.data;
    }, function (err) {
      if (err instanceof ApiError) throw err;
      if (err && err.name === "AbortError") throw new ApiError("TIEMPO", "El servidor tardó demasiado en responder. No se confirmó ningún cambio; revisa la lista antes de reintentar.");
      throw new ApiError("RED", "No se pudo conectar con Google Sheets. Comprueba tu conexión e inténtalo de nuevo.");
    }).finally(function () { if (timer) clearTimeout(timer); });
  }

  /* ---------------- Navegación ---------------- */
  var vistas = { home: $("#view-home"), calc: $("#view-calc"), products: $("#view-products") };

  function mostrar(nombre) {
    Object.keys(vistas).forEach(function (k) { vistas[k].hidden = k !== nombre; });
    window.scrollTo(0, 0);
  }

  function router() {
    var h = location.hash || "#/";
    var mEditar = h.match(/^#\/editar\/([\w-]+)$/);
    if (h === "#/calculadora") {
      if (state.editId) limpiarFormulario();
      mostrar("calc");
    } else if (mEditar) {
      mostrar("calc");
      abrirEdicion(mEditar[1]);
    } else if (h === "#/productos") {
      mostrar("products");
      cargarProductos(false);
    } else {
      mostrar("home");
    }
  }

  /* ---------------- Calculadora ---------------- */
  var inputs = {
    nombre: $("#f-nombre"), rollo: $("#f-rollo"), peso: $("#f-peso"),
    extra: $("#f-extra"), impresion: $("#f-impresion"), personal: $("#f-personal"),
    final: $("#f-final")
  };

  function setError(input, msg) {
    var small = document.querySelector('.err[data-for="' + input.id + '"]');
    if (small) small.textContent = msg || "";
    input.classList.toggle("invalid", !!msg);
    input.setAttribute("aria-invalid", msg ? "true" : "false");
  }

  /** Valida las cinco variables. Devuelve los valores o null si hay errores. */
  function leerVariables() {
    var valores = {}, primero = null;
    FIELDS.forEach(function (f) {
      var el = inputs[f], n = parseNumero(el.value), msg = "";
      if (el.value.trim() === "") msg = "Campo obligatorio.";
      else if (isNaN(n)) msg = "Escribe un número válido (usa punto para decimales).";
      else if (n < 0) msg = "No puede ser negativo.";
      else if (n > 1e9) msg = "Valor demasiado grande.";
      setError(el, msg);
      if (msg && !primero) primero = el;
      valores[f] = n;
    });
    if (primero) { primero.focus(); return null; }
    return valores;
  }

  function firma(v) { return FIELDS.map(function (f) { return v[f]; }).join("|"); }

  function mostrarResultado(precio, vigente) {
    $("#result-value").textContent = dinero(precio);
    var card = $("#result");
    card.hidden = false;
    card.classList.toggle("stale", !vigente);
    // reinicia la animación
    card.style.animation = "none"; void card.offsetWidth; card.style.animation = "";
  }

  function calcular() {
    var v = leerVariables();
    if (!v) return null;
    state.calc = Calc.calcular(v);
    state.calcFirma = firma(v);
    mostrarResultado(state.calc.precioSugerido, true);
    // El precio final NO se toca.
    return v;
  }

  function onVariableCambia() {
    if (!state.calc) return;
    var v = {};
    FIELDS.forEach(function (f) { v[f] = parseNumero(inputs[f].value); });
    $("#result").classList.toggle("stale", firma(v) !== state.calcFirma);
  }

  function limpiarFormulario() {
    $("#calc-form").reset();
    inputs.final.value = "";
    Object.keys(inputs).forEach(function (k) { setError(inputs[k], ""); });
    state.editId = null; state.calc = null; state.calcFirma = null;
    $("#result").hidden = true;
    $("#calc-title").textContent = "Calculadora";
    $("#btn-cancel-edit").hidden = true;
  }

  function llenarFormulario(p) {
    limpiarFormulario();
    state.editId = p.id;
    inputs.nombre.value = p.nombre || "";
    FIELDS.forEach(function (f) { inputs[f].value = p[f] != null && p[f] !== "" ? String(p[f]) : ""; });
    inputs.final.value = p.precioFinal != null && p.precioFinal !== "" ? String(p.precioFinal) : "";
    var v = {}; FIELDS.forEach(function (f) { v[f] = Number(p[f]); });
    state.calc = Calc.calcular(v);
    state.calcFirma = firma(v);
    mostrarResultado(state.calc.precioSugerido, true);
    $("#calc-title").textContent = "Editar producto";
    $("#btn-cancel-edit").hidden = false;
  }

  function abrirEdicion(id) {
    var p = buscarLocal(id);
    if (p) { llenarFormulario(p); return; }
    $("#calc-title").textContent = "Cargando…";
    llamar("list").then(function (lista) {
      recibirLista(lista);
      var q = buscarLocal(id);
      if (q) llenarFormulario(q);
      else { toast("Ese producto ya no existe.", "error"); location.hash = "#/productos"; }
    }).catch(function (err) {
      toast(err.message, "error");
      location.hash = "#/productos";
    });
  }

  function buscarLocal(id) {
    for (var i = 0; i < state.productos.length; i++) if (state.productos[i].id === id) return state.productos[i];
    return null;
  }

  function guardar() {
    if (state.guardando) return;
    var nombre = inputs.nombre.value.trim().replace(/\s+/g, " ");
    var ok = true;
    if (!nombre) { setError(inputs.nombre, "Escribe el nombre del producto."); ok = false; }
    else setError(inputs.nombre, "");

    var v = leerVariables();
    if (!v) return;
    if (!ok) { inputs.nombre.focus(); return; }

    if (!state.calc || firma(v) !== state.calcFirma) {
      toast("Pulsa «Calcular costos» antes de guardar: las variables cambiaron.", "error");
      $("#btn-calc").focus();
      return;
    }

    var precioFinal = parseNumero(inputs.final.value);
    if (inputs.final.value.trim() === "") { setError(inputs.final, "Escribe el precio final de venta."); inputs.final.focus(); return; }
    if (isNaN(precioFinal) || precioFinal < 0) { setError(inputs.final, "Escribe un precio válido."); inputs.final.focus(); return; }
    if (precioFinal > 1e9) { setError(inputs.final, "Valor demasiado grande."); inputs.final.focus(); return; }
    setError(inputs.final, "");

    var datos = {
      nombre: nombre,
      rollo: v.rollo, peso: v.peso, extra: v.extra, impresion: v.impresion, personal: v.personal,
      precioFinal: Calc.round2(precioFinal)
    };
    var accion = state.editId ? "update" : "create";
    if (state.editId) datos.id = state.editId;

    var btn = $("#btn-save");
    state.guardando = true;
    btn.disabled = true; btn.classList.add("loading");
    btn.querySelector(".btn-text").textContent = "Guardando…";

    llamar(accion, datos).then(function (producto) {
      // Solo aquí, con la respuesta confirmada del servidor, se informa el éxito.
      actualizarLocal(producto);
      toast(accion === "update" ? "Cambios guardados correctamente." : "Producto guardado correctamente.", "ok");
      limpiarFormulario();
      location.hash = "#/productos";
    }).catch(function (err) {
      if (err.codigo === "NO_ENCONTRADO") toast("Ese producto ya no existe en la hoja. No se guardaron cambios.", "error");
      else toast(err.message, "error");
    }).finally(function () {
      state.guardando = false;
      btn.disabled = false; btn.classList.remove("loading");
      btn.querySelector(".btn-text").textContent = "Guardar producto";
    });
  }

  /* ---------------- Productos ---------------- */
  var cargando = false;

  function recibirLista(lista) {
    state.productos = Array.isArray(lista) ? lista : [];
    state.cargado = true;
    escribirCache(state.productos);
  }

  function actualizarLocal(p) {
    if (!p || !p.id) return;
    var i = state.productos.findIndex(function (x) { return x.id === p.id; });
    if (i > -1) state.productos[i] = p; else state.productos.push(p);
    escribirCache(state.productos);
  }

  function cargarProductos(forzar) {
    if (cargando) return;
    var aviso = $("#list-notice");
    aviso.hidden = true;
    if (state.cargado && !forzar) { pintarLista(); }
    else if (!state.cargado) { pintarEsqueleto(); }

    cargando = true;
    $("#btn-refresh").classList.add("spinning");
    llamar("list").then(function (lista) {
      recibirLista(lista);
      pintarLista();
    }).catch(function (err) {
      var cache = leerCache();
      if (!state.cargado && cache && cache.productos && cache.productos.length) {
        state.productos = cache.productos;
        pintarLista();
        aviso.textContent = "No se pudo actualizar desde Google Sheets (" + err.message.replace(/\.$/, "") +
          "). Se muestra la última copia guardada en este dispositivo.";
        aviso.hidden = false;
      } else if (!state.cargado) {
        pintarEstado("No se pudo cargar la lista", err.message, { texto: "Reintentar", fn: function () { cargarProductos(true); } });
      } else {
        toast(err.message, "error");
      }
    }).finally(function () {
      cargando = false;
      $("#btn-refresh").classList.remove("spinning");
    });
  }

  function pintarEsqueleto() {
    var ul = $("#product-list");
    ul.innerHTML = "";
    $("#list-state").hidden = true;
    for (var i = 0; i < 3; i++) { var li = document.createElement("li"); li.className = "skeleton"; ul.appendChild(li); }
  }

  function pintarEstado(titulo, texto, accion) {
    $("#product-list").innerHTML = "";
    var box = $("#list-state");
    box.innerHTML = "";
    var p1 = document.createElement("p"); p1.className = "big"; p1.textContent = titulo; box.appendChild(p1);
    if (texto) { var p2 = document.createElement("p"); p2.textContent = texto; box.appendChild(p2); }
    if (accion) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "btn btn-primary"; b.textContent = accion.texto;
      b.addEventListener("click", accion.fn);
      box.appendChild(b);
    }
    box.hidden = false;
  }

  function normalizar(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  var ICON_EDIT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25ZM20.7 7.04a1 1 0 0 0 0-1.41l-2.33-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.82-1.83Z"/></svg>';
  var ICON_DEL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z"/></svg>';

  function pintarLista() {
    var ul = $("#product-list");
    var q = normalizar($("#search").value.trim());
    var lista = state.productos
      .filter(function (p) { return !q || normalizar(p.nombre).indexOf(q) > -1; })
      .sort(function (a, b) { return String(a.nombre).localeCompare(String(b.nombre), "es", { sensitivity: "base" }); });

    ul.innerHTML = "";
    $("#list-state").hidden = true;

    if (!state.productos.length) {
      pintarEstado("Aún no hay productos", "Crea el primero con la Calculadora.",
        { texto: "Nuevo producto", fn: function () { location.hash = "#/calculadora"; } });
      return;
    }
    if (!lista.length) { pintarEstado("Sin resultados", "Ningún producto coincide con «" + $("#search").value.trim() + "»."); return; }

    lista.forEach(function (p, i) {
      var li = document.createElement("li");
      li.className = "product";
      li.style.animationDelay = Math.min(i, 10) * 0.03 + "s";

      var info = document.createElement("div"); info.className = "product-info";
      var h = document.createElement("p"); h.className = "product-name"; h.textContent = p.nombre;
      var pr = document.createElement("p"); pr.className = "product-price";
      pr.appendChild(document.createTextNode("Precio final: "));
      var st = document.createElement("strong"); st.textContent = dinero(p.precioFinal); pr.appendChild(st);
      info.appendChild(h); info.appendChild(pr);

      var acts = document.createElement("div"); acts.className = "product-actions";
      var be = document.createElement("button");
      be.type = "button"; be.className = "act act-edit"; be.innerHTML = ICON_EDIT;
      be.setAttribute("aria-label", "Editar " + p.nombre); be.title = "Editar";
      be.addEventListener("click", function () { location.hash = "#/editar/" + p.id; });
      var bd = document.createElement("button");
      bd.type = "button"; bd.className = "act act-del"; bd.innerHTML = ICON_DEL;
      bd.setAttribute("aria-label", "Eliminar " + p.nombre); bd.title = "Eliminar";
      bd.addEventListener("click", function () { eliminar(p, bd); });
      acts.appendChild(be); acts.appendChild(bd);

      li.appendChild(info); li.appendChild(acts);
      ul.appendChild(li);
    });
  }

  function eliminar(p, boton) {
    dialogo({
      titulo: "Eliminar producto",
      mensaje: "¿Seguro que quieres eliminar «" + p.nombre + "»? Esta acción no se puede deshacer.",
      ok: "Eliminar", cancelar: "Cancelar", peligro: true
    }).then(function (si) {
      if (!si) return;
      boton.disabled = true;
      return llamar("delete", { id: p.id }).then(function () {
        state.productos = state.productos.filter(function (x) { return x.id !== p.id; });
        escribirCache(state.productos);
        if (state.editId === p.id) limpiarFormulario();
        pintarLista();
        toast("Producto eliminado.", "ok");
      }).catch(function (err) {
        boton.disabled = false;
        if (err.codigo === "NO_ENCONTRADO") {
          toast("Ese producto ya no existía en la hoja.", "error");
          cargarProductos(true);
        } else toast(err.message, "error");
      });
    });
  }

  /* ---------------- Conexión ---------------- */
  function actualizarBanner() { $("#net-banner").hidden = navigator.onLine; }

  /* ---------------- Service worker ---------------- */
  function registrarSW() {
    if (!("serviceWorker" in navigator)) return;
    var recargando = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (recargando) return; recargando = true; location.reload();
    });
    navigator.serviceWorker.register("./sw.js").then(function (reg) {
      function ofrecer(w) {
        toast("Hay una nueva versión disponible.", null, { texto: "Actualizar", fn: function () { w.postMessage("SKIP_WAITING"); } });
      }
      if (reg.waiting && navigator.serviceWorker.controller) ofrecer(reg.waiting);
      reg.addEventListener("updatefound", function () {
        var w = reg.installing;
        if (!w) return;
        w.addEventListener("statechange", function () {
          if (w.state === "installed" && navigator.serviceWorker.controller) ofrecer(w);
        });
      });
      setInterval(function () { reg.update().catch(function () {}); }, 60 * 60 * 1000);
    }).catch(function () { /* la app sigue funcionando sin SW */ });
  }

  /* ---------------- Eventos ---------------- */
  $("#calc-form").addEventListener("submit", function (e) { e.preventDefault(); calcular(); });
  FIELDS.forEach(function (f) {
    inputs[f].addEventListener("input", function () { setError(inputs[f], ""); onVariableCambia(); });
  });
  inputs.nombre.addEventListener("input", function () { setError(inputs.nombre, ""); });
  inputs.final.addEventListener("input", function () { setError(inputs.final, ""); });
  $("#btn-save").addEventListener("click", guardar);
  $("#btn-cancel-edit").addEventListener("click", function () { limpiarFormulario(); location.hash = "#/productos"; });
  $("#btn-refresh").addEventListener("click", function () { cargarProductos(true); });
  $("#search").addEventListener("input", function () { if (state.cargado || state.productos.length) pintarLista(); });
  window.addEventListener("hashchange", router);
  window.addEventListener("online", actualizarBanner);
  window.addEventListener("offline", actualizarBanner);

  actualizarBanner();
  router();
  registrarSW();

  // Exposición mínima para pruebas automatizadas.
  window.__precios3d = { state: state, parseNumero: parseNumero };
})();
