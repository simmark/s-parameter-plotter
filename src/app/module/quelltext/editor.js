// The editor always works on original file bytes. Apply goes through normal session import as a separate file.
import { $, esc, toast } from '../../basis/dom.js';
import { registerActions, registerView } from '../../basis/erweiterung.js';
import { hz, parseHz } from '../../basis/format.js';
import { state } from '../../basis/zustand.js';
import { importFile, session, sessionItem } from '../../dateien/sitzung.js';
import { valueView } from './datenansicht.js';
import { editEndings, lanSample, readSource, sampleText, sourceBlob, sourceChanges, sourceLines, sourceLocation,
  sourceRaw, sourceTokens } from './dokument.js';
import { matrixView } from './matrixansicht.js';
import { tokenRange } from './messwerte.js';
import { draftProfile, profileError, profilePanel, profileText } from './profil.js';
import { cancelInspection, inspectSource } from './pruefung.js';
import { convertSource } from './umrechnen.js';
import { saveBlob } from '../../oberflaeche/export.js';
import { setTab } from '../../oberflaeche/rahmen.js';

let hostDataset, doc, editor, generation = 0, validateTimer, saveTimer, markerPending = false, applying = false;
const draftWrites = new Map();
let sourceView = 'values';
const sourceViews = ['values','matrix','raw','profile'];
const el = key => $('src-' + key);
const t = window.I18N.t;
const sample = () => new File([sampleText], 'Zweitor-Demo.s2p');
const button = (id,label,primary=false) => '<button type="button" id="src-' + id + '" class="button' + (primary ? ' primary' : '') + '">' + label + '</button>';
function shell() {
  $('source-panel').innerHTML = '<div class="src-shell"><div class="src-bar"><div class="src-title"><strong id="src-name" data-no-i18n></strong><small id="src-origin"></small></div><div class="src-controls">' +
    button('open','Datei öffnen') + button('lan-demo','LAN-Demo') + button('active','Aktive Datei') + button('download','Kopie speichern') + button('apply','Als Analyse öffnen',true) +
    '</div></div><div class="src-switch" role="group" aria-label="Dateiansicht">' +
    button('view-values','Messwerttabelle') + button('view-matrix','Matrix') + button('view-raw','Rohtext') + button('view-profile','Portzuordnung') +
    '</div><div id="src-values"></div><div id="src-matrix"></div><div id="src-profile"></div><div id="src-raw"><div class="src-navigation">' + button('search','Suchen / Ersetzen') + button('undo','↶') + button('redo','↷') +
    '<select id="src-outline" aria-label="Abschnitt anspringen"></select><input id="src-go" placeholder="S21 @ 100 MHz" title="Zeile 11, 100 MHz oder S21 @ 100 MHz" aria-label="Zu Zeile, Frequenz oder Matrixelement">' + button('jump','Gehe zu') + '</div>' +
    '<div id="src-code" data-no-i18n></div><div class="src-context"><strong id="src-where"></strong><span id="src-token"></span></div></div>' +
    '<div class="src-meta"><span id="src-status" role="status"></span><span id="src-save"></span></div>' +
    '<div id="src-message" class="src-message"></div><details class="src-more" id="src-more"><summary>Änderungen und Dateiformat</summary><pre id="src-diff" data-no-i18n></pre>' +
     '<div class="src-controls"><select id="src-format" aria-label="Zielformat"><option>RI</option><option>MA</option><option>DB</option></select>'+button('convert','Umrechnung ansehen')+button('confirm','Umrechnung übernehmen')+button('utf8','UTF-8-Kopie')+'</div><pre id="src-conversion" data-no-i18n></pre>'  + '</details><input type="file" id="src-file" hidden></div>';
  el('confirm').hidden=true;
  el('convert').onclick=previewConversion;
  el('format').onchange=clearConversion;
  el('confirm').onclick=()=>{if(doc?.conversion && editor)editor.applyLines(doc.conversion.text);};
  el('undo').setAttribute('aria-label','Rückgängig'); el('redo').setAttribute('aria-label','Wiederholen');
  el('undo').title='Rückgängig (Strg+Z)'; el('redo').title='Wiederholen';
  for(const key of sourceViews)el('view-'+key).onclick=()=>showSourceView(key);
  el('open').onclick=()=>el('file').click();
  el('lan-demo').onclick=()=>{sourceView='profile';openSource(new File([lanSample()],'LAN-Demo.s6p'),false);};
  el('active').hidden=true;
  el('active').onclick=()=>renderSource(true);
  el('file').onchange=event=>{const file=event.target.files[0];if(file) openSource(file,false);};
  el('search').onclick=()=>editor?.search();
  el('undo').onclick=()=>editor?.undo(); el('redo').onclick=()=>editor?.redo();
  el('download').onclick=()=>download(false); el('utf8').onclick=()=>download(true);
  el('apply').onclick=apply;
  el('jump').onclick=jump; el('go').onkeydown=e=>{if(e.key==='Enter') jump();};
  el('outline').onchange=e=>{if(e.target.value) editor?.jump(Number(e.target.value));};
  el('more').ontoggle=()=>{if(doc && el('more').open) el('diff').textContent=sourceChanges(doc);};
  showSourceView(sourceView);
}

function clearConversion() {
  if(doc)doc.conversion=null;
  el('confirm').hidden=true;el('conversion').textContent='';
}
function previewConversion() {
  clearConversion();
  try {
    const result=convertSource(doc.text,doc.index,el('format').value);
    doc.conversion=result;el('conversion').textContent=doc.index.format+' → '+el('format').value+' · '+t('Vorschau')+'\n'+result.preview;el('confirm').hidden=false;
  } catch(error){el('conversion').textContent=t(error.message);}
}

function draftStatus(text) { if(el('save')) el('save').textContent=text; }
function saveDraft(d) {
  if (!d || !d.unsaved) return;
  d.unsaved=false;
  const rev=d.rev, raw=sourceRaw(d);
  const write = (draftWrites.get(d.key) || Promise.resolve()).then(async()=>{
    if (!d.key) throw new Error();
    await Store.setMeta(d.key,raw===d.raw ? null : { raw });
    if(doc===d && rev===d.rev) draftStatus(raw===d.raw ? 'Originalstand' : 'Entwurf lokal gesichert');
  }).catch(()=>{if(doc===d && rev===d.rev){d.unsaved=true;draftStatus('Nur im Arbeitsspeicher · Kopie speichern');}});
  draftWrites.set(d.key,write);
  write.then(()=>{if(draftWrites.get(d.key)===write)draftWrites.delete(d.key);});
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')saveDraft(doc);});
window.addEventListener('pagehide',()=>saveDraft(doc));

async function openSource(file, bound) {
  const gen=++generation;
  clearTimeout(validateTimer);clearTimeout(saveTimer);cancelInspection();
  saveDraft(doc);
  editor?.destroy();editor=null;doc=null;
  shell(); el('name').textContent=file.name; el('apply').disabled=true;
  el('active').hidden=bound || !sourceItem();
  el('status').textContent='Quelltext wird geöffnet …';
  try {
    if (!/\.(?:s\d+p|snp|ts)$/i.test(file.name)) throw new Error('Dateiendung für Touchstone wählen, z. B. .s2p oder .ts.');
    if (file.size>100*1024*1024) throw new Error('Die Datei überschreitet 100 MiB.');
    const bytes=await file.arrayBuffer(), original=readSource(bytes);
    let key=null, saved=null;
    try {
      const digest=await Store.hashOf(bytes);
      key='touchstone-draft:'+file.name+':'+digest;
      await draftWrites.get(key);
      saved=await Store.getMeta(key);
    } catch { /* Editing and copy download also work without a persistent store. */ }
    if(gen!==generation)return;
    const lines=sourceLines(typeof saved?.raw==='string'?saved.raw:original.raw);
    doc={ ...original,...lines,key,name:file.name,bound,rev:0,index:null,unsaved:false,
      point:0,column:0,curveText:'',selected:null,termColumns:false,colors:new Map(),matrixBasis:'se' };
    el('origin').textContent=(bound?'Aktive Analysedatei':'Separate Arbeitskopie')+' · '+doc.encoding+' · '+(doc.newline==='\r\n'?'CRLF':doc.newline==='\r'?'CR':'LF');
    draftStatus(saved?'Lokalen Entwurf wiederhergestellt':'Originalstand');
    editor=window.SourceEditor.create(el('code'),doc.text,{
      tokens:(n,line)=>{
        const tokens=sourceTokens(doc?.index,n,line), problem=doc?.index?.diagnostic;
        tokens.forEach(token=>{
          if(doc.colors.has(token.ordinal) && token.kind==='number')token.kind='contribution-'+doc.colors.get(token.ordinal);
        });
        if(problem?.line===n && problem.column!=null)tokens.push({from:problem.column,to:problem.column+problem.length,kind:'error'});
        return tokens;
      },
      changed:(value,changes)=>{
        clearConversion();editEndings(doc,changes);doc.text=value;doc.rev++;doc.unsaved=true;doc.index=null;
        doc.colors.clear();doc.pointCache=null;
        el('values').inert=true;
        el('matrix').inert=true;
        clearTimeout(validateTimer);clearTimeout(saveTimer);cancelInspection();
        if(el('more').open)el('diff').textContent=sourceChanges(doc);
        el('apply').disabled=true;el('message').textContent='';el('status').textContent='Entwurf wird geprüft …';
        draftStatus('Ungesicherte Änderung');
        validateTimer=setTimeout(validate,250);
        const d=doc;saveTimer=setTimeout(()=>saveDraft(d),450);
      },cursor:showCursor
    },window.I18N.lang);
    validate();
  } catch(error){if(gen===generation)el('status').textContent=error.message;}
}

function sourceItem() {
  const item=sessionItem(session.current);
  return item && !state.dataset.spice && !item.make ? item : null;
}

function renderSource(force = false) {
  if(!force && hostDataset===state.dataset && el('code')) {
    if(markerPending && doc?.index) jumpMarker();
    return;
  }
  hostDataset=state.dataset;
  const item=sourceItem();
  if(item){
    const expected=++generation;
    clearTimeout(validateTimer);clearTimeout(saveTimer);cancelInspection();saveDraft(doc);
    editor?.destroy();editor=null;doc=null;
    shell();el('name').textContent=item.name;el('status').textContent='Quelltext wird geöffnet …';el('apply').disabled=true;
    item.getFile().then(f=>{if(expected===generation && hostDataset===state.dataset)openSource(new File([f],item.name),true);})
      .catch(error=>{if(expected===generation){shell();el('status').textContent=error.message;}});
  } else {openSource(sample(),false);}
}

function showCursor() {
  if(!doc || !editor)return;
  const p=editor.cursor(), info=cursorInfo(p);
  el('where').textContent='Z '+p.line+' · Sp '+(p.col+1);
  let label='Quelltext';
  if(info.loc) {
    const l=info.loc, f=hz(doc.index.freq[l.point]);
    label=l.name ? [l.name, l.response+' ← '+l.drive, l.part, f, doc.index.refs[l.r]+' Ω / '+doc.index.refs[l.c]+' Ω'].join(' · ') : 'Frequenz · '+f;
  } else if(info.token?.kind==='comment')label='Kommentar';
  else if(/^\s*#/.test(p.text))label='Optionszeile · Änderungen deuten die vorhandenen Zahlen neu.';
  else if(/^\s*\[/.test(p.text))label='Touchstone-Schlüsselwort';
  el('token').textContent=label;
}
function cursorInfo(p) {
  const tokens=sourceTokens(doc.index,p.line,p.text);
  const token=tokens.find(t=>p.col>=t.from && p.col<t.to) || tokens.find(t=>p.col===t.to);
  const loc=token && ['frequency','number'].includes(token.kind) ? sourceLocation(doc.index,token.ordinal) : null;
  return {token,loc};
}

function validate() {
  if(!doc)return;
  const d=doc, rev=d.rev, text=d.text;
  const sections=[];
  let n=0;
  for(const line of text.split('\n')) {n++;if(/^\s*[#\[]/.test(line) && sections.length<200) sections.push([n,line.trim().split('!')[0].slice(0,70)]);}
  el('outline').innerHTML='<option value="">Abschnitte</option>'+sections.map(([i,s])=>'<option value="'+i+'">'+i+' · '+esc(s)+'</option>').join('');
  inspectSource(text,d.name,result=>{
    if(doc!==d || d.rev!==rev)return;
    d.index=result;
    el('values').inert=false;
    el('matrix').inert=false;
    el('apply').disabled=!!result.error || applying;
    el('message').replaceChildren();
    el('status').classList.toggle('src-bad',!!result.error);
    if(result.error){
      if(sourceView!=='raw')showSourceView('raw');
      const location=result.diagnostic;
      const diagnostic=result.error.match(/^Zeile (\d+) · (.*)$/);
      const message=diagnostic ? t('Zeile')+' '+diagnostic[1]+' · '+t(diagnostic[2]) : t(result.error);
      el('status').textContent=t('Entwurf fehlerhaft')+' · '+message;
      if(location){
        const {line, column, length}=location;
        const b=document.createElement('button');
        b.type='button'; b.className='button';
        b.textContent='Zur Fehlerstelle'+(column!=null?' · Spalte '+(column+1):'');
        b.onclick=()=>editor.jump(line,column ?? 0,length ?? 0);
        el('message').append(b);
      }
    } else {
      el('status').textContent='Gültig · '+result.n+' Ports · '+result.freq.length+' Frequenzpunkte · '+result.format;
      const header=str=>str.match(/^\s*#[^!\r\n]*/m)?.[0].trim();
      const notes=[...result.warnings];
      if(header(d.raw)!==header(d.text))notes.unshift('Die Optionszeile legt fest, wie die Rohwerte gelesen werden.');
      el('message').textContent=notes.map(t).join(' ');
    }
    if(result.freq){
      d.lines=d.text.split('\n');
      d.point=Math.min(d.point,result.freq.length-1);
      d.column=Math.min(d.column,8*Math.floor((result.positions.length-1)/8));
      const embeddedSignature=JSON.stringify(result.embedded);
      if(!d.profile||d.profile.loads.length!==result.n||d.profileInText||d.embeddedSignature!==embeddedSignature){
        d.profile=draftProfile(result,d.bound);
        d.profileInText=false;
        d.embeddedSignature=embeddedSignature;
      }
      if(d.responsePort>=result.n)d.responsePort=null;
      if(d.selected!=null && d.selected>=result.freq.length*(1+2*result.positions.length))d.selected=null;
    }
    showSourceView(sourceView);
    editor.refresh(); showCursor();
    if(markerPending)jumpMarker();
  });
}

function jumpToken(ordinal) {
  const [token]=tokenRange(doc.index,doc.lines,ordinal,1);
  if(token)editor.jump(token.line,token.col);
}

function toPoint(point, slot=0) {
  doc.point=point;
  jumpToken(point*(1+2*doc.index.positions.length)+slot);
}

function paintValues() {
  if(!doc)return;
  valueView(el('values'),doc,{
    paint:paintValues,
    select:ordinal=>{
      doc.selected=ordinal;
      doc.point=sourceLocation(doc.index,ordinal).point;
    },
    source:()=>{showSourceView('raw');jumpToken(doc.selected);},
    replace:value=>{
      const [token]=tokenRange(doc.index,doc.lines,doc.selected,1);
      if(token)editor.replaceToken(token.line,token.col,token.word.length,value);
    }
  });
  editor?.refresh();
}

function paintMatrix() {
  if(!doc)return;
  matrixView(el('matrix'),doc,{
    paint:paintMatrix,
    source:ordinal=>{
      if(!Number.isInteger(ordinal))return;
      doc.selected=ordinal;
      showSourceView('raw');
      jumpToken(ordinal);
    }
  });
}

function paintProfile() {
  if(!doc?.index?.freq){el('profile').textContent='Die Portzuordnung ist nach erfolgreicher Prüfung verfügbar.';return;}
  const d=doc, host=el('profile');
  profilePanel(host,d.profile,d.index,()=>{d.colors.clear();},()=>{
    if(d!==doc||!d.index?.freq||profileError(d.profile,d.index))return;
    try {
      const text=profileText(d.text,d.profile);
      d.profileInText=true;
      editor.replaceText(text);
      showSourceView('raw');
      const line=text.split('\n').findIndex(s=>/^\s*!\s*\[SPA-Port-Profile\]/i.test(s));
      if(line>=0)editor.jump(line+1);
    } catch(error){host.querySelector('.src-profile-warning').textContent=error.message;}
  }, d.bound?()=>{
    d.profile=draftProfile(d.index,true,true);
    paintProfile();
  }:null);
}

function showSourceView(view) {
  sourceView=view;
  for(const key of sourceViews){
    el(key).hidden=key!==view;
    el('view-'+key).setAttribute('aria-pressed',String(key===view));
  }
  if(view==='values')paintValues();
  else if(view==='matrix')paintMatrix();
  else if(view==='profile')paintProfile();
  else editor?.refresh();
}
function jump() {
  if(!doc || !editor)return;
  const value=el('go').value.trim(), line=value.match(/^(?:z(?:eile)?\s*)?(\d+)$/i);
  if(line){const n=Number(line[1]);if(n>0 && n<=doc.endings.length+1)editor.jump(n);else toast('Zeile außerhalb der Datei.');return;}
  const matrix=value.match(/^([szyhg])(?:\((\d+),(\d+)\)|(\d)(\d))\s*(?:@\s*(.+))?$/i);
  let slot=0;
  if(matrix && doc.index?.freq){
    const r=Number(matrix[2]||matrix[4])-1,c=Number(matrix[3]||matrix[5])-1;
    const pos=doc.index.positions.findIndex(([a,b])=>a===r && b===c);
    if(matrix[1].toUpperCase()!==doc.index.kind || pos<0){toast('Dieses Matrixelement ist im Rohtext nicht gespeichert.');return;}
    slot=1+2*pos;
  }
  const selected=cursorInfo(editor.cursor()).loc;
  const f=matrix ? (matrix[6]?parseHz(matrix[6]):doc.index?.freq?.[selected?.point || 0]) : parseHz(value);
  if(!Number.isFinite(f)||f<0||!doc.index?.freq){toast('Zeile oder Frequenz mit Einheit eingeben, z. B. 100 MHz.');return;}
  toPoint(Plot.nearest(doc.index.freq,f),slot);
}
function jumpMarker() {
  markerPending=false;
  if(!doc.bound && sourceItem()){markerPending=true;renderSource(true);return;}
  const f=state.dataset.freq[state.markers[state.activeMarker]];
  if(!Number.isFinite(f))return;
  if(!doc.index?.freq){toast('Die Markerposition ist bei diesem fehlerhaften Entwurf nicht auflösbar.');return;}
  const point=Plot.nearest(doc.index.freq,f);
  if(doc.index.freq[point]!==f)toast('Nächstgelegene Frequenz im Entwurf · '+hz(doc.index.freq[point]));
  toPoint(point);
}
function download(utf8) {
  if(!doc)return;
  try {saveBlob(utf8?new Blob([sourceRaw(doc)],{type:'text/plain;charset=utf-8'}):sourceBlob(doc),doc.name);}
  catch(error){el('message').textContent=error.message;el('more').open=true;}
}

async function apply() {
  if(!doc?.index?.freq || applying)return;
  const d=doc, validated=d.index, loc=sourceView==='matrix' ? {point:d.point} :
    sourceView==='values' ? sourceLocation(d.index,d.selected??d.point*(1+2*d.index.positions.length)) : cursorInfo(editor.cursor()).loc;
  let blob;
  try {blob=sourceBlob(d);}catch(error){el('message').textContent=error.message;el('more').open=true;return;}
  const ext=d.name.match(/\.(?:s\d+p|snp|ts)$/i)?.[0] || '.ts';
  const base=d.name.replace(/\.[^.]+$/,'').replace(/ · Edit \d+$/,'');
  let rev=1,name;
  do {name=base+' · Edit '+rev+ext; rev++;} while(session.items.some(i=>i.name===name));
  applying=true;el('apply').disabled=true;saveDraft(d);
  try {
    await importFile(new File([blob],name));
    if(state.dataset?.name!==name){toast('Kopie konnte nicht als aktive Analyse geöffnet werden.');return;}
    if(loc){
      state.markers[state.activeMarker]=Plot.nearest(state.dataset.freq,validated.freq[loc.point]);
      if(loc.name && !validated.labels && validated.kind==='S' && state.layout.seModes.some(x=>x.port===loc.r) && state.layout.seModes.some(x=>x.port===loc.c)){
        state.basis='se';state.sKeys.se=['P'+(loc.r+1)+':P'+(loc.c+1)];state.sFormat='db';
      }
    }
    setTab('s');
  } catch(error){toast(error.message);}
  finally {applying=false;if(doc===d && el('apply'))el('apply').disabled=!doc?.index?.freq;}
}

registerActions({
  'source-at-marker': () => {
    markerPending=true;
    sourceView='raw';
    setTab('source');
    if(el('view-raw'))showSourceView('raw');
  }
});
registerView({id:'source',title:'Quelltext',short:'Text',icon:'wave',panel:'source-panel',render:renderSource});
