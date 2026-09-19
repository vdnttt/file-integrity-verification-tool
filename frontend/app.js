const $ = (id) => document.getElementById(id);
const LS_BASELINES = 'fit_baselines_v1';
const LS_HISTORY = 'fit_history_v1';

let selectedFiles = [];
let currentRecords = [];
let lastResult = null;
let apiOnline = false;
let serverMode = false;

function loadLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}
function saveLocal(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function uid(prefix='id') { return prefix + '_' + crypto.randomUUID(); }
function fmtBytes(n) {
  if (!Number.isFinite(n)) return '—';
  const units = ['B','KB','MB','GB','TB']; let i=0, x=n;
  while (x >= 1024 && i < units.length-1) { x/=1024; i++; }
  return `${x.toFixed(i ? 1 : 0)} ${units[i]}`;
}
function fmtDate(iso) { try { return new Date(iso).toLocaleString(); } catch { return iso; } }
function setProgress(p, text) { $('progressBar').style.width = `${p}%`; $('progressPct').textContent = `${p}%`; $('progressText').textContent = text; }
function normalizePath(p) { return (p || '').replaceAll('\\','/'); }

async function sha256File(file) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,'0')).join('');
}

async function hashFiles(files) {
  const records = [];
  setProgress(0, `Hashing 0/${files.length}`);
  for (let i=0; i<files.length; i++) {
    const file = files[i];
    const path = normalizePath(file.webkitRelativePath || file.name);
    const hash = await sha256File(file);
    records.push({ path, hash, size: file.size, last_modified: file.lastModified });
    const pct = Math.round(((i+1)/files.length)*100);
    setProgress(pct, `Hashing ${i+1}/${files.length}`);
    if (i % 3 === 0) await new Promise(r => setTimeout(r, 0));
  }
  records.sort((a,b)=>a.path.localeCompare(b.path));
  setProgress(100, `${records.length} file(s) hashed`);
  return records;
}

async function api(path, options={}) {
  const res = await fetch(path, {headers:{'Content-Type':'application/json',...(options.headers||{})}, ...options});
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try { const j = await res.json(); message = j.error || message; } catch {}
    throw new Error(message);
  }
  return res.json();
}

async function detectRuntime() {
  try {
    const h = await api('/api/health');
    apiOnline = !!h.ok;
    serverMode = !!h.cpp_engine;
  } catch { apiOnline = false; serverMode = false; }
  $('modeDot').classList.toggle('online', apiOnline);
  $('modeLabel').textContent = apiOnline ? (serverMode ? 'Local Python + C++ mode' : 'Python backend mode') : 'Cloud / browser mode';
  $('serverScanBtn').disabled = !serverMode;
  $('serverScanBox').classList.toggle('hidden', !serverMode);
}

function getLocalBaselines() { return loadLocal(LS_BASELINES, []); }
function getLocalHistory() { return loadLocal(LS_HISTORY, []); }

async function refreshBaselines() {
  let items;
  if (apiOnline) {
    try { items = await api('/api/baselines'); }
    catch { items = getLocalBaselines(); }
  } else items = getLocalBaselines();
  const select = $('baselineSelect');
  select.innerHTML = '';
  if (!items.length) {
    select.innerHTML = '<option value="">No baselines yet</option>';
    return;
  }
  for (const b of items) {
    const o = document.createElement('option'); o.value = b.id; o.textContent = `${b.name} • ${b.file_count} files • ${fmtDate(b.created_at)}`; select.appendChild(o);
  }
  $('verifyBtn').disabled = currentRecords.length === 0;
}

async function saveBaseline() {
  if (!currentRecords.length) return;
  const name = $('baselineName').value.trim() || 'Project Baseline';
  let baseline;
  if (apiOnline) {
    try { baseline = await api('/api/baselines', {method:'POST',body:JSON.stringify({name, records:currentRecords})}); }
    catch (e) { alert(`Could not save to Python API; saved locally instead.\n${e.message}`); }
  }
  if (!baseline) {
    baseline = {id:uid('base'),name,created_at:new Date().toISOString(),file_count:currentRecords.length,records:currentRecords};
    const data = getLocalBaselines(); data.unshift(baseline); saveLocal(LS_BASELINES,data);
  } else {
    baseline.records = currentRecords;
  }
  await refreshBaselines();
  alert(`Baseline saved: ${baseline.name}\n${currentRecords.length} file(s)`);
}

function compare(baseRecords, curRecords) {
  const base = new Map(baseRecords.map(r=>[normalizePath(r.path),r]));
  const cur = new Map(curRecords.map(r=>[normalizePath(r.path),r]));
  const modified=[],added=[],deleted=[],unchanged=[];
  for (const [path,r] of [...cur.entries()].sort()) {
    const old=base.get(path);
    if (!old) added.push({...r,status:'ADDED'});
    else if ((old.hash||'') !== (r.hash||'')) modified.push({before:old,after:r,status:'MODIFIED'});
    else unchanged.push({...r,status:'UNCHANGED'});
  }
  for (const [path,r] of [...base.entries()].sort()) if (!cur.has(path)) deleted.push({...r,status:'DELETED'});
  return {status:modified.length||added.length||deleted.length?'CHANGES_DETECTED':'PASS',summary:{baseline:baseRecords.length,current:curRecords.length,unchanged:unchanged.length,modified:modified.length,added:added.length,deleted:deleted.length},modified,added,deleted,unchanged,created_at:new Date().toISOString()};
}

async function getSelectedBaseline() {
  const id = $('baselineSelect').value;
  if (!id) return null;
  if (apiOnline) {
    try { return await api(`/api/baselines/${encodeURIComponent(id)}`); } catch {}
  }
  return getLocalBaselines().find(b=>b.id===id) || null;
}

async function verifyCurrent() {
  const baseline = await getSelectedBaseline();
  if (!baseline) { alert('Please create or import a baseline first.'); return; }
  if (!currentRecords.length) { alert('Run a scan first.'); return; }
  let result;
  if (apiOnline && baseline.id && !String(baseline.id).startsWith('base_')) {
    try { result = await api('/api/verify',{method:'POST',body:JSON.stringify({baseline_id:baseline.id,records:currentRecords})}); }
    catch (e) { console.warn(e); }
  }
  if (!result) result = compare(baseline.records, currentRecords), result.baseline_id=baseline.id, result.baseline_name=baseline.name;
  lastResult=result;
  renderResult(result, baseline.name);
  saveHistory({id:uid('hist'),created_at:result.created_at||new Date().toISOString(),baseline_id:baseline.id,baseline_name:baseline.name,status:result.status,summary:result.summary,result});
  await refreshHistory();
  $('exportBtn').disabled=false;
}

function saveHistory(entry) { const h=getLocalHistory(); h.unshift(entry); saveLocal(LS_HISTORY,h.slice(0,50)); }
async function refreshHistory() {
  let list;
  if (apiOnline) {
    try { list=await api('/api/history'); } catch { list=getLocalHistory(); }
  } else list=getLocalHistory();
  const host=$('historyList'); host.innerHTML='';
  if (!list.length) { host.innerHTML='<div class="empty">No history yet.</div>'; return; }
  for (const h of list.slice(0,30)) {
    const div=document.createElement('div'); div.className='history-item';
    div.innerHTML=`<div class="history-top"><span class="history-name"></span><span class="badge ${h.status==='PASS'?'pass':'fail'}">${h.status==='PASS'?'PASS':'CHANGES'}</span></div><div class="history-date">${fmtDate(h.created_at)}</div><div class="history-meta">${escapeHtml(h.baseline_name||'Baseline')} • ${h.summary?.current??0} current • ${h.summary?.modified??0} modified</div>`;
    div.querySelector('.history-name').textContent=h.baseline_name||'Baseline';
    div.addEventListener('click',()=>{
      const full=h.result || h;
      lastResult=full; renderResult(full,full.baseline_name); $('exportBtn').disabled=false;
    });
    host.appendChild(div);
  }
}
function escapeHtml(s) { return String(s).replace(/[&<>'"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

function renderResult(result, baselineName='Baseline') {
  $('resultPanel').classList.remove('hidden');
  $('resultNote').textContent=`${baselineName} • ${result.summary.current} current file(s) compared with ${result.summary.baseline} baseline file(s).`;
  const badge=$('resultBadge'); badge.textContent=result.status==='PASS'?'PASS':'CHANGES DETECTED'; badge.className=`badge ${result.status==='PASS'?'pass':'fail'}`;
  $('findings').innerHTML=`<div class="finding unchanged"><b>${result.summary.unchanged}</b><span>Unchanged</span></div><div class="finding modified"><b>${result.summary.modified}</b><span>Modified</span></div><div class="finding added"><b>${result.summary.added}</b><span>Added</span></div><div class="finding deleted"><b>${result.summary.deleted}</b><span>Deleted</span></div>`;
  // Mark table statuses based on result paths.
  const statusByPath=new Map(); for(const r of result.unchanged||[]) statusByPath.set(normalizePath(r.path),'UNCHANGED'); for(const r of result.added||[]) statusByPath.set(normalizePath(r.path),'ADDED'); for(const r of result.deleted||[]) statusByPath.set(normalizePath(r.path),'DELETED'); for(const r of result.modified||[]) statusByPath.set(normalizePath(r.after.path),'MODIFIED');
  renderRecords(statusByPath);
}

function renderRecords(statusByPath=null) {
  const filter=$('recordFilter').value.toLowerCase().trim();
  const rows=currentRecords.filter(r=>normalizePath(r.path).toLowerCase().includes(filter));
  const body=$('recordsBody'); body.innerHTML='';
  if(!rows.length){body.innerHTML='<tr><td colspan="4" class="empty">No records match the filter.</td></tr>';return;}
  for(const r of rows){
    const status=statusByPath?.get(normalizePath(r.path)) || (lastResult?'UNKNOWN':'SCANNED');
    const tr=document.createElement('tr');
    tr.innerHTML=`<td><strong>${escapeHtml(r.path)}</strong></td><td>${fmtBytes(r.size)}</td><td class="hash">${escapeHtml(r.hash)}</td><td><span class="status-pill ${status.toLowerCase()}">${status}</span></td>`;
    body.appendChild(tr);
  }
}

function updateStats(result=null) {
  $('statScanned').textContent=currentRecords.length;
  $('statUnchanged').textContent=result?.summary?.unchanged ?? 0;
  $('statModified').textContent=result?.summary?.modified ?? 0;
  $('statEdge').textContent=`${result?.summary?.added ?? 0} / ${result?.summary?.deleted ?? 0}`;
}

function loadFiles(fileList) {
  selectedFiles=[...fileList]; $('selectedCount').textContent=`${selectedFiles.length} file${selectedFiles.length===1?'':'s'}`; $('scanBtn').disabled=!selectedFiles.length;
  $('scanBadge').textContent=selectedFiles.length?`${selectedFiles.length} selected`:'Ready'; $('scanBadge').className=`badge ${selectedFiles.length?'neutral':'neutral'}`;
}

async function doScan() {
  try {
    $('scanBtn').disabled=true; $('saveBaseline').disabled=true; $('verifyBtn').disabled=true; lastResult=null; $('resultPanel').classList.add('hidden');
    currentRecords=await hashFiles(selectedFiles); renderRecords(); updateStats(); $('saveBaseline').disabled=currentRecords.length===0; $('verifyBtn').disabled=currentRecords.length===0;
    $('scanBadge').textContent='Scan complete'; $('scanBadge').className='badge pass';
  } catch(e) { alert(`Scan failed: ${e.message}`); setProgress(0,'Failed'); }
  finally { $('scanBtn').disabled=selectedFiles.length===0; }
}

async function runServerScan() {
  const p=$('serverPath').value.trim(); if(!p) return alert('Enter a local folder path.');
  try { $('runServerScan').disabled=true; setProgress(10,'Running C++ scanner…'); const data=await api('/api/server-scan',{method:'POST',body:JSON.stringify({path:p})}); currentRecords=data.files||[]; renderRecords(); updateStats(); setProgress(100,`${currentRecords.length} file(s) hashed by C++`); $('saveBaseline').disabled=false; $('verifyBtn').disabled=false; $('scanBadge').textContent='C++ server scan complete'; $('scanBadge').className='badge pass'; }
  catch(e){alert(`Server scan failed: ${e.message}`);setProgress(0,'Failed');} finally{$('runServerScan').disabled=false;}
}

function exportReport() {
  const payload={tool:'File Integrity Verification Tool',version:'1.0',generated_at:new Date().toISOString(),mode:apiOnline?'python_backend':'browser',algorithm:'SHA-256',current_records:currentRecords,verification:lastResult};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`integrity-report-${new Date().toISOString().replace(/[:.]/g,'-')}.json`; a.click(); URL.revokeObjectURL(a.href);
}

function importBaseline(file) {
  const reader=new FileReader(); reader.onload=()=>{
    try {
      const data=JSON.parse(reader.result); const records=data.records||data.current_records||data.files||[];
      if(!Array.isArray(records)||!records.length) throw new Error('No records array found.');
      const b={id:uid('base'),name:data.name||data.baseline_name||`Imported Baseline ${new Date().toLocaleDateString()}`,created_at:new Date().toISOString(),file_count:records.length,records};
      const all=getLocalBaselines(); all.unshift(b); saveLocal(LS_BASELINES,all); refreshBaselines(); alert(`Imported ${records.length} file record(s).`);
    } catch(e){alert(`Import failed: ${e.message}`)}
  }; reader.readAsText(file);
}

function clearLocalData(){ if(!confirm('Clear baselines and local history stored in this browser?')) return; localStorage.removeItem(LS_BASELINES);localStorage.removeItem(LS_HISTORY);refreshBaselines();refreshHistory(); }
function resetScan(){ selectedFiles=[];currentRecords=[];lastResult=null;$('fileInput').value='';$('folderInput').value='';$('selectedCount').textContent='0 files';$('scanBtn').disabled=true;$('saveBaseline').disabled=true;$('verifyBtn').disabled=true;$('exportBtn').disabled=true;$('resultPanel').classList.add('hidden');$('recordsBody').innerHTML='<tr><td colspan="4" class="empty">No scan yet.</td></tr>';updateStats();setProgress(0,'Idle');$('scanBadge').textContent='Ready';$('scanBadge').className='badge neutral';}

$('fileInput').addEventListener('change',e=>loadFiles(e.target.files));
$('folderInput').addEventListener('change',e=>loadFiles(e.target.files));
$('clearSelection').addEventListener('click',resetScan);
$('scanBtn').addEventListener('click',doScan);
$('saveBaseline').addEventListener('click',saveBaseline);
$('verifyBtn').addEventListener('click',verifyCurrent);
$('exportBtn').addEventListener('click',exportReport);
$('recordFilter').addEventListener('input',()=>renderRecords());
$('serverScanBtn').addEventListener('click',()=>{$('serverScanBox').classList.toggle('hidden')});
$('runServerScan').addEventListener('click',runServerScan);
$('newScanBtn').addEventListener('click',resetScan);
$('importBtn').addEventListener('click',()=>$('importInput').click());
$('importInput').addEventListener('change',e=>{if(e.target.files[0]) importBaseline(e.target.files[0]);e.target.value='';});
$('clearDataBtn').addEventListener('click',clearLocalData);
$('themeBtn').addEventListener('click',()=>{const dark=document.documentElement.getAttribute('data-theme')==='dark';document.documentElement.setAttribute('data-theme',dark?'light':'dark');localStorage.setItem('fit_theme',dark?'light':'dark');$('themeBtn').textContent=dark?'☾':'☀';});

(function initTheme(){const t=localStorage.getItem('fit_theme');if(t){document.documentElement.setAttribute('data-theme',t);$('themeBtn').textContent=t==='dark'?'☀':'☾';}})();

(async function init(){await detectRuntime();await refreshBaselines();await refreshHistory();updateStats();})();
