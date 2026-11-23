
import { esc } from '../../basis/dom.js';
import { complexText, hz, parseHz } from '../../basis/format.js';
import { sourceLocation } from './dokument.js';
import { compactValue, matrixCell, matrixLabel, mixedTerms, nativeMode, pointData, sourceNetwork, tokenNumber,
  tokenRange } from './messwerte.js';
import { profileError, profileSummary } from './profil.js';

const PAGE_SIZE = 12, COL_SIZE = 8;
const labels = { RI:['Re', 'Im'], MA:['Betrag','°'], DB:['dB','°'] };
const option = (value, title, selected) => '<option value="'+value+'"'+(selected?' selected':'')+'>'+title+'</option>';
const selectedAttr = selected => selected ? ' aria-pressed="true"' : ' aria-pressed="false"';

function cellMarkup(cell, color, selected) {
  return '<td'+(color==null?'':' class="src-term-'+color+'"')+'><div class="src-value-pair">'+cell.tokens.map(token=>
    '<button type="button" class="src-value" data-source-token="'+token.ordinal+'" title="'+esc(token.word)+'"'+selectedAttr(selected===token.ordinal)+'>'+esc(compactValue(tokenNumber(token.word)))+'</button>').join('')+'</div></td>';
}

function selectedData(doc, point) {
  doc.pointCache ??= new Map();
  if (!doc.pointCache.has(point)) doc.pointCache.set(point, pointData(doc.index, doc.lines, point));
  return doc.pointCache.get(point);
}

function evaluateMixed(doc, curve) {
  const {index, profile, point} = doc;
  const data = selectedData(doc, point);
  const {mode, output, input} = curve;
  if(index.labels){
    const row=nativeMode(index,mode[0],output), col=nativeMode(index,mode[1],input);
    const cell=row.port<0 || col.port<0 ? null : matrixCell(data,row.port,col.port);
    const sign=row.sign*col.sign;
    const {layout,samples:[,matrix]}=sourceNetwork(index,data,point,profile);
    const changed=!!(layout.join || layout.reducedLoads.length || layout.seRefs.some((ref,i)=>ref!==layout.nativeRefs[i]) || layout.mmRenorm);
    const target=layout.mmModes.findIndex(m=>m.key===mode[0]+output.id);
    const origin=layout.mmModes.findIndex(m=>m.key===mode[1]+input.id);
    return {native:true, result:cell && RF.scale(cell.value,sign), cell, sign,changed,
      effective:matrix && RF.get(matrix,layout.mmModes.length,target,origin)};
  }
  const terms=mixedTerms(index,data,mode,output,input);
  const raw=terms.reduce((sum,term)=>RF.add(sum,RF.scale(term.cell.value,term.weight)),[0,0]);
  const {layout, samples:[se,mixed]}=sourceNetwork(index,data,point,profile);
  if(!se || !mixed)return {terms,raw,singular:true};
  const row=layout.mmModes.findIndex(m=>m.key===mode[0]+output.id);
  const col=layout.mmModes.findIndex(m=>m.key===mode[1]+input.id);
  const result=RF.get(mixed,layout.mmModes.length,row,col);
  const changed=!!(layout.join || layout.reducedLoads.length || layout.seRefs.some((ref,i)=>ref!==layout.nativeRefs[i]) || layout.mmRenorm);
  const normalized=term=>RF.get(se,layout.active.length,layout.active.indexOf(term.row),layout.active.indexOf(term.col));
  const adjusted=terms.map(term=>normalized(term));
  return {terms,raw,result,changed,adjusted,modeRefs:layout.mmRenorm,unequal:terms.some(t=>index.physicalRefs[t.row]!==index.physicalRefs[t.col])||
    index.physicalRefs[output.p]!==index.physicalRefs[output.q]||index.physicalRefs[input.p]!==index.physicalRefs[input.q]};
}

function curveSelection(input, profile) {
  const match=input.trim().match(/^S?(DD|DC|CD|CC)\s*(?:([1-9])\s*[.,:]?\s*([1-9])|\(\s*(\d+)\s*,\s*(\d+)\s*\))(?:\s*@\s*(.+))?$/i);
  if(!match)throw new Error('Mixed-Mode-Ausdruck eingeben, zum Beispiel SDD21 oder SDC2.1 @ 100 MHz.');
  const mode=match[1].toUpperCase(), output=profile.pairs[Number(match[2]||match[4])-1], inputPair=profile.pairs[Number(match[3]||match[5])-1];
  if(!output||!inputPair)throw new Error('Lege die benötigten Differenzpaare unter „Portzuordnung“ an.');
  const frequency=match[6]?parseHz(match[6]):null;
  if(frequency!==null&&(!Number.isFinite(frequency)||frequency<0))throw new Error('Frequenz hinter @ mit Einheit eingeben, zum Beispiel @ 100 MHz.');
  return {mode,output,input:inputPair,frequency};
}

function explanation(doc, expression = doc.curveText) {
  if(!expression)return {html:'',terms:null};
  try {
    if(doc.index.kind!=='S')throw new Error('Die Mixed-Mode-Aufschlüsselung bezieht sich auf S-Parameter in der Datei.');
    const error=profileError(doc.profile,doc.index);
    if(error)throw new Error(error);
    const curve=curveSelection(expression,doc.profile);
    const values=evaluateMixed(doc,curve);
    const name='S'+curve.mode+(curve.output.id>9||curve.input.id>9?'('+curve.output.id+','+curve.input.id+')':String(curve.output.id)+curve.input.id);
    const header='<div class="src-mixed-heading"><strong>'+name+' · '+hz(doc.index.freq[doc.point])+'</strong><small>Antwort '+curve.mode[0]+curve.output.id+' ← Anregung '+curve.mode[1]+curve.input.id+'</small></div>';
    if(values.native && !values.cell)return {terms:null,html:header+
      '<p>Aus der Mixed-Mode-Dateimatrix und der gewählten Portzuordnung berechnet · '+esc(complexText(values.effective))+'</p>'};
    if(values.native)return {terms:[{cell:values.cell,color:0}],html:header+
      '<p>Dateiwert aus [Mixed-Mode Order]'+(values.sign<0?' · Vorzeichen wegen geänderter Paarpolung umgekehrt':'')+
      ' · '+esc(complexText(values.result))+
      (values.changed?' · Mit Portprofil '+esc(complexText(values.effective)):'')+'</p>'};
    const terms=values.terms.map((term,i)=>{
      const label=matrixLabel(doc.index,term.row,term.col);
      return '<button type="button" class="src-term-card src-term-'+term.color+'" data-source-token="'+term.cell.tokens[0].ordinal+'">'+
        '<strong>'+(term.weight<0?'−':'+')+' ½ × '+label+'</strong><span>'+esc(complexText(term.cell.value))+'</span>'+
        (values.changed?'<small>Effektiv '+esc(complexText(values.adjusted[i]))+'</small>':'')+
        (term.cell.r!==term.row||term.cell.c!==term.col?'<small>Gespeichert als '+matrixLabel(doc.index,term.cell.r,term.cell.c)+'</small>':'')+'</button>';
    }).join('');
    const rawTitle=values.changed ? (values.unequal?'Formale Summe aus Rohwerten':'Summe aus Rohwerten') : 'Ergebnis';
    const result='<div class="src-mixed-result">'+rawTitle+' <strong>'+esc(complexText(values.raw))+'</strong>'+
      (values.singular?' · Kein endliches Ergebnis mit diesen Abschlüssen':values.changed?' · Mit Portprofil <strong>'+esc(complexText(values.result))+'</strong>':'')+'</div>';
    const note=values.modeRefs?'<small>Der Analyzer renormiert nach der Modenumrechnung auf die eingestellten modalen Impedanzen.</small>':
      values.changed?'<small>„Effektiv“ zeigt die Einzelwerte nach Abschluss und Bezugsanpassung.</small>':'';
    return {terms:values.terms,html:header+'<div class="src-term-cards">'+terms+'</div>'+result+note};
  } catch(error){return {terms:null,html:'<p class="src-bad">'+esc(error.message)+'</p>'};}
}

function tableMarkup(doc, mixed) {
  const {index,point,selected} = doc, parts=labels[index.format];
  const start=Math.floor(point/PAGE_SIZE)*PAGE_SIZE;
  for(const p of doc.pointCache.keys())if(p<start||p>=start+PAGE_SIZE)doc.pointCache.delete(p);
  const focus=mixed.terms?.length && doc.termColumns;
  const all = selectedData(doc,point).cells;
  const columns = doc.responsePort == null ? all : all.filter(cell=>cell.r===doc.responsePort);
  doc.column=Math.min(doc.column,COL_SIZE*Math.max(0,Math.ceil(columns.length/COL_SIZE)-1));
  const shown=focus?[...new Set(mixed.terms.map(term=>term.cell))]:columns.slice(doc.column,doc.column+COL_SIZE);
  const paint = cell => {
    const matches=mixed.terms?.filter(term=>term.cell.r===cell.r&&term.cell.c===cell.c);
    return matches?.length===1 ? matches[0].color : null;
  };
  const body=Array.from({length:Math.min(PAGE_SIZE,index.freq.length-start)},(_,offset)=>{
    const p=start+offset, data=selectedData(doc,p);
    return '<tr'+(p===point?' class="src-point-active"':'')+'><th scope="row"><button type="button" class="src-frequency" data-point="'+p+'"'+selectedAttr(p===point)+'>'+esc(hz(index.freq[p]))+'</button></th>'+
      shown.map(pos=>{const cell=matrixCell(data,pos.r,pos.c);return cellMarkup(cell, p===point?paint(cell):null, selected);}).join('')+'</tr>';
  }).join('');
  const headers=shown.map(cell=>'<th scope="col"><strong>'+esc(matrixLabel(index,cell.r,cell.c))+'</strong><div class="src-value-pair"><small>'+parts[0]+'</small><small>'+parts[1]+'</small></div></th>').join('');
  return '<div class="src-table-scroll" tabindex="0" aria-label="Touchstone-Messwerte"><table class="src-grid src-matrix-table src-format-'+index.format.toLowerCase()+'"><thead><tr><th scope="col">Frequenz</th>'+headers+'</tr></thead><tbody>'+body+'</tbody></table></div>'+
    '<div class="src-table-footer"><div><button type="button" data-page="-1" class="button" '+(!start?'disabled':'')+'>Zurück</button> <button type="button" data-page="1" class="button" '+(start+PAGE_SIZE>=index.freq.length?'disabled':'')+'>Weiter</button> <span>'+(start+1)+'–'+Math.min(start+PAGE_SIZE,index.freq.length)+' / '+index.freq.length+'</span></div>'+
    '<label'+(focus?' hidden':'')+'>Spalten <select id="src-column">'+Array.from({length:Math.ceil(columns.length/COL_SIZE)},(_,i)=>option(i*COL_SIZE,(i*COL_SIZE+1)+'–'+Math.min((i+1)*COL_SIZE,columns.length),doc.column===i*COL_SIZE)).join('')+'</select></label></div>';
}

function navigateTable(doc, text) {
  const {index} = doc;
  const direct = text.match(/^([szyhg])(?:\(\s*(\d+)\s*,\s*(\d+)\s*\)|(\d)(\d))(?:\s*@\s*(.+))?$/i);
  const frequency = parseHz(direct ? direct[6] ?? '' : text);
  if(!direct && !Number.isFinite(frequency)) {
    const curve = curveSelection(text, doc.profile);
    doc.curveText = text;
    doc.termColumns = true;
    if(curve.frequency!==null)doc.point=Plot.nearest(index.freq,curve.frequency);
    return;
  }
  if((direct?.[6] && !Number.isFinite(frequency)) || frequency<0)throw new Error('Frequenz mit Einheit eingeben, zum Beispiel 100 MHz.');
  const nextPoint=Number.isFinite(frequency)?Plot.nearest(index.freq,frequency):doc.point;
  if(direct){
    const row=Number(direct[2]||direct[4])-1, col=Number(direct[3]||direct[5])-1;
    const slot=index.positions.findIndex(([r,c])=>r===row&&c===col);
    if(direct[1].toUpperCase()!==index.kind || slot<0)throw new Error('Dieses Matrixelement besitzt keine eigene Spalte in der Datei.');
    doc.responsePort=null;
    doc.column=Math.floor(slot/COL_SIZE)*COL_SIZE;
    doc.selected=nextPoint*(1+2*index.positions.length)+1+slot*2;
    doc.curveText='';
    doc.termColumns=false;
  }
  doc.point=nextPoint;
}

function valueView(host, doc, callbacks) {
  if(!doc.index?.freq){host.innerHTML='<p class="src-empty">Die Tabelle erscheint nach erfolgreicher Prüfung des Dateitexts.</p>';return;}
  doc.pointCache ??= new Map();
  const mixed=explanation(doc);
  doc.colors.clear();
  for(const term of mixed.terms??[])for(const token of term.cell.tokens){
    doc.colors.set(token.ordinal,term.color);
  }
  const [edited] = doc.selected==null?[]:tokenRange(doc.index,doc.lines,doc.selected,1);
  const location = edited && sourceLocation(doc.index,doc.selected);
  const edit = location?.name ?
    '<form id="src-edit-value" class="src-cell-info"><label>'+esc(location.name+' · '+location.part+' · '+hz(doc.index.freq[location.point]))+
      ' <input id="src-new-value" value="'+esc(edited.word)+'" autocomplete="off"></label>'+
      '<button type="submit" class="button">Wert ersetzen</button><button type="button" class="button" id="src-cell-source">Im Rohtext zeigen</button></form>' :
    '<p class="src-cell-info">Wähle eine Zahl, um sie zu bearbeiten oder ihre Position im Rohtext zu sehen.</p>';
  const viewport=host.querySelector('.src-table-scroll');
  const scroll=viewport?.scrollLeft??0;
  host.innerHTML='<form id="src-mixed-form" class="src-workbar"><label>Parameter oder Frequenz <input id="src-mixed" placeholder="SDD21 @ 100 MHz" value="'+esc(doc.curveText)+'"></label>'+
    '<button class="button" type="submit">Anzeigen</button>'+
    '<label>Antwortport <select id="src-response">'+option('', 'Alle Ports', doc.responsePort==null)+
      Array.from({length:doc.index.n},(_,r)=>option(r,esc(doc.index.labels?.[r] || (doc.index.kind+(r<9?r+1+'x':'('+(r+1)+',x)')+' · P'+(r+1))),doc.responsePort===r)).join('')+
    '</select></label>'+
    (mixed.terms?'<label class="src-term-toggle"><input type="checkbox" id="src-term-columns"'+(doc.termColumns?' checked':'')+'> Nur beteiligte Spalten</label>':'')+'</form><p id="src-table-error" class="src-profile-summary src-bad" role="status" hidden></p>'+
    '<div class="src-profile-summary">'+esc(profileSummary(doc.profile)||'Differenzpaare unter „Portzuordnung“ festlegen.')+'</div>'+
    (mixed.html?'<section class="src-mixed">'+mixed.html+'</section>':'')+tableMarkup(doc,mixed)+
    edit;
  host.querySelector('.src-table-scroll').scrollLeft=scroll;
  host.querySelector('#src-mixed-form').onsubmit=event=>{
    event.preventDefault();
    const expression = host.querySelector('#src-mixed').value.trim();
    doc.selected=null;
    if(!expression){doc.curveText='';doc.termColumns=false;callbacks.paint();return;}
    try {
      navigateTable(doc, expression);
      callbacks.paint();
    } catch(error){
      const message=host.querySelector('#src-table-error');
      message.hidden=false;
      message.textContent=error.message;
    }
  };
  const editForm=host.querySelector('#src-edit-value');
  if(editForm)editForm.onsubmit=event=>{
    event.preventDefault();
    const input=host.querySelector('#src-new-value'), value=input.value.trim();
    if(!value||/\s|!/.test(value)){input.setCustomValidity(window.I18N.t('Eine einzelne Zahl ohne Trennzeichen eingeben.'));input.reportValidity();return;}
    callbacks.replace(value);
  };
  host.oninput=event=>{if(event.target.id==='src-new-value')event.target.setCustomValidity('');};
  host.onclick=event=>{
    const button=event.target.closest('button');
    if(!button||button.type==='submit')return;
    const {sourceToken,point,page}=button.dataset;
    if(sourceToken!=null){
      callbacks.select(Number(sourceToken));
      callbacks.paint();
    } else if(point!=null || page!=null){
      doc.point=point!=null?Number(point):Math.floor(doc.point/PAGE_SIZE)*PAGE_SIZE+PAGE_SIZE*Number(page);
      doc.selected=null;
      callbacks.paint();
    } else if(button.id==='src-cell-source')callbacks.source();
  };
  host.onchange=event=>{
    if(event.target.id==='src-column')doc.column=Number(event.target.value);
    else if(event.target.id==='src-term-columns')doc.termColumns=event.target.checked;
    else if(event.target.id==='src-response'){
      doc.responsePort=event.target.value===''?null:Number(event.target.value);
      doc.column=0;
      doc.termColumns=false;
      doc.selected=null;
    }
    else return;
    callbacks.paint();
  };
}

export { valueView, explanation, selectedData };
