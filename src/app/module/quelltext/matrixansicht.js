
import { esc } from '../../basis/dom.js';
import { hz, parseHz } from '../../basis/format.js';
import { explanation, selectedData } from './datenansicht.js';
import { compactValue, matrixCell, sourceNetwork } from './messwerte.js';
import { profileError } from './profil.js';

const formats = [['RI','Re / Im'],['DB','dB / °'],['MA','Betrag / °']];
const pairMode = mode => mode.type === 'D' || mode.type === 'C';
const toValues = ([re,im],format) => {
  if(format==='RI')return [re,im];
  const mag=Math.hypot(re,im), phase=mag===0?null:Math.atan2(im,re)/RF.RAD;
  return [format==='DB'?20*Math.log10(mag):mag,phase];
};
const exact = value => value==null?'—':value===-Infinity?'−∞':String(value);
const parameter = (row,col) => {
  if(pairMode(row)&&pairMode(col))return 'S'+row.type+col.type+(row.id<10&&col.id<10?''+row.id+col.id:'('+row.id+','+col.id+')');
  if(row.type==='P'&&col.type==='P'&&row.id<10&&col.id<10)return 'S'+row.id+col.id;
  return 'S('+row.key+','+col.key+')';
};

function prepare(doc) {
  const {index, point, profile} = doc;
  const data = selectedData(doc,point);
  let config = profile;
  if (doc.matrixBasis==='se') config={loads:Array.from({length:index.n},()=>({type:'active'})),pairs:[],ref:null};
  else {
    const error=profileError(profile,index);
    if(error)throw new Error(error);
    if(!profile.pairs.length)throw new Error('Lege unter „Portzuordnung“ ein Differenzpaar für die Mixed-Mode-Matrix an.');
  }
  const { layout, samples } = sourceNetwork(index,data,point,config);
  const single=doc.matrixBasis==='se';
  const values=samples[single?0:1], modes=single?layout.seModes:layout.mmModes;
  const source=single && index.kind==='S' && !index.labels ? data : null;
  if(!values)throw new Error('Für diese Frequenz ergibt das Portprofil keine endliche S-Matrix.');
  return { modes, values, source };
}

function kindOf(row,col,r,c) {
  if(r===c)return 'reflect';
  if(row.type!==col.type)return 'convert';
  if(row.type==='D')return 'diff';
  if(row.type==='C')return 'common';
  return 'through';
}

function matrixCellMarkup(values,modes,format,r,c,select) {
  const row=modes[r], col=modes[c], raw=RF.get(values,modes.length,r,c);
  const rendered=toValues(raw,format), name=parameter(row,col), full=rendered.map(exact).join(' / ');
  const intensity=Math.min(1,Math.max(0,(20*Math.log10(Math.hypot(...raw))+60)/60));
  return '<td class="src-map-'+kindOf(row,col,r,c)+'" style="--src-strength:'+Math.round(12+43*intensity)+'%"><button type="button" data-matrix-cell="'+r+','+c+
    '" aria-pressed="'+String(select?.[0]===r&&select?.[1]===c)+'" title="'+esc(name+' · '+full)+'">'+
    rendered.map(v=>'<span>'+esc(v==null?'—':compactValue(v))+'</span>').join('')+'</button></td>';
}

function matrixContent(doc) {
  try {
    const {modes,values,source}=prepare(doc);
    const format=doc.matrixFormat||doc.index.format, selected=doc.matrixSelected;
    const heads=modes.map(mode=>'<th scope="col" title="Z₀ '+esc(exact(mode.ref))+' Ω">'+esc(mode.key)+'</th>').join('');
    const rows=modes.map((row,r)=>'<tr><th scope="row">'+esc(row.key)+'</th>'+
      modes.map((_,c)=>matrixCellMarkup(values,modes,format,r,c,selected)).join('')+'</tr>').join('');
    let details='', mixed=null, sourceToken=null;
    if(selected){
      const [r,c]=selected, row=modes[r], col=modes[c];
      if(row && col){
        const val=RF.get(values,modes.length,r,c), name=parameter(row,col);
        const fileCell=source && matrixCell(source,r,c);
        if(fileCell)sourceToken=fileCell.tokens[0].ordinal;
        const coords = fileCell?.tokens.map(token=>token.word).join(' / ');
        details='<div class="src-map-detail"><strong>'+esc(name)+' · '+esc(hz(doc.index.freq[doc.point]))+'</strong>'+
          '<span>Re <code>'+esc(exact(val[0]))+'</code> · Im <code>'+esc(exact(val[1]))+'</code></span>'+
          (fileCell?'<span>Datei ('+doc.index.format+') <code>'+esc(coords)+'</code>'+
            (fileCell.r===r&&fileCell.c===c?'':' · aus dem gespeicherten Dreieck gespiegelt')+'</span>'+
            '<button type="button" class="button" id="src-map-source">Im Rohtext zeigen</button>':'')+'</div>';
        if(doc.matrixBasis==='mm'&&pairMode(row)&&pairMode(col)){
          mixed=explanation(doc,name);
        }
      }
    }
    return { sourceToken, terms:mixed?.terms, html:
      '<div class="src-map-legend"><span>Zeile = Antwort · Spalte = Anregung</span><span class="src-map-reflect">Reflexion</span>'+
      (doc.matrixBasis==='mm'?
        '<span class="src-map-diff">Differenziell</span><span class="src-map-common">Gleichtakt</span><span class="src-map-convert">Modenkonversion</span>':
        '<span class="src-map-through">Übertragung</span>')+'<span>Farbintensität nach Betrag</span></div>'+
      '<div class="src-table-scroll src-map-scroll" tabindex="0" aria-label="S-Parameter-Matrix"><table class="src-grid src-map"><thead><tr><th scope="col">↓ / →</th>'+
      heads+'</tr></thead><tbody>'+rows+'</tbody></table></div>'+details+
      (mixed?.html?'<section class="src-mixed">'+mixed.html+'</section>':'') };
  } catch(error) {
    return { html:'<p class="src-empty src-bad" role="status">'+esc(error.message)+'</p>' };
  }
}

function matrixView(host,doc,callbacks) {
  if(!doc.index?.freq){host.innerHTML='<p class="src-empty">Die Matrix erscheint nach erfolgreicher Prüfung des Dateitexts.</p>';return;}
  const freq=doc.index.freq, current=doc.point;
  const viewport=host.querySelector('.src-map-scroll'), scroll=[viewport?.scrollLeft||0,viewport?.scrollTop||0];
  const content=matrixContent(doc);
  host.innerHTML='<div class="src-workbar src-map-actions"><label>Portbasis<select id="src-matrix-basis"><option value="se"'+
    (doc.matrixBasis==='se'?' selected':'')+'>Single Ended</option><option value="mm"'+(doc.matrixBasis==='mm'?' selected':'')+'>Mixed Mode</option></select></label>'+
    '<label>Darstellung<select id="src-matrix-format">'+formats.map(([id,text])=>'<option value="'+id+'"'+
      ((doc.matrixFormat||doc.index.format)===id?' selected':'')+'>'+text+'</option>').join('')+'</select></label>'+
    '<label class="src-map-slider">Frequenzpunkt <input type="range" id="src-matrix-range" min="0" max="'+(freq.length-1)+'" value="'+current+'"'+
      (freq.length===1?' disabled':'')+'><output for="src-matrix-range" id="src-matrix-frequency">'+esc(hz(freq[current]))+' · '+(current+1)+' / '+freq.length+'</output></label>'+
    '<form id="src-matrix-jump"><label>Frequenz suchen<input id="src-matrix-hz" placeholder="100 MHz"></label><button type="submit" class="button">Gehe zu</button></form></div>'+
    '<p class="src-profile-summary">'+(doc.matrixBasis==='se'?'Physische Ports · Dateireferenz':'Aktive Ports · Mit Portprofil und Abschlüssen')+'</p>'+content.html;
  host.querySelector('.src-map-scroll')?.scrollTo(...scroll);
  const range=host.querySelector('#src-matrix-range'), output=host.querySelector('#src-matrix-frequency');
  range.oninput=()=>{const i=Number(range.value);output.textContent=hz(freq[i])+' · '+(i+1)+' / '+freq.length;};
  function setPoint(point) {
    doc.point=point;
    doc.selected=null;
    doc.colors.clear();
    callbacks.paint();
  }
  range.onchange=()=>{setPoint(Number(range.value));host.querySelector('#src-matrix-range')?.focus({preventScroll:true});};
  host.querySelector('#src-matrix-jump').onsubmit=event=>{
    event.preventDefault();
    const input=host.querySelector('#src-matrix-hz'), f=parseHz(input.value);
    if(!(f>=0&&Number.isFinite(f))){
      input.setCustomValidity(window.I18N.t('Frequenz mit Einheit eingeben, zum Beispiel 100 MHz.'));
      input.reportValidity();
      return;
    }
    setPoint(Plot.nearest(freq,f));
  };
  host.querySelector('#src-matrix-hz').oninput=event=>event.target.setCustomValidity('');
  host.onchange=event=>{
    const {id,value}=event.target;
    if(id==='src-matrix-basis'){
      doc.matrixBasis=value;doc.matrixSelected=null;doc.colors.clear();
    }else if(id==='src-matrix-format')doc.matrixFormat=value;
    else return;
    callbacks.paint();
    host.querySelector('#'+id)?.focus({preventScroll:true});
  };
  host.onclick=event=>{
    const button=event.target.closest('button');
    if(!button)return;
    if(button.dataset.matrixCell){
      const key=button.dataset.matrixCell;
      doc.matrixSelected=key.split(',').map(Number);
      callbacks.paint();
      host.querySelector('[data-matrix-cell="'+key+'"]')?.focus({preventScroll:true});
    }else if(button.dataset.sourceToken!==undefined || button.id==='src-map-source'){
      doc.colors.clear();
      for(const term of content.terms??[])for(const token of term.cell.tokens)doc.colors.set(token.ordinal,term.color);
      callbacks.source(button.dataset.sourceToken!==undefined?Number(button.dataset.sourceToken):content.sourceToken);
    }
  };
}

export { matrixView };
