import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const DIR = dirname(fileURLToPath(import.meta.url));
const FONT = "PingFang SC, Hiragino Sans GB, Heiti SC, sans-serif";
const scenes = [];

// ---- Scene 1: login ----
{
  const W=390,H=760, tests=[];
  const box=(x,y,w,h,fill,stroke='#ccc',rx=8)=>`<rect x='${x}' y='${y}' width='${w}' height='${h}' rx='${rx}' fill='${fill}' stroke='${stroke}'/>`;
  const t=(x,y,s,size=16,fill='#333',anchor='start',w='400')=>`<text x='${x}' y='${y}' font-family="${FONT}" font-size='${size}' fill='${fill}' text-anchor='${anchor}' font-weight='${w}'>${s}</text>`;
  const phone={x:30,y:140,w:330,h:48}, pass={x:30,y:210,w:330,h:48}, chk={x:30,y:288,w:20,h:20}, btn={x:30,y:340,w:330,h:50}, link={x:250,y:290,w:110,h:22};
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#f7f7f9"/>
  ${t(W/2,60,'会员登录',24,'#111','middle','600')}
  ${box(phone.x,phone.y,phone.w,phone.h,'#fff')}${t(phone.x+14,phone.y+30,'手机号',16,'#999')}
  ${box(pass.x,pass.y,pass.w,pass.h,'#fff')}${t(pass.x+14,pass.y+30,'密码',16,'#999')}
  <rect x='${chk.x}' y='${chk.y}' width='${chk.w}' height='${chk.h}' rx='4' fill='#fff' stroke='#bbb'/>${t(chk.x+28,chk.y+16,'记住我',15,'#555')}
  ${t(link.x+link.w,link.y+16,'忘记密码?',15,'#3a7afe','end')}
  ${box(btn.x,btn.y,btn.w,btn.h,'#e23b3b','#e23b3b',10)}${t(W/2,btn.y+32,'登录',18,'#fff','middle','600')}
  </svg>`;
  const B=o=>[o.x,o.y,o.x+o.w,o.y+o.h];
  tests.push({desc:'登录按钮',truth:B(btn)});
  tests.push({desc:'手机号输入框',truth:B(phone)});
  tests.push({desc:'密码输入框',truth:B(pass)});
  tests.push({desc:'“记住我”前面的复选框',truth:B(chk)});
  tests.push({desc:'“忘记密码”链接文字',truth:B(link)});
  scenes.push({name:'login',W,H,svg,tests});
}

// ---- Scene 2: message list ----
{
  const W=390,H=760, tests=[];
  const names=['Alice','Bob','Carol','David','Emma','Frank'];
  const msgs=['在吗?晚点约个时间','好的收到,明天见','这个方案我看过了','付款已经完成啦','周末一起吃饭?','文件发你邮箱了'];
  let rows=''; const avatars=[],mores=[],msgboxes=[];
  names.forEach((nm,i)=>{
    const top=20+i*118, cy=top+40;
    const av={x:27,y:cy-28,w:56,h:56}; avatars.push(av);
    const mo={x:340,y:top+16,w:26,h:20}; mores.push(mo);
    const mb={x:100,y:top+48,w:210,h:24}; msgboxes.push(mb);
    rows+=`<circle cx='${av.x+28}' cy='${cy}' r='28' fill='hsl(${i*55},60%,65%)'/>
    <text x='${av.x+28}' y='${cy+6}' font-family="${FONT}" font-size='20' fill='#fff' text-anchor='middle'>${nm[0]}</text>
    <text x='100' y='${top+32}' font-family="${FONT}" font-size='17' fill='#111' font-weight='600'>${nm}</text>
    <text x='100' y='${top+66}' font-family="${FONT}" font-size='15' fill='#666'>${msgs[i]}</text>
    <g fill='#bbb'><circle cx='${mo.x+4}' cy='${mo.y+10}' r='3'/><circle cx='${mo.x+13}' cy='${mo.y+10}' r='3'/><circle cx='${mo.x+22}' cy='${mo.y+10}' r='3'/></g>
    <line x1='27' y1='${top+108}' x2='363' y2='${top+108}' stroke='#eee'/>`;
  });
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>${rows}</svg>`;
  const B=o=>[o.x,o.y,o.x+o.w,o.y+o.h];
  tests.push({desc:'Carol 这一行左边的头像',truth:B(avatars[2])});
  tests.push({desc:'第4行(David)的消息正文文字',truth:B(msgboxes[3])});
  tests.push({desc:'Bob 这一行最右边的更多按钮(三个点)',truth:B(mores[1])});
  tests.push({desc:'最后一行 Frank 的头像',truth:B(avatars[5])});
  scenes.push({name:'list',W,H,svg,tests});
}

// ---- Scene 3: toolbar icons ----
{
  const W=390,H=220, tests=[];
  const back={x:12,y:18,w:28,h:28}, search={x:300,y:16,w:32,h:32}, gear={x:344,y:16,w:32,h:32};
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#fff"/>
  <rect x='0' y='0' width='${W}' height='64' fill='#f2f3f5'/>
  <polyline points='34,22 20,32 34,42' fill='none' stroke='#333' stroke-width='3'/>
  <text x='${W/2}' y='40' font-family="${FONT}" font-size='18' fill='#111' text-anchor='middle' font-weight='600'>消息</text>
  <g stroke='#333' stroke-width='3' fill='none'><circle cx='310' cy='28' r='9'/><line x1='317' y1='35' x2='326' y2='44'/></g>
  <g stroke='#333' stroke-width='2.5' fill='none'><circle cx='360' cy='32' r='8'/><circle cx='360' cy='32' r='3'/>
    <line x1='360' y1='20' x2='360' y2='44'/><line x1='348' y1='32' x2='372' y2='32'/><line x1='351' y1='23' x2='369' y2='41'/><line x1='369' y1='23' x2='351' y2='41'/></g>
  <text x='20' y='110' font-family="${FONT}" font-size='15' fill='#888'>下面是内容区……</text>
  </svg>`;
  const B=o=>[o.x,o.y,o.x+o.w,o.y+o.h];
  tests.push({desc:'右上角的搜索图标(放大镜)',truth:B(search)});
  tests.push({desc:'右上角的设置齿轮图标',truth:B(gear)});
  tests.push({desc:'左上角的返回箭头',truth:B(back)});
  scenes.push({name:'toolbar',W,H,svg,tests});
}

mkdirSync(join(DIR, 'img'), { recursive: true });
const manifest=[];
for(const s of scenes){
  const svgPath = join(DIR, 'img', `${s.name}.svg`);
  writeFileSync(svgPath, s.svg);
  // render PNG (needs rsvg-convert; CJK relies on system PingFang font)
  try { execFileSync('rsvg-convert', [svgPath, '-o', join(DIR, 'img', `${s.name}.png`)]); }
  catch { console.warn(`rsvg-convert missing: ${s.name}.png not rendered`); }
  manifest.push({name:s.name,W:s.W,H:s.H,png:`./img/${s.name}.png`,tests:s.tests});
}
writeFileSync(join(DIR, 'manifest.json'), JSON.stringify(manifest,null,2));
console.log('generated', scenes.map(s=>s.name).join(', '));
