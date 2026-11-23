// basis/sprache – Sprache: startet die Übersetzung, Locale und kurze Helfer für zweisprachige Texte.

window.I18N.start();
document.querySelector('#lang-button .lang-code').textContent = window.I18N.lang === 'de' ? 'EN' : 'DE';
document.getElementById('menu-lang-code').textContent = window.I18N.lang === 'de' ? 'EN' : 'DE';
const LOCALE = window.I18N.locale;

const EN = () => window.I18N?.lang === 'en';
const tx = (de, en) => EN() ? en : de;
const lang = () => EN() ? 'en' : 'de';

export { LOCALE, EN, tx, lang };
