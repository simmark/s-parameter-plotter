// basis/format – Zahlen, Frequenzen und komplexe Werte formatieren und einlesen.
import { esc } from './dom.js';

const num = Plot.formatNumber, hz = Plot.formatFreq, parseHz = Plot.parseFreq;
const portName = i => 'P' + (i + 1);
const omega = f => RF.TAU * f;

function numberValue(text) {
  const raw = String(text ?? '').trim();
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(raw)) return NaN;
  return Number(raw.replace(',', '.'));
}

function display(value) {
  if (value === Infinity) return '∞';
  if (value === -Infinity) return '−∞';
  if (!Number.isFinite(value)) return '—';
  return num(value).replace(/^-/, '−');
}

function valueWith(value, unit) {
  return Number.isNaN(value) || value === undefined || value === null ? '—' : display(value) + (unit ? ' ' + unit : '');
}

function freqInput(value) {
  return Number.isFinite(value) ? Plot.formatFreq(value, true) : '';
}

function complexText(value, unit = '') {
  if (!value?.every(Number.isFinite)) return '—';
  const [re, im] = value;
  return display(re) + (im < 0 ? ' − j' : ' + j') + display(Math.abs(im)) + (unit ? ' ' + unit : '');
}

function traceValue(trace, index) {
  return index === null ? NaN : trace.values[index];
}

function complexAt(raw, index) {
  return raw && index !== null ? [raw[2 * index], raw[2 * index + 1]] : null;
}

const si = (value, unit) => {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0 ' + unit;
  const e = Math.max(-5, Math.min(4, Math.floor(Math.log10(Math.abs(value)) / 3)));
  return display(value / 10 ** (3 * e)) + ' ' + ['f', 'p', 'n', 'µ', 'm', '', 'k', 'M', 'G', 'T'][e + 5] + unit;
};
const metricText = (label, text) => '<div class="metric"><strong>' + esc(text) + '</strong><span>' + esc(label) + '</span></div>';

export { num, hz, parseHz, portName, omega, numberValue, display, valueWith, freqInput, complexText, traceValue,
  complexAt, si, metricText };
