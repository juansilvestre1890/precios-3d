/*
 * Fórmulas de Precios 3D (no modificar).
 * Las mismas fórmulas se repiten en Apps Script, que recalcula
 * los costos antes de guardar para garantizar su integridad.
 */
(function (global) {
  "use strict";

  var PARAMS = Object.freeze({
    PRECIO_IMPRESORA: 39000,
    RECARGO_RECUPERACION: 7800,
    HORAS_RECUPERACION: 2500,
    ELECTRICIDAD_HORA: 2,
    TRABAJO_HORA: 100,
    MULTIPLICADOR_VENTA: 2.5
  });

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  /**
   * @param {{rollo:number, peso:number, extra:number, impresion:number, personal:number}} v
   */
  function calcular(v) {
    var costoMaterial = (v.rollo * v.peso / 1000) + v.extra;
    var costoMaquina = ((PARAMS.PRECIO_IMPRESORA + PARAMS.RECARGO_RECUPERACION) / PARAMS.HORAS_RECUPERACION
      + PARAMS.ELECTRICIDAD_HORA) * v.impresion;
    var costoTrabajo = v.personal * PARAMS.TRABAJO_HORA;
    var costoTotal = costoMaterial + costoMaquina + costoTrabajo;
    var precioSugerido = costoTotal * PARAMS.MULTIPLICADOR_VENTA;
    return {
      costoMaterial: round2(costoMaterial),
      costoMaquina: round2(costoMaquina),
      costoTrabajo: round2(costoTrabajo),
      costoTotal: round2(costoTotal),
      precioSugerido: round2(precioSugerido)
    };
  }

  var api = { PARAMS: PARAMS, calcular: calcular, round2: round2 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.Precios3DCalc = api;
})(typeof window !== "undefined" ? window : this);
