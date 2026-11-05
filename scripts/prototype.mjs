import { readFileSync, writeFileSync } from "node:fs";
const root = new URL("../", import.meta.url);
const tokens = readFileSync(new URL("src/styles/tokens.css", root), "utf8");
const css = readFileSync(new URL("src/styles/workspace.css", root), "utf8");
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Maia 个人工作空间 · 交互原型</title><style>/* Generated from src/styles: pnpm prototype */\n${tokens}\n${css}</style></head><body>
<a class="skip" href="#main">跳到主要内容</a><header class="topbar"><div class="topbar-inner"><div class="brand"><span class="brand-mark" aria-hidden="true">M</span><span>Maia</span></div><button id="logout">退出登录</button></div></header>
<main id="main" tabindex="-1"><label>预览状态 <select id="state"><option value="ready">正常</option><option value="empty">空</option><option value="loading">加载</option><option value="error">错误</option><option value="degraded">降级</option><option value="forbidden">无权</option><option value="signed-out">未登录</option><option value="logout-pending">退出核实中</option><option value="logout-unknown">退出待核实</option></select></label><p class="footnote">原型使用示例账号，仅预览界面；真实登录请打开 Sage。</p><div id="view"></div></main>
<script>
const selector=document.getElementById('state'),view=document.getElementById('view');
const intro='<section class="intro"><h1>个人工作空间</h1><p>属于你自己的办公空间。在这里查看成员与自己的身份。</p><div class="context"><span class="pill">lin · 本人</span><span class="pill">管理者</span></div></section>';
const heading='<div class="panel-heading"><h2 id="members-title">空间成员</h2><button data-refresh>刷新成员</button></div>';
function render(){let s=selector.value;document.getElementById('logout').hidden=!['ready','empty','loading','degraded','error'].includes(s);let content='';if(s==='ready')content='<div class="table-scroll"><table><thead><tr><th scope="col">成员</th><th scope="col">角色</th></tr></thead><tbody><tr><td><span class="member-name">lin</span><span class="self">本人</span></td><td class="role">管理者</td></tr></tbody></table></div>';if(s==='empty')content='<div class="notice"><h2>暂未读取到成员</h2><p>当前尚未读取到成员记录。刷新以核对当前空间。</p><div><button data-refresh>重新读取成员</button></div></div>';if(s==='loading')content='<div role="status" class="notice">正在确认工作空间与成员…</div><div class="skeleton" aria-hidden="true"></div>';if(s==='degraded')content='<div class="notice warning" role="status"><p>成员信息暂时不可用，工作空间资料仍可查看。</p><p class="muted">关联编号：ui-safe-request</p><div><button data-refresh>重新读取成员</button></div></div>';if(content){view.innerHTML='<nav class="workspace-nav" aria-label="工作空间"><button aria-current="page">个人工作空间</button><button id="terminals">终端</button></nav>'+intro+'<section class="panel" aria-labelledby="members-title">'+heading+content+'</section><p class="footnote">个人空间由首次成功登录自动建立，无需另行设置组织或角色。</p>';}else{const copy={error:['暂时无法进入工作空间','暂时无法读取工作空间，请稍后重试。','重试读取'],forbidden:['无法访问此工作空间','当前账号已无权访问此工作空间。','使用其他账号登录'],'signed-out':['你的个人工作空间','登录后直接进入自己的空间，你是这里的唯一管理者。','登录或注册'],'logout-pending':['本机已退出','正在核实原会话已撤销…','重新登录'],'logout-unknown':['本机已退出','本机已退出，会话撤销待核实。请重试核实。','重试核实退出']}[s];view.innerHTML='<section class="panel landing"><h1>'+copy[0]+'</h1><p role="status">'+copy[1]+'</p><div><button class="primary" data-refresh>'+copy[2]+'</button></div></section>';}}
selector.addEventListener('change',render);document.getElementById('logout').onclick=()=>{selector.value='signed-out';render()};if(location.hash==='#signed-out')selector.value='signed-out';view.addEventListener('click',event=>{if(event.target.id==='terminals')location.href='terminals.html';if(event.target.hasAttribute('data-refresh')){selector.value='ready';render()}});render();
</script></body></html>`;
const terminals = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Maia 终端 · 交互原型</title><style>/* Generated from src/styles: pnpm prototype */
${tokens}
${css}</style></head><body>
<a class="skip" href="#main">跳到主要内容</a><header class="topbar"><div class="topbar-inner"><div class="brand"><span class="brand-mark" aria-hidden="true">M</span><span>Maia</span></div><button id="logout">退出登录</button></div></header>
<main id="main" tabindex="-1">
<nav class="workspace-nav" aria-label="工作空间"><button id="workspace">个人工作空间</button><button aria-current="page">终端</button></nav>
<section class="intro"><h1>终端</h1><p>接入装有 Celt 的 Windows 电脑，查看连接、版本和本机能力。</p></section>
<p class="footnote">原型仅展示示例数据。 <label>预览状态 <select id="state"><option value="ready">在线</option><option value="offline">离线</option><option value="low">低版本</option><option value="unknown">待确认</option><option value="empty">空</option><option value="loading">加载</option><option value="error">错误</option><option value="degraded">降级</option></select></label></p>
<section class="panel" aria-labelledby="terminals-title">
<div class="panel-heading terminal-heading"><h2 id="terminals-title">已接入终端</h2><button class="primary" id="add">添加终端</button></div>
<div id="view"></div><div class="notice terminal-actions"><button id="refresh">刷新终端</button></div>
</section>
<dialog id="dialog" class="panel terminal-dialog" aria-labelledby="terminal-dialog-title"><div class="notice">
<h2 id="terminal-dialog-title">添加终端</h2><p>在要接入的电脑上打开 Celt，并输入这个一次性激活码。</p><div id="activation"></div>
<div class="terminal-actions"><button id="close" autofocus>关闭</button><button class="primary" id="renew" hidden>重新生成</button></div></div></dialog>
</main><script>
const byId=(id)=>document.getElementById(id);
const seen='<time datetime="2026-11-05T08:00:00.000Z">2026年11月5日 16:00:00</time>';
function card(state){
  const unknown=state==='unknown', offline=state==='offline', low=state==='low';
  const facts=[['连接状态',unknown?'待确认':offline?'离线':'在线'],['最后在线',unknown?'待确认':seen],['Celt 版本',unknown?'待确认':low?'0.1.0':'0.2.0'],['Windows 版本',unknown?'待确认':'Windows 11'],['本机能力',unknown?'待确认':'<ul class="terminal-capabilities"><li>发送文本消息</li></ul>']];
  const warning=offline||low?'<p class="notice warning terminal-eligibility">当前不能执行任务。最低 Celt 版本为 0.2.0。</p>':'';
  return '<div class="terminal-list"><article class="terminal-card" data-terminal-id="101"><div class="terminal-title"><h3>前台电脑</h3><span class="pill">已激活</span></div><dl class="terminal-facts">'+facts.map(([label,value])=>'<div><dt>'+label+'</dt><dd>'+value+'</dd></div>').join('')+'</dl>'+warning+'</article></div>';
}
function render(){
  const state=byId('state').value;
  const views={
    empty:'<div class="notice"><p>暂无终端。选择“添加终端”开始接入。</p></div>',
    loading:'<div class="notice" role="status">正在读取终端…</div><div class="skeleton" aria-hidden="true"></div>',
    error:'<div class="notice warning" role="alert"><p>暂时无法读取终端，请重试。</p></div>',
    degraded:'<div class="notice warning" role="alert"><p>暂时无法刷新终端，以下显示上次读取的状态。</p></div>'+card('ready'),
  };
  byId('view').innerHTML=views[state]??card(state);
  byId('refresh').disabled=state==='loading';
}
let expiry;
function issue(){
  clearTimeout(expiry);
  byId('renew').hidden=true;
  byId('activation').innerHTML='<output class="activation-code" aria-label="一次性激活码">DEMO-ONLY</output><p>过期时间 <time datetime="2026-11-05T08:10:00.000Z">2026年11月5日 16:10:00</time></p><p class="muted">请妥善保管。关闭此对话框后将清除这里显示的激活码。</p>';
  expiry=setTimeout(()=>{byId('activation').innerHTML='<p role="alert">激活码已过期，请重新生成。</p>';byId('renew').hidden=false},15000);
}
byId('state').onchange=render;
byId('add').onclick=()=>{byId('dialog').showModal();issue()};
byId('dialog').onclose=()=>{clearTimeout(expiry);byId('activation').textContent=''};
byId('close').onclick=()=>byId('dialog').close();
byId('renew').onclick=issue;
byId('refresh').onclick=()=>{byId('state').value='ready';render()};
byId('workspace').onclick=()=>{location.href='personal-workspace.html'};
byId('logout').onclick=()=>{location.href='personal-workspace.html#signed-out'};
render();
</script></body></html>`;

for (const [name, content] of [
  ["personal-workspace", html],
  ["terminals", terminals],
]) {
  const target = new URL(`docs/prototypes/${name}.html`, root);
  if (process.argv.includes("--check")) {
    if (readFileSync(target, "utf8") !== content)
      throw new Error(
        `${name} 原型与 tokens 或布局不一致，请运行 pnpm prototype`,
      );
  } else writeFileSync(target, content);
}
if (process.argv.includes("--check")) console.log("独立原型与源码 tokens 一致");
