
import { esc } from '../../basis/dom.js';
import { hz } from '../../basis/format.js';
import { EDITABLE_LOADS, LOADS, state } from '../../basis/zustand.js';
import { settingsFromEmbedded } from '../../dateien/einstellungen.js';

const blankLoad = () => ({type:'active'});
const loadOptions = [...LOADS, ['join','Mit Port verbinden']];
const clone = data => JSON.parse(JSON.stringify(data));

function draftProfile(index, bound, useCurrent = false) {
  const saved = !useCurrent && settingsFromEmbedded({ n:index.n, embedded:index.embedded });
  const config = saved?.config || (bound && state.config?.loads.length === index.n ? state.config : null);
  const pairs = config?.pairs ?? index.sourcePairs;
  return {
    name: saved?.profileName || (bound ? state.profile.name : '') || '',
    pairs: clone(pairs.map((pair,i)=>({...pair,id:i+1}))),
    loads: config ? clone(config.loads) : Array.from({length:index.n},blankLoad),
    ref: config?.ref ?? null, tab:'s', basis:pairs.length?'mm':'se',
    sFormat: bound ? state.sFormat : 'db', sKeys:null,
    markers:bound ? state.markers.filter(i=>i!==null).map(i=>state.dataset.freq[i]) : [],
    hasTriples: !saved && bound && !!config?.triples?.length
  };
}

function profileError(profile, index) {
  const {pairs,loads,ref}=profile, n=index.n;
  const validPort=p=>Number.isInteger(p)&&p>=0&&p<n;
  const ports=pairs.flatMap(pair=>[pair.p,pair.q]);
  if(profile.hasTriples)return 'Das Touchstone-Portprofil speichert Zweileiterpaare. Übernimm für diese Datei zuerst eine eindeutige Zweileiterkonfiguration.';
  if(ports.some(p=>!validPort(p)) || new Set(ports).size!==ports.length) return 'Jede Portnummer muss gültig sein und darf nur einem Paar angehören.';
  if(ports.some(p=>loads[p].type!=='active')) return 'Beide Ports eines Differenzpaars brauchen die Einstellung „Aktiv“.';
  if(!loads.some(load=>load.type==='active'))return 'Mindestens ein Port muss aktiv sein.';
  if(loads.some((load,i)=> load.type==='join' && (!validPort(load.to)||load.to===i||loads[load.to]?.type==='join')))return 'Eine Portverbindung braucht einen anderen gültigen Zielport.';
  if(ref!=null && (!Number.isFinite(ref)||ref<=0))return 'Die Bezugsimpedanz muss größer als 0 Ω sein.';
  if(pairs.some(pair=>[pair.zd,pair.zc].some(z=>z!=null&&(!Number.isFinite(z)||z<=0))))return 'Modale Bezugsimpedanzen müssen größer als 0 Ω sein.';
  if(loads.some(load=>['r','l','c'].some(k=>load[k]!=null&&(!Number.isFinite(load[k])||load[k]<0)) ||
    (load.x!=null&&!Number.isFinite(load.x))))return 'Prüfe die Lastwerte. R, L und C müssen nichtnegativ sein.';
  return '';
}

function profileText(text, profile) {
  // Guard legacy annotation against swallowing unrelated comments after a broken block.
  let open = false;
  for (const line of text.split('\n')) {
    if (/^\s*!\s*\[SPA-Port-Profile\]/i.test(line)) {
      if (open) throw new Error('Im Quelltext beginnt ein zweiter Profilblock vor dem Ende des ersten.');
      open = true;
    } else if (/^\s*!\s*\[End SPA-Port-Profile\]/i.test(line)) open = false;
    else if (open && !/^\s*!/.test(line)) throw new Error('Der vorhandene Profilblock ist unvollständig.');
  }
  if (open) throw new Error('Im Quelltext fehlt [End SPA-Port-Profile].');
  return RF.annotate(text, RF.profileLines(profile));
}

function field(name,value,label) {
  return '<input data-field="'+name+'" type="number" step="any" value="'+(Number.isFinite(value)?value:'')+'" aria-label="'+label+'">';
}
function dropdown(value, label) {
  return '<select data-field="type" aria-label="'+label+'">'+loadOptions.map(([type,text])=>'<option value="'+type+'"'+
    (type===value?' selected':'')+'>'+esc(text)+'</option>').join('')+'</select>';
}
function loadFields(load, i) {
  if (load.type==='join') return '<label>Zielport '+field('to',load.to+1,'Zielport für P'+(i+1))+'</label>';
  if (!EDITABLE_LOADS.includes(load.type)) return '';
  return (load.type==='resistor'?['r']:load.type==='complex'?['r','x']:['r','l','c']).map(key=>{
    const [unit,factor]=({r:['Ω',1],x:['Ω',1],l:['nH',1e9],c:['pF',1e12]})[key];
    return '<label>'+key.toUpperCase()+' ('+unit+') '+field(key,load[key]==null?0:load[key]*factor,key.toUpperCase()+' für P'+(i+1))+'</label>';
  }).join('');
}

function profilePanel(host, profile, index, notify, commit, current) {
  host.innerHTML = '<div class="src-workbar"><label>Profilname<input id="src-profile-name" value="'+esc(profile.name)+'" maxlength="60"></label>' +
    '<label>Referenz (Ω)<input id="src-profile-ref" type="number" step="any" value="'+(profile.ref??'')+'" placeholder="Dateireferenz"></label>' +
    (current?'<button class="button" id="src-use-active-profile" type="button">Aus aktiver Analyse</button>':'')+
    (index.n===6?'<button class="button" id="src-lan" type="button">LAN-Beispiel P1/P3 → P6/P4</button>':'')+'</div>'+
    '<div class="src-profile-grid"><section><h3>Differenzpaare</h3><div class="src-table-scroll"><table class="src-grid"><thead><tr><th>Paar</th><th>+ Port</th><th>− Port</th><th>Z<sub>d</sub> (Ω)</th><th>Z<sub>c</sub> (Ω)</th><th></th></tr></thead><tbody>'+
    profile.pairs.map((pair,i)=>'<tr data-pair="'+i+'"><th>D'+(i+1)+'</th>'+
      ['p','q','zd','zc'].map((k,j)=>'<td>'+field(k,j<2?pair[k]+1:pair[k],['Plusport','Minusport','Differenzimpedanz','Gleichtaktimpedanz'][j]+' D'+(i+1))+'</td>').join('')+
      '<td><button type="button" class="button" data-remove="'+i+'" aria-label="Paar D'+(i+1)+' entfernen">×</button></td></tr>').join('')+'</tbody></table></div>'+
    '<button class="button" id="src-add-pair" type="button">Paar hinzufügen</button><h3>Ports und Abschlüsse</h3><div class="src-loads">'+
    profile.loads.map((load,i)=>'<div class="src-load" data-port="'+i+'"><strong>P'+(i+1)+'</strong>'+dropdown(load.type,'Abschluss P'+(i+1))+loadFields(load,i)+'</div>').join('')+
    '</div></section><section><h3>Vorschau im Dateitext</h3><p class="src-profile-hint">Mit „In Dateitext einfügen“ übernimmst du das Profil in die Arbeitskopie.</p><pre class="src-profile-preview" data-no-i18n></pre>'+
    '<p class="src-profile-warning" role="status"></p><button class="button primary" id="src-insert-profile" type="button">In Dateitext einfügen</button></section></div>';
  const preview = host.querySelector('.src-profile-preview'), warning=host.querySelector('.src-profile-warning'), insert=host.querySelector('#src-insert-profile');
  function update(){
    profile.basis=profile.pairs.length?'mm':'se';
    const error=profileError(profile,index);
    preview.textContent=RF.profileLines(profile).map(line=>'! '+line).join('\n');
    warning.textContent=error;
    insert.disabled=!!error;
    notify();
  }
  const redraw=()=>profilePanel(host,profile,index,notify,commit,current);
  host.onclick=event=>{
    const button=event.target.closest('button');
    if(!button)return;
    if(button===insert){commit();return;}
    if(button.id==='src-use-active-profile'){current();return;}
    if(button.id==='src-lan'){
      profile.name='LAN-Übertrager';
      profile.pairs=[{id:1,p:0,q:2},{id:2,p:5,q:3}];
      profile.loads=Array.from({length:6},(_,i)=>({type:[1,4].includes(i)?'open':'active'}));
      profile.hasTriples=false;
    } else if(button.id==='src-add-pair'){
      const used=new Set(profile.pairs.flatMap(pair=>[pair.p,pair.q]));
      const free=profile.loads.map((load,i)=>load.type==='active'&&!used.has(i)?i:null).filter(i=>i!==null);
      if(free.length<2){warning.textContent='Für ein weiteres Paar werden zwei freie aktive Ports benötigt.';return;}
      profile.pairs.push({id:profile.pairs.length+1,p:free[0],q:free[1]});
    } else if(button.dataset.remove!==undefined){
      profile.pairs.splice(Number(button.dataset.remove),1);
      profile.pairs.forEach((pair,i)=>{pair.id=i+1;});
    } else return;
    redraw();
  };
  host.oninput=event=>{
    const input=event.target, value=input.value, number=value===''?null:Number(value), field=input.dataset.field;
    if(input.id==='src-profile-name')profile.name=value;
    else if(input.id==='src-profile-ref')profile.ref=number;
    else if(input.closest('[data-pair]')){
      const pair=profile.pairs[Number(input.closest('[data-pair]').dataset.pair)];
      pair[field]=['p','q'].includes(field)?(number??0)-1:number;
    } else if(input.closest('[data-port]')){
      const i=Number(input.closest('[data-port]').dataset.port), load=profile.loads[i];
      if(field==='type'){
        profile.loads[i]={type:value, ...(EDITABLE_LOADS.includes(value)?{r:0,x:0,l:0,c:0}:{}),
          ...(value==='join'?{to:(i+1)%index.n}:{})};
        redraw();return;
      }
      load[field]=field==='to'?(number??0)-1:(number??0)*({l:1e-9,c:1e-12}[field]??1);
    }
    update();
  };
  update();
}

function profileSummary(profile, frequency) {
  const pairs = profile.pairs.map(({p,q,id})=>'D'+id+' = P'+(p+1)+' (+) / P'+(q+1)+' (−)');
  const loads = profile.loads.flatMap(({type},i)=> type==='active'?[]:['P'+(i+1)+' '+window.I18N.t(loadOptions.find(item=>item[0]===type)?.[1]??type)]);
  return [...pairs,...loads,...(frequency==null?[]:[hz(frequency)])].join(' · ');
}

export { draftProfile, profileError, profileText, profilePanel, profileSummary };
