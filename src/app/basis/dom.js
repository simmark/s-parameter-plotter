// basis/dom – DOM-Helfer: Elementzugriff, Escaping, Symbole, Formularbausteine, Hinweise und Dialoge.

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const icon = name => '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
const disabled = value => value ? ' disabled' : '';
const checked = value => value ? ' checked' : '';
const pressed = value => ' aria-pressed="' + Boolean(value) + '"';
const options = (items, selected) => items.map(([key, label]) =>
  '<option value="' + esc(key) + '"' + (String(key) === String(selected) ? ' selected' : '') + '>' + esc(label) + '</option>').join('');
const help = '<button class="quiet-button" type="button" data-action="method">Methodik ' + icon('chevron') + '</button>';
const mobile = matchMedia('(max-width: 850px)');
const coarse = matchMedia('(pointer: coarse)');

function textField(label, name, value, placeholder = '', id = '') {
  return '<label class="control"><span>' + esc(label) + '</span><input class="field-input mono" type="text" name="' + esc(name) +
    '" value="' + esc(value) + '" placeholder="' + esc(placeholder) + '" autocomplete="off" inputmode="text"' + (id ? ' id="' + esc(id) + '"' : '') + '></label>';
}

function selectField(label, action, items, value, narrow = false) {
  return '<label class="control' + (narrow ? ' narrow' : '') + '"><span>' + esc(label) +
    '</span><select id="control-' + action + '" data-change="' + action + '">' + options(items, value) + '</select></label>';
}

function actionButton(label, action, value = '', klass = 'button', image = '', attributes = '') {
  return '<button type="button" class="' + klass + '" data-action="' + action + '" data-value="' + esc(value) + '"' +
    attributes + '>' + (image ? icon(image) : '') + esc(label) + '</button>';
}

function iconButton(title, action, value, image, extra = '') {
  return actionButton('', action, value, 'icon-button', image, ' title="' + esc(title) + '" aria-label="' + esc(title) + '"' + extra);
}

function insertHtml(node, html) {
  const active = node.contains(document.activeElement) ? document.activeElement.id : '';
  node.innerHTML = html;
  if (active) $(active)?.focus({ preventScroll: true });
}

let toastTimer = null;
function toast(message) {
  const element = $('toast');
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.hidden = true; }, 4000);
}

function notice(id, text) {
  const element = $(id);
  element.textContent = text;
  element.hidden = !text;
}

function openDialog(id) {
  const d = $(id);
  if (!d.open) d.showModal();
}

function formError(form, message) {
  const target = form.querySelector('.form-error');
  target.textContent = message;
  target.hidden = !message;
}

const formErrorHtml = '<p class="inline-notice form-error" role="alert" hidden></p>';
const nextTick = () => new Promise(resolve => setTimeout(resolve, 0));

export { $, esc, icon, disabled, checked, pressed, options, help, mobile, coarse, textField, selectField,
  actionButton, iconButton, insertHtml, toast, notice, openDialog, formError, formErrorHtml, nextTick };
