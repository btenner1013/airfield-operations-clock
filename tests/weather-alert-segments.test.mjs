import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveWeatherAlertSegments as resolve} from '../app/weatherAlertSegments.ts';
const rain={displayText:'🌧️ -RA ATIS',displayTone:'blue',pulse:false,flash:false};
const forecast={displayText:'⛈️ -TSRA PSBL 04 NOV 00-04Z',displayTone:'yellow',pulse:true,flash:false};
const legacy={text:'🌧️ -RA ATIS | ⛈️ -TSRA PSBL 04 NOV 00-04Z',tone:'blue',pulse:false,flash:false,visible:true};
test('current first and forecast second preserve independently supplied presentation',()=>{
 const s=resolve(rain,forecast,legacy);assert.equal(s.length,2);
 assert.deepEqual(s.map(x=>[x.text,x.colorClass,x.shouldPulse,x.shouldFlash]),[['-RA ATIS','alert-blue',false,false],['-TSRA PSBL 04 NOV 00-04Z','alert-yellow',true,false]]);
});
test('red current flashes while blue forecast stays steady',()=>{
 const s=resolve({...rain,displayTone:'red',flash:true}, {...forecast,displayTone:'blue',pulse:false},legacy);
 assert.equal(s[0].shouldFlash,true);assert.equal(s[1].shouldPulse,false);assert.equal(s[1].shouldFlash,false);
});
test('reduced motion suppresses both segment effects without changing colors',()=>{
 const s=resolve({...rain,displayTone:'red',flash:true},forecast,{...legacy,reducedMotion:true});
 assert.deepEqual(s.map(x=>[x.colorClass,x.shouldPulse,x.shouldFlash]),[['alert-red',false,false],['alert-yellow',false,false]]);
});
test('legacy summary is retained for old feeds and malformed structured fields',()=>{
 for(const [a,b] of [[undefined,undefined],[null,null],[{},7],[{text:5},{displayText:[]}]] ){
 const s=resolve(a,b,legacy);assert.equal(s.length,1);assert.equal(s[0].text,'-RA ATIS | ⛈️ -TSRA PSBL 04 NOV 00-04Z');assert.equal(s[0].colorClass,'alert-blue');}
});
test('no alert stays hidden and forecast-only works',()=>{
 assert.deepEqual(resolve(rain,forecast,{...legacy,visible:false}),[]);
 assert.deepEqual(resolve(null,null,{text:'NONE'}),[]);
 assert.equal(resolve(forecast,null,legacy)[0].colorClass,'alert-yellow');
});
test('explicit METAR source suffix survives structured normalization unchanged',()=>{
 const primary={displayText:'🌧️ RA METAR',text:'RA METAR',code:'RA',category:'rain',sources:['METAR'],displayTone:'blue',pulse:false,flash:false};
 const s=resolve(primary,forecast,legacy);
 assert.equal(s[0].text,'RA METAR');assert.equal(s[0].icon,'🌧️');assert.equal(s[0].colorClass,'alert-blue');
 assert.equal(s[0].shouldPulse,false);assert.equal(s[0].shouldFlash,false);
 assert.equal(s[1].text,'-TSRA PSBL 04 NOV 00-04Z');
});
