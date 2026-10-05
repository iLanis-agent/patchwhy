const F=require('./engine.js'),cp=require('child_process'),fs=require('fs'),os=require('os'),path=require('path');
let seed=31337;const rnd=n=>{seed=(seed*1103515245+12345)&0x7fffffff;return (seed>>8)%n};const pick=a=>a[rnd(a.length)];
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pw-'));
const W=['alpha','beta','gamma','delta','x = 1','return x','}','{','','  indent','foo(bar)','TODO','end','a','b'];
function file(n){const a=[];for(let i=0;i<n;i++)a.push(pick(W)+(rnd(4)?'':' '+i));return a}
function edit(a){const b=a.slice();let k=1+rnd(4);while(k--){const r=rnd(3),p=rnd(b.length+1);if(r===0)b.splice(p,0,'new'+rnd(100));else if(r===1&&b.length>1)b.splice(Math.min(p,b.length-1),1);else if(b.length)b[Math.min(p,b.length-1)]='chg'+rnd(100)}return b}
const toText=(a,eol)=>a.join('\n')+(a.length&&eol?'\n':'');
let n=0,bad=[],ok_both=0,fail_both=0,cnt=0,cntbad=0;
for(let i=0;i<1500;i++){
  const a=file(2+rnd(30)),b=edit(a),ea=rnd(5)>0,eb=rnd(5)>0,A=toText(a,ea),B=toText(b,eb);
  if(A===B)continue;
  fs.writeFileSync(dir+'/a.txt',A);fs.writeFileSync(dir+'/b.txt',B);
  const ctx=pick([0,1,3,5]);
  let d=cp.spawnSync('diff',['-U'+ctx,'a.txt','b.txt'],{cwd:dir,encoding:'utf8'}).stdout;
  if(!d)continue;
  const p=F.parse(d);
  // counts must be consistent for a real diff
  cnt++;if(p.issues.some(x=>x.lvl==='err')){cntbad++;bad.push(['false count error',i,p.issues[0].msg])}
  // case 1: apply to original -> must equal B
  let r=F.apply(A,p.files[0]);n++;
  if(!r.ok||r.text!==B)bad.push(['apply orig',i,ctx,r.ok,r.ok?JSON.stringify(r.text.slice(0,60)):r.results]);
  // case 2: apply to a mutated original; compare success and result with GNU patch --fuzz=0
  const a2=a.slice();if(a2.length){const k=rnd(a2.length);const m=rnd(3);if(m===0)a2[k]='MUTATED';else if(m===1)a2.splice(k,0,'EXTRA');else if(a2.length>2)a2.splice(k,1)}
  const A2=toText(a2,ea);fs.writeFileSync(dir+'/t.txt',A2);fs.writeFileSync(dir+'/p.diff',d);
  const pr=cp.spawnSync('patch',['--fuzz=0','--no-backup-if-mismatch','-s','-r','/dev/null','t.txt','p.diff'],{cwd:dir,encoding:'utf8'});
  const gnuOk=pr.status===0,gnuText=gnuOk?fs.readFileSync(dir+'/t.txt','utf8'):null;
  const r2=F.apply(A2,p.files[0]);n++;
  if(gnuOk!==r2.ok){bad.push(['patch vs engine ok flag',i,ctx,'gnu',gnuOk,'mine',r2.ok])}
  else if(gnuOk&&gnuText!==r2.text)bad.push(['patch vs engine text',i,ctx,JSON.stringify(gnuText.slice(0,80)),JSON.stringify(r2.text.slice(0,80))]);
  else if(gnuOk)ok_both++;else fail_both++;
  // case 3: corrupt a hunk length; engine must flag it
  const bd=d.replace(/^(@@ -\d+),(\d+)/m,(m,x,y)=>x+','+(+y+1));
  if(bd!==d){n++;const pb=F.parse(bd);if(!pb.issues.some(x=>x.lvl==='err'))bad.push(['missed corrupt count',i])}
}
console.log('diffs',cnt,'checks',n,'both-applied',ok_both,'both-rejected',fail_both,'false count errors',cntbad,'discrepancies',bad.length);
if(bad.length)console.log(JSON.stringify(bad.slice(0,6)).slice(0,1800));
process.exit(bad.length?1:0);
