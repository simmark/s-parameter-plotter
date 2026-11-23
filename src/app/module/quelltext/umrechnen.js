// Convert only network-data tokens. Comments, noise, information, frequency tokens and layout survive.
function convertSource(text, index, target) {
  if (!index?.freq || !['RI','MA','DB'].includes(target) || target===index.format) throw new Error('Wähle ein anderes Zielformat.');
  const lines=text.split('\n'), width=1+2*index.positions.length;
  const edits=new Map(), add=(line,from,to,insert)=>{
    if (!edits.has(line)) edits.set(line,[]);
    edits.get(line).push({from,to,insert});
  };
  const header=(index.optionLine || 0)-1;
  if(header<0) throw new Error('Für die Umrechnung zuerst eine explizite Optionszeile ergänzen.');
  const options=lines[header].split('!')[0], formats=[...options.matchAll(/\b(?:RI|MA|DB)\b/gi)];
  if(formats.length>1)throw new Error('Die Optionszeile enthält mehrere Datenformate.');
  const m=formats[0];
  if(m)add(header,m.index,m.index+m[0].length,target);
  else add(header,options.trimEnd().length,options.trimEnd().length,' '+target);
  const number=s=>/^-inf(?:inity)?$/i.test(s)?-Infinity:Number(s.replace(/[dD]/,'e'));
  const decimal=x=>x===-Infinity?'-Inf':String(Number(x.toPrecision(16)));
  let first;
  for(const [line,offset] of index.rows) {
    let ordinal=offset;
    for(const match of lines[line-1].split('!')[0].matchAll(/\S+/g)) {
      const slot=ordinal++%width;
      if(!slot)continue;
      const value=number(match[0]), pos={line:line-1,col:match.index,end:match.index+match[0].length};
      if(slot%2){first={...pos,value};continue;}
      const a=first.value, b=value;
      const mag=index.format==='RI'?Math.hypot(a,b):index.format==='DB'?10**(a/20):a;
      const angle=index.format==='RI'?Math.atan2(b,a)*180/Math.PI:b;
      const pair=target==='RI'?[mag*Math.cos(angle*Math.PI/180),mag*Math.sin(angle*Math.PI/180)]:
        [target==='DB'?20*Math.log10(mag):mag,angle];
      if (!Number.isFinite(pair[1]) || !(Number.isFinite(pair[0]) || (target==='DB' && pair[0]===-Infinity))) {
        throw new Error('Wertebereich des Zielformats in Zeile '+line+' überschritten.');
      }
      add(first.line,first.col,first.end,decimal(pair[0]));add(pos.line,pos.col,pos.end,decimal(pair[1]));
    }
  }
  const result=lines.map((line,i)=>{
    const changes=edits.get(i);if(!changes)return line;
    const parts=[];let last=0;
    for(const op of changes){parts.push(line.slice(last,op.from),op.insert);last=op.to;}
    parts.push(line.slice(last));return parts.join('');
  });
  return {text:result.join('\n'), preview:[...edits.keys()].filter(i=>i!==header).slice(0,2).map(i=>'Z '+(i+1)+'   '+lines[i].slice(0,140)+'\n       '+result[i].slice(0,140)).join('\n')};
}

export { convertSource };
