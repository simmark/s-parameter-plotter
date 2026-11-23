import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launch, serve, tempDir, optimize } from './lib.mjs';

const server = await serve();
const { page, context, errors } = await launch(tempDir('spa-magnetic-display-'));
let checks=0;
const check=(condition,message)=>{assert.ok(condition,message);checks++;console.log('  ok    '+message);};
const file=process.env.SPA_CMC_SAMPLE;
const select=(id,value)=>page.selectOption('#control-'+id,value);
const heading=()=>page.locator('#plot-heading').innerText();
try {
  await page.addInitScript(()=>{
    const fill=CanvasRenderingContext2D.prototype.fillText;
    window.axisLabels={};
    CanvasRenderingContext2D.prototype.fillText=function(text,...args){
      if(this.canvas.id==='plot')window.axisLabels[text]=this.font;
      return fill.call(this,text,...args);
    };
  });
  await page.goto(server.url);
  await page.waitForSelector('#tab-cmc');
  if(file){
    await page.setInputFiles('#file-input',{name:'744824310.s4p',mimeType:'text/plain',buffer:fs.readFileSync(file)});
    await page.waitForFunction(()=>document.getElementById('session-files')?.dataset.current === '744824310.s4p');
  }
  await page.click('#tab-cmc');
  if(file){
    const mapping=page.locator('#empty-panel [data-action="physics-apply"]');
    await mapping.waitFor();
    await mapping.click();
  }
  await page.waitForSelector('#model-editor');
  check((await page.locator('#model-capacitance-estimate').innerText()).includes('keine direkten Einzelmessungen'),'Kapazitätszweige und Grenzen der Resonanzmethode sind erklärt');
  check(await page.inputValue('#control-cmc-format')==='ind','CMC startet mit Induktivität je Wicklung');
  check((await heading()).includes('Induktivität je Wicklung'),'Je Wicklung ist als Bezugsgröße angegeben');
  if(file){
    const find=async label=>page.locator('.metric').filter({hasText:label}).locator('strong').first().innerText();
    check(/8[,.]18\d* mH/.test(await find('L · Messwert je Wicklung bei')),'744824310 ergibt bei rund 10 kHz 8,18 mH je Wicklung');
    check(/32[,.]08\d* µH/.test(await find('Lσ · Messwert bei')),'744824310 ergibt bei rund 10 kHz rund 32,08 µH Streuung');
  }
  await select('esb-phase','on');
  await page.waitForFunction(()=>window.axisLabels['-90°']);
  check(await page.locator('#marker-data').innerText().then(s=>s.includes('φ L')),'Phase steht in einem eigenen Marker-Eintrag und auf der rechten Skala');
  await select('cmc-format','leak');
  check((await heading()).includes('Streuinduktivität Lσ'),'Streukurve hat eigene Darstellung');
  await select('cmc-format','modes');
  check((await page.locator('#trace-panel').innerText()).includes('L+M') && (await page.locator('#trace-panel').innerText()).includes('L−M'),'L+M und L−M bleiben auswählbar');
  await select('cmc-format','cap');
  const traces=await page.locator('#trace-panel').innerText();
  check(traces.includes('Cw + Cx') && traces.includes('Modell Cw · einzeln') && traces.includes('Ct + Cx'),'Dateiwerte und einzelne Modellzweige tragen verschiedene Bezeichnungen');
  if(file){
    const info=await page.locator('#analysis-details').innerText();
    check(/Kopplungsplateau[\s\S]*Cw \+ Cx = 7[,.]\d+ pF/.test(info),'Datei zeigt ein kapazitives Kopplungsplateau um 7,4 pF je Seite');
    await optimize(page);
    console.log('       744824310 nach Optimierung:',await page.locator('#model-derived').innerText());
  }
  await page.click('[data-action=axes]');
  await page.selectOption('#axes-form select[name=x-unit]','MHz');
  await page.selectOption('#axes-form select[name=axis-font]','large-bold');
  await page.evaluate(()=>{window.axisLabels={};});
  await page.click('#axes-form button[type=submit]');
  await page.waitForFunction(()=>window.axisLabels['Frequenz [MHz]']);
  check(await page.evaluate(()=>Object.values(window.axisLabels).some(font=>/^(?:700|bold) (?:12|14)px/.test(font))),'Canvas zeichnet Frequenzeinheit und größere fette Tick-Beschriftungen');
  check(errors.length===0,'Keine Browserfehler');
} finally {await context.close();await server.close();}
console.log('PASS · Magnetikdarstellung · '+checks+'/'+checks);
