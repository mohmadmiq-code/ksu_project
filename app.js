// === CONFIG ===
const API_URL = "https://ksu-stat102-ai.mohmadmiq.workers.dev/api/ask";

const chatBody = document.getElementById("chatBody");
const form = document.getElementById("chatForm");
const q = document.getElementById("q");
const sendBtn = document.getElementById("send");
const btnMic = document.getElementById("btnMic");
const btnClear = document.getElementById("btnClear");
const ttsToggle = document.getElementById("ttsToggle");
const modeSelect = document.getElementById("modeSelect");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");

let history = [];

// restore mode
try{
  const savedMode = localStorage.getItem("ksu_mode");
  if(savedMode && modeSelect) modeSelect.value = savedMode;
  modeSelect && modeSelect.addEventListener("change", () => {
    localStorage.setItem("ksu_mode", modeSelect.value);
  });
}catch(e){}
let recognizing = false;
let recognition = null;

function setStatus(ok){
  const dot = statusDot.querySelector(".dot");
  if(ok){
    dot.classList.remove("off");
    statusText.textContent = "متصل";
  } else {
    dot.classList.add("off");
    statusText.textContent = "غير متصل";
  }
}

function nowTime(){
  const d = new Date();
  const hh = String(d.getHours()).padStart(2,"0");
  const mm = String(d.getMinutes()).padStart(2,"0");
  return `${hh}:${mm}`;
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}

function renderMath(container){
  if (window.renderMathInElement) {
    window.renderMathInElement(container, {
      delimiters: [
        {left: "\\[", right: "\\]", display: true},
        {left: "\\(", right: "\\)", display: false}
      ],
      throwOnError: false
    });

    // Ensure formulas are displayed left-to-right even inside RTL bubbles.
    container.querySelectorAll('.katex, .katex-display, .katex-html').forEach(el => {
      el.setAttribute('dir', 'ltr');
      el.style.unicodeBidi = 'isolate';
    });
  }
}

// Minimal, safe Markdown renderer (headings, bold, lists, tables, fenced code).
// We keep it small and dependency-free for GitHub Pages.
function renderMarkdown(md){
  const input = String(md || "").replace(/\r\n/g, "\n");

  // Extract fenced code blocks first.
  const codeBlocks = [];
  let working = input.replace(/```([\s\S]*?)```/g, (_, code) => {
    const id = codeBlocks.length;
    codeBlocks.push(code);
    return `@@CODEBLOCK_${id}@@`;
  });

  const lines = working.split("\n");
  let i = 0;
  let html = "";

  function inline(s){
    // escape then apply **bold**
    let out = escapeHtml(s);
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return out;
  }

  while(i < lines.length){
    // Tables: header row + separator row
    if(lines[i].includes("|") && i+1 < lines.length && /^\s*\|?\s*[-:]+/.test(lines[i+1])){
      const header = lines[i].trim();
      const sep = lines[i+1].trim();
      if(header.includes("|") && sep.includes("-")){
        const rows = [header];
        i += 2;
        while(i < lines.length && lines[i].includes("|")){
          rows.push(lines[i].trim());
          i += 1;
        }
        const cells = (row) => row.replace(/^\|/,'').replace(/\|$/,'').split('|').map(c=>c.trim());
        const headCells = cells(rows[0]);
        html += '<div class="table-wrap"><table class="md-table"><thead><tr>' + headCells.map(c=>`<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>';
        for(let r=2; r<rows.length; r++){
          const rowCells = cells(rows[r]);
          html += '<tr>' + rowCells.map(c=>`<td>${inline(c)}</td>`).join('') + '</tr>';
        }
        html += '</tbody></table></div>';
        continue;
      }
    }

    const line = lines[i];

    // Code block placeholder
    const mCode = line.match(/^@@CODEBLOCK_(\d+)@@$/);
    if(mCode){
      const code = codeBlocks[Number(mCode[1])] || "";
      html += `<pre class="code"><code>${escapeHtml(code.trimEnd())}</code></pre>`;
      i += 1;
      continue;
    }

    // Headings
    const mH = line.match(/^(#{1,4})\s+(.*)$/);
    if(mH){
      const level = mH[1].length;
      html += `<h${level} class="md-h">${inline(mH[2])}</h${level}>`;
      i += 1;
      continue;
    }

    // Unordered list
    if(/^\s*-\s+/.test(line)){
      html += '<ul class="md-ul">';
      while(i < lines.length && /^\s*-\s+/.test(lines[i])){
        html += `<li>${inline(lines[i].replace(/^\s*-\s+/, ''))}</li>`;
        i += 1;
      }
      html += '</ul>';
      continue;
    }

    // Ordered list
    if(/^\s*\d+\.\s+/.test(line)){
      html += '<ol class="md-ol">';
      while(i < lines.length && /^\s*\d+\.\s+/.test(lines[i])){
        html += `<li>${inline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`;
        i += 1;
      }
      html += '</ol>';
      continue;
    }

    // Empty line => paragraph break
    if(line.trim() === ""){
      html += '<div class="md-gap"></div>';
      i += 1;
      continue;
    }

    // Paragraph
    let para = line;
    i += 1;
    while(i < lines.length && lines[i].trim() !== "" && !lines[i].match(/^(#{1,4})\s+/) && !lines[i].match(/^\s*-\s+/) && !lines[i].match(/^\s*\d+\.\s+/) && !lines[i].match(/^@@CODEBLOCK_\d+@@$/)){
      // stop before table
      if(lines[i].includes('|') && i+1 < lines.length && /^\s*\|?\s*[-:]+/.test(lines[i+1])) break;
      para += "\n" + lines[i];
      i += 1;
    }
    html += `<p class="md-p">${inline(para).replace(/\n/g,'<br>')}</p>`;
  }

  return html;
}

function addMessage(role, text, refs){
  const wrap = document.createElement("div");
  wrap.className = `msg ${role === "user" ? "user" : "bot"}`;

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  const content = document.createElement("div");
  content.className = "content";
  content.innerHTML = renderMarkdown(text || "");
  bubble.innerHTML = "";
  bubble.appendChild(content);

  wrap.appendChild(bubble);

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.innerHTML = `<span>${nowTime()}</span>`;

  if (role !== "user") {
    const btnCopy = document.createElement("button");
    btnCopy.className = "pill";
    btnCopy.type = "button";
    btnCopy.textContent = "نسخ";
    btnCopy.onclick = async () => {
      try{ await navigator.clipboard.writeText(text); btnCopy.textContent = "تم"; setTimeout(()=>btnCopy.textContent="نسخ",1200); }catch(e){}
    };

    const btnRead = document.createElement("button");
    btnRead.className = "pill";
    btnRead.type = "button";
    btnRead.textContent = "قراءة";
    btnRead.onclick = () => speak(text);

    meta.appendChild(btnCopy);
    meta.appendChild(btnRead);
  }

  bubble.appendChild(meta);

  chatBody.appendChild(wrap);
  chatBody.scrollTop = chatBody.scrollHeight;

  renderMath(bubble);

  return bubble;
}


function animateReveal(bubble, markdown){
  const raw = String(markdown || "");
  bubble.innerHTML = "";
  // عرض تدريجي كأن النظام يكتب، ثم نعيد رندر الماركداون + المعادلات
  let i = 0;
  const step = Math.max(1, Math.floor(raw.length / 160));
  const timer = setInterval(()=>{
    i = Math.min(raw.length, i + step);
    bubble.textContent = raw.slice(0, i);
    chatBody.scrollTop = chatBody.scrollHeight;
    if(i >= raw.length){
      clearInterval(timer);
      bubble.innerHTML = renderMarkdown(raw);
      renderMath(bubble);
    }
  }, 12);
}

function speak(text){
  if(!ttsToggle.checked) return;
  if(!("speechSynthesis" in window)) return;
  try{
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ar-SA";
    window.speechSynthesis.speak(u);
  }catch(e){}
}

async function ask(message){
  addMessage("user", message);

  history.push({ role:"user", content: message });
  history = history.slice(-10);

  sendBtn.disabled = true;

  // فقاعة مساعد مؤقتة (تظهر فوراً)
  const pending = addMessage("bot", "...", []);

  try{
    const mode = (modeSelect && modeSelect.value) ? modeSelect.value : "auto";
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ message, history, mode })
    });

    let data = null;
    try{ data = await res.json(); }catch(e){ data = null; }

    if(!res.ok){
      setStatus(false);
      const msg = data && data.error ? ("خطأ: " + data.error) : ("حدث خطأ في الاتصال ("+res.status+").");
      pending.textContent = msg;
      sendBtn.disabled = false;
      return;
    }

    setStatus(true);

    if(!data || !data.ok){
      const msg = data && data.error ? ("تعذّر إتمام الطلب: " + data.error) : "تعذّر إتمام الطلب. حاول مرة أخرى.";
      pending.textContent = msg;
      sendBtn.disabled = false;
      return;
    }

    let answer = String(data.text || "").trim() || "لم يتم توليد إجابة.";
    animateReveal(pending, answer);

    history.push({ role:"assistant", content: answer });
    history = history.slice(-10);

    speak(answer);
  }catch(e){
    setStatus(false);
    pending.textContent = "حدث خطأ غير متوقع. حاول مرة أخرى.";
  }finally{
    sendBtn.disabled = false;
  }
}


form.addEventListener("submit", (ev)=>{
  ev.preventDefault();
  const msg = q.value.trim();
  if(!msg) return;
  q.value = "";
  ask(msg);
});

document.querySelectorAll(".quick").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const msg = btn.getAttribute("data-q");
    if(msg) ask(msg);
  });
});

btnClear.addEventListener("click", ()=>{
  chatBody.innerHTML = "";
  history = [];
  window.speechSynthesis?.cancel?.();
  addMessage("bot", "جاهز. اكتب سؤالك.");
});

function setupSpeech(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR) {
    btnMic.disabled = true;
    btnMic.title = "المتصفح لا يدعم التعرف على الصوت";
    return;
  }
  recognition = new SR();
  recognition.lang = "ar-SA";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = ()=>{
    recognizing = true;
    btnMic.querySelector("span:last-child").textContent = "استمع…";
  };
  recognition.onend = ()=>{
    recognizing = false;
    btnMic.querySelector("span:last-child").textContent = "تحدث";
  };
  recognition.onresult = (event)=>{
    const transcript = event.results?.[0]?.[0]?.transcript || "";
    const msg = transcript.trim();
    if(msg) ask(msg);
  };
}

btnMic.addEventListener("click", ()=>{
  if(!recognition) return;
  if(recognizing){ recognition.stop(); return; }
  try{ recognition.start(); }catch(e){}
});

window.addEventListener("load", ()=>{
  addMessage("bot", "مرحبًا. اسأل أي سؤال متعلق بدرس 3.1.");
  setupSpeech();
  setStatus(true);
});
