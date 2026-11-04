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
function render(){let s=selector.value;document.getElementById('logout').hidden=!['ready','empty','loading','degraded','error'].includes(s);let content='';if(s==='ready')content='<div class="table-scroll"><table><thead><tr><th scope="col">成员</th><th scope="col">角色</th></tr></thead><tbody><tr><td><span class="member-name">lin</span><span class="self">本人</span></td><td class="role">管理者</td></tr></tbody></table></div>';if(s==='empty')content='<div class="notice"><h2>暂未读取到成员</h2><p>当前尚未读取到成员记录。刷新以核对当前空间。</p><div><button data-refresh>重新读取成员</button></div></div>';if(s==='loading')content='<div role="status" class="notice">正在确认工作空间与成员…</div><div class="skeleton" aria-hidden="true"></div>';if(s==='degraded')content='<div class="notice warning" role="status"><p>成员信息暂时不可用，工作空间资料仍可查看。</p><p class="muted">关联编号：ui-safe-request</p><div><button data-refresh>重新读取成员</button></div></div>';if(content){view.innerHTML=intro+'<section class="panel" aria-labelledby="members-title">'+heading+content+'</section><p class="footnote">个人空间由首次成功登录自动建立，无需另行设置组织或角色。</p>';}else{const copy={error:['暂时无法进入工作空间','暂时无法读取工作空间，请稍后重试。','重试读取'],forbidden:['无法访问此工作空间','当前账号已无权访问此工作空间。','使用其他账号登录'],'signed-out':['你的个人工作空间','登录后直接进入自己的空间，你是这里的唯一管理者。','登录或注册'],'logout-pending':['本机已退出','正在核实原会话已撤销…','重新登录'],'logout-unknown':['本机已退出','本机已退出，会话撤销待核实。请重试核实。','重试核实退出']}[s];view.innerHTML='<section class="panel landing"><h1>'+copy[0]+'</h1><p role="status">'+copy[1]+'</p><div><button class="primary" data-refresh>'+copy[2]+'</button></div></section>';}}
selector.addEventListener('change',render);document.getElementById('logout').onclick=()=>{selector.value='signed-out';render()};view.addEventListener('click',event=>{if(event.target.hasAttribute('data-refresh')){selector.value='ready';render()}});render();
</script></body></html>`;
const target = new URL("docs/prototypes/personal-workspace.html", root);
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== html)
    throw new Error("原型与tokens/布局不一致，请运行pnpm prototype");
  console.log("独立原型与源码tokens/布局一致");
} else writeFileSync(target, html);
