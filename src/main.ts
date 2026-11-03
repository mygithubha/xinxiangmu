import "./style.css";
type Unit = { title: string; filename: string };
type Cue = { time: number; text: string };
const SOURCES = ["https://nce.mleo.site", "https://85.mleo.site"];
const BOOKS = [1,2,3,4];
const $ = (s: string) => document.querySelector(s) as HTMLElement;
let book = 1, units: Unit[] = [], unitIndex = 0, cues: Cue[] = [], activeCue = -1, selectedCue = 0, sentenceLoopEnd: number | null = null;
let mode = "listen", mediaRecorder: MediaRecorder | null = null, recording: Blob[] = [], recordingUrl = "", sourceRoot = SOURCES[0];
const state = { translated: false, hideText: false, speed: 1, repeat: false };
const PROGRESS_KEY = "english-lab-progress-v1";
const MASTERED_KEY = "english-lab-mastered-v1";
type MasteredMap = Record<string, number[]>;
function getMasteredMap(): MasteredMap { try { return JSON.parse(localStorage.getItem(MASTERED_KEY) || "{}") as MasteredMap; } catch { return {}; } }
function lessonKey() { return book + ":" + filename(); }
function masteredForLesson() { return getMasteredMap()[lessonKey()] || []; }
function toggleMastered(index: number) {
  const all = getMasteredMap(), list = new Set(all[lessonKey()] || []);
  if(list.has(index)) list.delete(index); else list.add(index);
  all[lessonKey()] = [...list].sort((a,b)=>a-b);
  localStorage.setItem(MASTERED_KEY, JSON.stringify(all)); renderLesson();
}
function renderMastery() {
  const done = masteredForLesson().length, total = cues.length;
  const el = $("#masterySummary");
  if(el) el.innerHTML = total ? `<div class="mastery-line"><span>本课掌握进度</span><strong>${done}/${total} 句 · ${Math.round(done/total*100)}%</strong></div><div class="mastery-track"><i style="width:${done/total*100}%"></i></div>` : "字幕载入后即可记录逐句掌握情况";
}
type Progress = { version: number; book: number; unitIndex: number; mode: string; speed: number; repeat: boolean; hideText: boolean; mastered?: MasteredMap; updatedAt: string };
function readProgress(): Partial<Progress> {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}") as Partial<Progress>; }
  catch { return {}; }
}
function saveProgress() {
  const data: Progress = { version: 1, book, unitIndex, mode, speed: state.speed, repeat: state.repeat, hideText: state.hideText, updatedAt: new Date().toISOString() };
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(data)); } catch { notify("本机存储不可用，进度暂时无法自动保存。"); }
}
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]!));
const filename = () => units[unitIndex]?.filename ?? "";
const base = () => sourceRoot + "/NCE" + book + "/";
const audioUrl = () => base() + encodeURIComponent(filename()) + ".mp3";
const lrcUrl = () => base() + encodeURIComponent(filename()) + ".lrc";
function parseLrc(raw: string): Cue[] {
  const out: Cue[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)$/);
    if (m && m[4].trim()) out.push({time:Number(m[1])*60+Number(m[2])+Number("0."+(m[3]||"0")),text:m[4].trim()});
  }
  return out.sort((a,b)=>a.time-b.time);
}
async function fetchText(url: string) {
  const r = await fetch(url, {cache:"no-store"});
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.text();
}
async function loadBook(n: number, targetIndex = 0) {
  const status = $("#status"); status.textContent = "正在连接课程资源…";
  let last: unknown;
  for (const root of SOURCES) {
    try {
      const data = JSON.parse(await fetchText(root + "/NCE" + n + "/book.json"));
      const list = Array.isArray(data) ? data : data.units;
      if (!Array.isArray(list)) throw new Error("目录格式不符合预期");
      sourceRoot = root; book = n; units = list; unitIndex = Math.max(0, Math.min(targetIndex, units.length - 1));
      await loadLesson(); render();
      status.textContent = "课程目录已连接 · " + root.replace("https://","");
      return;
    } catch(e) { last = e; }
  }
  status.textContent = "资源连接失败：" + String(last) + "。可能是跨域限制或资源服务器暂不可用。";
}
async function loadLesson() {
  cues = []; activeCue = -1; selectedCue = 0; sentenceLoopEnd = null;
  try { cues = parseLrc(await fetchText(lrcUrl())); }
  catch { $("#status").textContent = "字幕暂时无法读取（可能是 CORS 限制）；音频仍可尝试播放。"; }
  const a = $("#audioPlayer") as HTMLAudioElement; a.pause(); a.src = audioUrl(); a.load();
  a.playbackRate = state.speed;
  a.ontimeupdate = syncCue;
  a.onended = () => { if(state.repeat) { a.currentTime=0; void a.play(); } };
  renderLesson();
}
function syncCue() {
  const a = $("#audioPlayer") as HTMLAudioElement;
  if(sentenceLoopEnd !== null && a.currentTime >= sentenceLoopEnd) {
    a.pause(); a.currentTime = Math.max(0, sentenceLoopEnd - 0.08); sentenceLoopEnd = null;
  }
  let idx = -1;
  for(let i=0;i<cues.length;i++){ if(cues[i].time <= a.currentTime) idx=i; else break; }
  if(idx!==activeCue){ activeCue=idx; if(idx>=0) selectedCue=idx; document.querySelectorAll(".cue-row").forEach((el,i)=>el.classList.toggle("active",i===idx)); renderFocusCue(); }
}
function renderFocusCue() {
  const label = $("#focusCueText");
  if(label) label.textContent = cues[selectedCue]?.text || "请先载入课文字幕";
  const prev = $("#prevCue") as HTMLButtonElement | null, next = $("#nextCue") as HTMLButtonElement | null, replay = $("#replayCue") as HTMLButtonElement | null;
  if(prev) prev.disabled = selectedCue <= 0;
  if(next) next.disabled = selectedCue >= cues.length - 1;
  if(replay) replay.disabled = !cues.length;
}
function playSentence(index = selectedCue) {
  if(!cues.length || !cues[index]) { notify("当前课文没有可用字幕，无法逐句播放。"); return; }
  const a = $("#audioPlayer") as HTMLAudioElement;
  selectedCue = Math.max(0, Math.min(index, cues.length - 1));
  const nextTime = cues[selectedCue + 1]?.time;
  sentenceLoopEnd = nextTime ?? (Number.isFinite(a.duration) && a.duration > cues[selectedCue].time ? a.duration : null);
  a.currentTime = cues[selectedCue].time;
  activeCue = selectedCue;
  document.querySelectorAll(".cue-row").forEach((el,i)=>el.classList.toggle("active",i===selectedCue));
  renderFocusCue();
  void a.play().catch(()=>notify("播放失败，请检查网络或资源地址。"));
}
function render() {
  $("#bookSelect").innerHTML = BOOKS.map(n=>`<option value="${n}" ${n===book?"selected":""}>第 ${n} 册</option>`).join("");
  $("#lessonSelect").innerHTML = units.map((u,i)=>`<option value="${i}" ${i===unitIndex?"selected":""}>${esc(u.title)}</option>`).join("");
  renderLesson();
}
function renderLesson() {
  $("#lessonName").textContent = units[unitIndex]?.title ?? "选择课程";
  $("#cueList").innerHTML = cues.length ? cues.map((c,i)=>`<div class="cue-row ${i===activeCue?"active":""}"><button class="cue" data-cue="${i}"><span class="cue-time">${Math.floor(c.time/60)}:${String(Math.floor(c.time%60)).padStart(2,"0")}</span><span>${esc(c.text)}</span></button><button class="master-btn ${masteredForLesson().includes(i)?"done":""}" data-master="${i}" aria-label="标记掌握">${masteredForLesson().includes(i)?"已掌握":"掌握"}</button></div>`).join("") : '<div class="empty">字幕尚未载入。你仍可播放音频，或导入自己的 LRC 文件。</div>';
  $("#audioSource").textContent = filename() ? "音频资源已就绪" : "等待选择课文";
  renderMastery();
  renderFocusCue();
  $("#repeatBtn").classList.toggle("selected",state.repeat);
  $("#translationBtn").classList.toggle("selected",state.translated);
  $("#hideBtn").classList.toggle("selected",state.hideText);
  renderMode();
}
function renderMode() {
  document.querySelectorAll(".mode").forEach(el=>el.classList.toggle("selected",el.getAttribute("data-mode")===mode));
  const descriptions: Record<string,string> = {
    listen:"先不看文字，完整听一遍；第二遍再逐句核对。", speak:"听一句、暂停、模仿，再录下自己的声音回听。", read:"逐句理解课文；先尝试自己理解，再查看辅助信息。", write:"听写训练：播放原声后，在下方输入你听到的句子。"
  };
  $("#modeHint").textContent = descriptions[mode];
  $("#writePanel").hidden = mode!=="write"; $("#recordPanel").hidden = mode!=="speak";
  $("#cueList").classList.toggle("text-hidden",state.hideText && mode==="listen");
}
function notify(s:string){ $("#status").textContent=s; }
function download(name:string, data:string){ const a=document.createElement("a"); const u=URL.createObjectURL(new Blob([data],{type:"application/json"})); a.href=u;a.download=name;a.click();URL.revokeObjectURL(u); }
function bind() {
  $("#bookSelect").addEventListener("change",e=>void loadBook(Number((e.target as HTMLSelectElement).value)));
  $("#lessonSelect").addEventListener("change",async e=>{unitIndex=Number((e.target as HTMLSelectElement).value);await loadLesson();render();saveProgress();});
  $("#prev").addEventListener("click",async()=>{if(unitIndex>0){unitIndex--;await loadLesson();render();saveProgress();}});
  $("#next").addEventListener("click",async()=>{if(unitIndex<units.length-1){unitIndex++;await loadLesson();render();saveProgress();}});
  document.querySelectorAll(".mode").forEach(el=>el.addEventListener("click",()=>{mode=el.getAttribute("data-mode")||"listen";renderMode();saveProgress();}));
  $("#prevCue").addEventListener("click",()=>playSentence(selectedCue-1));
  $("#nextCue").addEventListener("click",()=>playSentence(selectedCue+1));
  $("#replayCue").addEventListener("click",()=>playSentence(selectedCue));
  $("#play").addEventListener("click",()=>{ sentenceLoopEnd=null;const a=$("#audioPlayer") as HTMLAudioElement;if(a.paused)void a.play().catch(()=>notify("播放失败，请检查网络或资源地址。"));else a.pause();});
  $("#speed").addEventListener("change",e=>{state.speed=Number((e.target as HTMLSelectElement).value);($("#audioPlayer") as HTMLAudioElement).playbackRate=state.speed;saveProgress();});
  $("#repeatBtn").addEventListener("click",()=>{state.repeat=!state.repeat;renderLesson();saveProgress();});
  $("#translationBtn").addEventListener("click",()=>{state.translated=!state.translated;notify(state.translated?"已开启翻译辅助开关；当前 LRC 如含双语将一并显示。":"已关闭翻译辅助。");renderLesson();});
  $("#hideBtn").addEventListener("click",()=>{state.hideText=!state.hideText;renderMode();saveProgress();});
  $("#cueList").addEventListener("click",e=>{
    const target=e.target as HTMLElement;
    const mastered=target.closest("[data-master]") as HTMLElement|null;
    if(mastered){toggleMastered(Number(mastered.dataset.master));return;}
    const b=target.closest("[data-cue]") as HTMLElement|null; const a=$("#audioPlayer") as HTMLAudioElement;
    if(!b)return; const i=Number(b.dataset.cue); selectedCue=i; sentenceLoopEnd=null; a.currentTime=cues[i].time; activeCue=i; void a.play(); syncCue(); renderFocusCue();
  });
  $("#checkWrite").addEventListener("click",()=>{const i=selectedCue;const expected=cues[i]?.text||"";const got=($("#writeAnswer") as HTMLTextAreaElement).value.trim();$("#writeFeedback").textContent=expected?(got.toLowerCase()===expected.toLowerCase()?"正确！拼写和内容匹配。":"请对照原句检查拼写与标点："+expected):"当前字幕不可用，暂时无法自动核对。";});
  $("#record").addEventListener("click",async()=>{if(mediaRecorder?.state==="recording"){mediaRecorder.stop();$("#record").textContent="开始录音";return;}try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});mediaRecorder=new MediaRecorder(stream);recording=[];mediaRecorder.ondataavailable=e=>recording.push(e.data);mediaRecorder.onstop=()=>{if(recordingUrl)URL.revokeObjectURL(recordingUrl);recordingUrl=URL.createObjectURL(new Blob(recording,{type:mediaRecorder?.mimeType||"audio/webm"}));($("#myRecording") as HTMLAudioElement).src=recordingUrl;stream.getTracks().forEach(t=>t.stop());notify("录音完成，可以回听。");};mediaRecorder.start();$("#record").textContent="停止录音";}catch{notify("无法访问麦克风，请允许录音权限，并使用 HTTPS。");}});
  $("#export").addEventListener("click",()=>{saveProgress();download("english-lab-progress.json",JSON.stringify({version:1,book,unitIndex,mode,speed:state.speed,repeat:state.repeat,hideText:state.hideText,mastered:getMasteredMap(),exportedAt:new Date().toISOString()},null,2));});
  $("#importBackup").addEventListener("change",async e=>{
    const file=(e.target as HTMLInputElement).files?.[0]; if(!file)return;
    try {
      const data=JSON.parse(await file.text()) as Partial<Progress>;
      if(![1,2,3,4].includes(Number(data.book))) throw new Error("备份文件中的册数无效");
      book=Number(data.book); mode=["listen","speak","read","write"].includes(String(data.mode))?String(data.mode):"listen";
      state.speed=[0.75,0.85,1,1.15,1.25].includes(Number(data.speed))?Number(data.speed):1;
      state.repeat=Boolean(data.repeat); state.hideText=Boolean(data.hideText);
      if(data.mastered && typeof data.mastered==="object") localStorage.setItem(MASTERED_KEY,JSON.stringify(data.mastered));
      ($("#speed") as HTMLSelectElement).value=String(state.speed);
      await loadBook(book,Number(data.unitIndex)||0);
      renderMode(); saveProgress(); notify("备份已恢复，已载入对应课程和训练设置。");
    } catch(err) { notify("恢复失败："+String(err)); }
    (e.target as HTMLInputElement).value="";
  });
  $("#importLrc").addEventListener("change",async e=>{const f=(e.target as HTMLInputElement).files?.[0];if(f){cues=parseLrc(await f.text());activeCue=-1;renderLesson();notify("已载入本地 LRC 字幕。");}});
}
document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
<header class="top"><div class="brand"><div class="mark">E</div><div><strong>ENGLISH LAB</strong><small>英语综合训练室</small></div></div><div class="backup-actions"><button id="export" class="ghost">导出备份 ↗</button><label class="ghost restore">恢复备份<input id="importBackup" type="file" accept=".json,application/json"></label></div></header>
<main><section class="welcome"><div><span class="eyebrow">LISTEN · SPEAK · READ · WRITE</span><h1>把英语，练成自己的能力。</h1><p>以真实课文为材料，完成从听懂到表达的训练。</p></div><div class="orb">Aa</div></section>
<section class="course panel"><div class="section-head"><div><span class="eyebrow">YOUR COURSE</span><h2>课程资源</h2></div><span class="live-dot">资源直连</span></div><div class="selectors"><label>教材册<select id="bookSelect"><option>加载中</option></select></label><label>当前课文<select id="lessonSelect"><option>加载中</option></select></label></div><div class="lesson-row"><div><small>NOW STUDYING</small><h3 id="lessonName">正在读取课程…</h3><p id="audioSource">等待资源连接</p></div><div class="arrows"><button id="prev">←</button><button id="next">→</button></div></div><audio id="audioPlayer" preload="none"></audio><div class="player"><button id="play" class="play">▶</button><div class="player-meta"><strong>课文原声</strong><small>来自现有 NCE 资源库</small></div><label class="speed">语速<select id="speed"><option value="0.75">0.75×</option><option value="0.85">0.85×</option><option value="1" selected>1.0×</option><option value="1.15">1.15×</option><option value="1.25">1.25×</option></select></label></div><div class="player-tools"><button id="repeatBtn">↻ 单曲循环</button><button id="hideBtn">◉ 隐藏文字</button><button id="translationBtn">文 翻译辅助</button><label class="import">导入 LRC<input id="importLrc" type="file" accept=".lrc,.txt"></label></div></section>
<section class="practice"><div class="section-head"><div><span class="eyebrow">TRAINING MODES</span><h2>选择训练方式</h2></div></div><div class="mode-grid"><button class="mode selected" data-mode="listen"><span>耳</span><b>听力训练</b><small>盲听 · 逐句精听</small></button><button class="mode" data-mode="speak"><span>声</span><b>口语跟读</b><small>模仿 · 录音回听</small></button><button class="mode" data-mode="read"><span>读</span><b>阅读理解</b><small>逐句 · 理解</small></button><button class="mode" data-mode="write"><span>写</span><b>听写训练</b><small>拼写 · 即时核对</small></button></div></section>
<section class="panel training"><div class="section-head"><div><span class="eyebrow">PRACTICE ROOM</span><h2>逐句训练</h2></div><span class="pill">听 → 说 → 读 → 写</span></div><p id="modeHint" class="hint">先不看文字，完整听一遍；第二遍再逐句核对。</p><div id="masterySummary" class="mastery-summary"></div><div class="focus-practice"><div class="focus-caption"><small>当前练习句</small><strong id="focusCueText">正在载入字幕…</strong></div><div class="focus-actions"><button id="prevCue" type="button">上一句</button><button id="replayCue" type="button" class="focus-primary">↻ 重播本句</button><button id="nextCue" type="button">下一句</button></div></div><div id="cueList" class="cue-list"><div class="empty">正在载入字幕…</div></div><div id="recordPanel" hidden class="tool-panel"><p>选中一句，播放并模仿，然后录下自己的声音。</p><button id="record" class="primary">开始录音</button><audio id="myRecording" controls></audio></div><div id="writePanel" hidden class="tool-panel"><p>先播放当前句子，再凭记忆写出英文。</p><textarea id="writeAnswer" placeholder="Write what you hear…"></textarea><button id="checkWrite" class="primary">核对听写</button><p id="writeFeedback" class="feedback"></p></div></section>
<div id="status" class="status">正在初始化…</div><footer>个人学习工具 · 课程音频与字幕由外部资源服务器提供</footer></main>`;
const saved = readProgress();
if([1,2,3,4].includes(Number(saved.book))) book=Number(saved.book);
if(["listen","speak","read","write"].includes(String(saved.mode))) mode=String(saved.mode);
if([0.75,0.85,1,1.15,1.25].includes(Number(saved.speed))) state.speed=Number(saved.speed);
state.repeat=Boolean(saved.repeat); state.hideText=Boolean(saved.hideText);
($("#speed") as HTMLSelectElement).value=String(state.speed);
bind(); void loadBook(book,Number(saved.unitIndex)||0);
